// `session.reservation.removeAirSegments` (ADR-034, #269): borra del PNR los segmentos viejos de un
// cambio de horario (`UN`/`HX`) que elige el consumidor, con un `ProductUpdate op="D"` por segmento
// en un solo `UpdateReservationRQ`, después de releer el PNR y comprobar que cada segmento existe y
// está en un estado permitido. Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/
// confirmar-cambio-de-horario.md.
import { respondedAtField } from '../http/soap-transport.js';
import {
  AirSegmentUpdate,
  type AirSegmentUpdateContext,
  type AirSegmentUpdateOptions,
  invalid,
  validateCommon,
  validateIds,
  withPreviousStatus,
} from './air-segment-update.js';
import {
  deleteSegmentItem,
  type ReservationAirSegment,
  type ReservationUpdateWarning,
  SabreReservationUpdateError,
  UPDATE_RESERVATION_SERVICE,
} from './stl-reservation.js';

export const REMOVE_AIR_SEGMENTS_OPERATION = 'reservation.removeAirSegments';

/**
 * Los estados que `removeAirSegments` borra si no se pasa `allowedStatuses`: `UN` y `HX`, los
 * únicos vistos en producción en un cambio de horario. **`HK` nunca entra en el default.**
 */
export const DEFAULT_REMOVABLE_STATUSES: readonly string[] = Object.freeze(['UN', 'HX']);

export interface RemoveAirSegmentsRequest {
  /** El localizador del PNR: 6 caracteres alfanuméricos en mayúscula. */
  locator: string;
  /** El `ReceivedFrom` de la transacción (`6` del host): quién hizo el cambio. Obligatorio. */
  receivedFrom: string;
  /**
   * Los ids (`ReservationAirSegment.id`) de los segmentos a borrar: uno o más, en cualquier orden.
   * Si alguno no está en el PNR o no está en `allowedStatuses`, no se borra ninguno.
   */
  segmentIds: readonly string[];
  /**
   * Los `ActionCode` que se pueden borrar. Por defecto `['UN', 'HX']`
   * (`DEFAULT_REMOVABLE_STATUSES`): `HK` nunca entra en el default. Reemplaza el default, no lo
   * amplía: para borrar también un `HK`, `['UN', 'HX', 'HK']`.
   */
  allowedStatuses?: readonly string[];
}

export interface RemoveAirSegmentsOptions extends AirSegmentUpdateOptions {}

export interface RemoveAirSegmentsResult {
  /** `'removed'`: se mandó el Update y Sabre respondió `Success`. */
  status: 'removed';
  locator: string;
  /**
   * Los segmentos aéreos que quedan en el PNR después del cambio (`RetrievePNR`), con su
   * `previousStatus` de la lectura previa. Los borrados ya no están.
   */
  segments: ReservationAirSegment[];
  /**
   * Los ids de los segmentos de la lectura previa que ya no están en el PNR o cambiaron de estado,
   * en el orden del PNR. Si Sabre hizo bien la baja, son los `segmentIds`.
   */
  changed: string[];
  /** `NOT_APPLIED` si un segmento pedido sigue en el PNR, y los `Warnings` de Sabre. */
  warnings: ReservationUpdateWarning[];
  /** `eb:Timestamp` de la última respuesta de Sabre, en ISO 8601 UTC. Falta si Sabre no lo manda. */
  respondedAt?: string;
}

/** @internal Lo que la operación necesita de la sesión. */
export type RemoveAirSegmentsContext = AirSegmentUpdateContext;

/** Valida sin red; devuelve los `segmentIds` y los `allowedStatuses` normalizados. */
export function validateRemoveAirSegmentsRequest(
  request: RemoveAirSegmentsRequest,
  options: RemoveAirSegmentsOptions,
): { segmentIds: string[]; allowedStatuses: string[] } {
  validateCommon(REMOVE_AIR_SEGMENTS_OPERATION, request, options);
  const segmentIds = validateIds(REMOVE_AIR_SEGMENTS_OPERATION, 'segmentIds', request.segmentIds);
  const statuses = request.allowedStatuses as unknown;
  if (statuses === undefined) return { segmentIds, allowedStatuses: [...DEFAULT_REMOVABLE_STATUSES] };
  if (!Array.isArray(statuses) || statuses.length === 0) invalid(REMOVE_AIR_SEGMENTS_OPERATION, 'necesita allowedStatuses con al menos un estado, o nada');
  for (const status of statuses as unknown[]) {
    if (typeof status !== 'string' || status.trim() === '') invalid(REMOVE_AIR_SEGMENTS_OPERATION, 'necesita estados no vacíos en allowedStatuses');
  }
  return { segmentIds, allowedStatuses: [...new Set((statuses as string[]).map((status) => status.trim().toUpperCase()))] };
}

