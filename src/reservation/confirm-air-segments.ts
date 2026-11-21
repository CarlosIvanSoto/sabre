// `session.reservation.confirmAirSegments` (ADR-034, #268): pasa a `HK` los segmentos `TK` de un
// cambio de horario con `UpdateReservationRQ` `CONFIRM-ALL`, después de releer el PNR y comprobar
// que los `TK` son los que el consumidor espera. Ver sabre-wiki/wiki/proyectos/sabre-client/
// decisiones/confirmar-cambio-de-horario.md.
import { respondedAtField } from '../http/soap-transport.js';
import {
  AirSegmentUpdate,
  type AirSegmentUpdateContext,
  type AirSegmentUpdateOptions,
  unexpectedChange,
  validateCommon,
  validateIds,
  withPreviousStatus,
} from './air-segment-update.js';
import { CONFIRM_ALL_ITEM, type ReservationAirSegment, type ReservationUpdateWarning, SabreReservationUpdateError, UPDATE_RESERVATION_SERVICE } from './stl-reservation.js';

export const CONFIRM_AIR_SEGMENTS_OPERATION = 'reservation.confirmAirSegments';

export interface ConfirmAirSegmentsRequest {
  /** El localizador del PNR: 6 caracteres alfanuméricos en mayúscula. */
  locator: string;
  /** El `ReceivedFrom` de la transacción (`6` del host): quién hizo el cambio. Obligatorio. */
  receivedFrom: string;
  /**
   * Los ids (`ReservationAirSegment.id`) de los segmentos `TK` que el consumidor espera
   * confirmar, en cualquier orden. Si los `TK` del PNR no son exactamente estos, no se escribe
   * nada y lanza `SabreReservationUpdateError` con `reason: 'SEGMENTS_CHANGED'`.
   */
  expectedSegmentIds: readonly string[];
}

export interface ConfirmAirSegmentsOptions extends AirSegmentUpdateOptions {}

export interface ConfirmAirSegmentsResult {
  /** `'confirmed'`: se mandó `CONFIRM-ALL`. `'noop'`: el PNR no tenía ningún `TK` y no se escribió nada. */
  status: 'confirmed' | 'noop';
  locator: string;
  /**
   * Los segmentos aéreos del PNR después del cambio (`RetrievePNR`), con su `previousStatus` de
   * la lectura previa. Con `'noop'`, los de la lectura previa.
   */
  segments: ReservationAirSegment[];
  /**
   * Los ids de los segmentos cuyo `status` cambió. Vacío con `'noop'`. Si trae otros que los
   * `expectedSegmentIds` (un `KK` que pasó a `HK`, por ejemplo), sale `UNEXPECTED_CHANGE`.
   */
  changed: string[];
  /**
   * `NOT_APPLIED` si un segmento esperado no quedó en `HK`, `UNEXPECTED_CHANGE` si `changed` trae
   * segmentos no esperados, y los `Warnings` de Sabre.
   */
  warnings: ReservationUpdateWarning[];
  /** `eb:Timestamp` de la última respuesta de Sabre, en ISO 8601 UTC. Falta si Sabre no lo manda. */
  respondedAt?: string;
}

/** @internal Lo que la operación necesita de la sesión. */
export type ConfirmAirSegmentsContext = AirSegmentUpdateContext;

export function validateConfirmAirSegmentsRequest(request: ConfirmAirSegmentsRequest, options: ConfirmAirSegmentsOptions): string[] {
  validateCommon(CONFIRM_AIR_SEGMENTS_OPERATION, request, options);
  return validateIds(CONFIRM_AIR_SEGMENTS_OPERATION, 'expectedSegmentIds', request.expectedSegmentIds);
}

export async function confirmAirSegments(
  context: ConfirmAirSegmentsContext,
  request: ConfirmAirSegmentsRequest,
  options: ConfirmAirSegmentsOptions = {},
): Promise<ConfirmAirSegmentsResult> {
  const expected = validateConfirmAirSegmentsRequest(request, options);
  const { locator, receivedFrom } = request;
  const update = new AirSegmentUpdate(context, CONFIRM_AIR_SEGMENTS_OPERATION, locator, options);

  // 1. Lectura `Stateful`.
  const before = await update.read();

  // 2. Chequeo local, sin escribir.
  const tk = before.segments.filter((segment) => segment.status === 'TK').map((segment) => segment.id);
  if (tk.length === 0) {
    return {
      status: 'noop',
      locator,
      segments: before.segments.map((segment) => ({ ...segment, previousStatus: segment.status })),
      changed: [],
      warnings: before.warnings,
      ...respondedAtField(before.response.raw),
    };
  }
  if (!sameIds(tk, expected)) {
    throw new SabreReservationUpdateError(
      `${UPDATE_RESERVATION_SERVICE}: los segmentos TK del PNR (${tk.join(', ')}) no son los esperados (${expected.join(', ')}); no se escribió nada`,
      { reason: 'SEGMENTS_CHANGED', code: 'SEGMENTS_CHANGED', raw: before.response.raw, expectedSegments: expected, actualSegments: tk },
    );
  }

  // 3. Escritura: `CONFIRM-ALL` con el ET en la misma llamada, sin ningún reintento.
  const { response, after } = await update.write([CONFIRM_ALL_ITEM], receivedFrom);

  // 4. Resultado: `CONFIRM-ALL` no trae `Results`, así que lo que cambió sale de comparar.
  const segments = withPreviousStatus(before.segments, after.segments);
  const changed = segments.filter((segment) => segment.previousStatus !== segment.status).map((segment) => segment.id);
  const now = new Map(segments.map((segment) => [segment.id, segment.status]));
  const notApplied = expected.filter((id) => now.get(id) !== 'HK');
  const warnings: ReservationUpdateWarning[] = [...before.warnings, ...after.warnings];
  if (notApplied.length > 0) {
    warnings.push({
      code: 'NOT_APPLIED',
      message: `Sabre respondió Success, pero ${notApplied.map((id) => `${id} (${now.get(id) ?? 'ya no está'})`).join(', ')} no quedó en HK`,
      segmentIds: notApplied,
    });
  }
  const unexpected = unexpectedChange(changed, expected, (id) => now.get(id));
  if (unexpected !== undefined) warnings.push(unexpected);
  return { status: 'confirmed', locator, segments, changed, warnings, ...respondedAtField(response.raw) };
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const set = new Set(actual);
  return set.size === expected.length && expected.every((id) => set.has(id));
}