/**
 * El chequeo local de ADR-034, sin red: cada segmento pedido existe en `segments` y su estado está
 * en `allowedStatuses`. Si no, lanza `SabreReservationUpdateError` con `reason`
 * `SEGMENT_NOT_FOUND` (primero) o `SEGMENT_STATUS_NOT_ALLOWED`; `actualSegments` trae los ids
 * pedidos que no pasaron. `raw` es la respuesta de la lectura, si la hay.
 */
export function checkRemovableSegments(
  segments: readonly ReservationAirSegment[],
  segmentIds: readonly string[],
  allowedStatuses: readonly string[],
  raw?: unknown,
): void {
  const byId = new Map(segments.map((segment) => [segment.id, segment]));
  const missing = segmentIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new SabreReservationUpdateError(
      `${UPDATE_RESERVATION_SERVICE}: el PNR no tiene los segmentos aéreos ${missing.join(', ')}; no se escribió nada`,
      { reason: 'SEGMENT_NOT_FOUND', code: 'SEGMENT_NOT_FOUND', raw, expectedSegments: segmentIds, actualSegments: missing },
    );
  }
  const allowed = new Set(allowedStatuses);
  const blocked = segmentIds.filter((id) => !allowed.has(byId.get(id)?.status ?? ''));
  if (blocked.length > 0) {
    throw new SabreReservationUpdateError(
      `${UPDATE_RESERVATION_SERVICE}: ${blocked.map((id) => `${id} (${byId.get(id)?.status})`).join(', ')} no está en allowedStatuses (${allowedStatuses.join(', ')}); no se escribió nada`,
      { reason: 'SEGMENT_STATUS_NOT_ALLOWED', code: 'SEGMENT_STATUS_NOT_ALLOWED', raw, expectedSegments: segmentIds, actualSegments: blocked },
    );
  }
}

export async function removeAirSegments(
  context: RemoveAirSegmentsContext,
  request: RemoveAirSegmentsRequest,
  options: RemoveAirSegmentsOptions = {},
): Promise<RemoveAirSegmentsResult> {
  const { segmentIds, allowedStatuses } = validateRemoveAirSegmentsRequest(request, options);
  const { locator, receivedFrom } = request;
  const update = new AirSegmentUpdate(context, REMOVE_AIR_SEGMENTS_OPERATION, locator, options);

  // 1. Lectura `Stateful`.
  const before = await update.read();

  // 2. Chequeo local, sin escribir.
  checkRemovableSegments(before.segments, segmentIds, allowedStatuses, before.response.raw);

  // 3. Escritura: un `ProductUpdate op="D"` por segmento, con el ET en la misma llamada.
  const { response, after } = await update.write(segmentIds.map(deleteSegmentItem), receivedFrom);

  // 4. Resultado: lo que cambió sale de comparar, como en `confirmAirSegments`.
  const segments = withPreviousStatus(before.segments, after.segments);
  const now = new Map(segments.map((segment) => [segment.id, segment.status]));
  const changed = before.segments.filter((segment) => now.get(segment.id) !== segment.status).map((segment) => segment.id);
  const notApplied = segmentIds.filter((id) => now.has(id));
  const warnings: ReservationUpdateWarning[] = [...before.warnings, ...after.warnings];
  if (notApplied.length > 0) {
    warnings.push({
      code: 'NOT_APPLIED',
      message: `Sabre respondió Success, pero ${notApplied.map((id) => `${id} (${now.get(id)})`).join(', ')} sigue en el PNR`,
      segmentIds: notApplied,
    });
  }
  return { status: 'removed', locator, segments, changed, warnings, ...respondedAtField(response.raw) };
}
