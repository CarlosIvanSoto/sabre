// Los reportes dentro de una sesión SOAP: hoy, las ventas del día (ADR-030).
import type { SoapResponse } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';
import {
  type DailySalesSummaryOptions,
  type DailySalesSummaryRequest,
  type DailySalesSummaryResult,
  dailySalesSummaryRequest,
  parseDailySalesSummaryResponse,
  validateDailySalesSummaryRequest,
} from './daily-sales-summary.js';

/** @internal Lo que `SessionReporting` necesita de la sesión. */
export interface ReportingContext {
  send(request: SessionRequest): Promise<SoapResponse>;
  /** El PCC de la sesión: el `pcc` del resultado si Sabre no lo trae. */
  pcc: string;
}

export class SessionReporting {
  readonly #context: ReportingContext;

  /** @internal Lo construye `SabreSession`. */
  constructor(context: ReportingContext) {
    this.#context = context;
  }

  /**
   * Ventas del día: el «Summary» del DQB (`TKT_TravelAgencyReportsRQ` / `DailySalesSummaryRQ`
   * 1.2.2). Una transacción por movimiento del PCC en el día: ventas, reembolsos, voids, EMD y MCO,
   * sin tope. Sin `date`, da el día en curso, hasta minutos antes de la llamada (producción,
   * 2026-11-12). **Trae datos del pasajero** (`passengerName`).
   *
   * - Las fechas y horas (`transactionDateTime`, `reportDate`) llegan **tal como vienen, sin zona**.
   *   En producción vienen en hora local del PCC; el SDK no las convierte.
   * - Solo `status: 'complete'` es el día entero. `incomplete` trae `failedDocuments`, y `deferred`
   *   quiere decir que Sabre lo dejó en caché o sigue corriendo: hay que volver a pedirlo. El SDK
   *   no pide `CachedReportRQ`.
   * - Los importes van como string.
   *
   * Otro PCC necesita Branch Access: sin él, Sabre responde `45100` y el SDK lanza
   * `SabreBusinessError` (`service: 'dailySalesSummary'`, `code: '45100'`). Lo mismo con `21212`
   * (versión) y cualquier otro error de la respuesta. Un fallo de autorización del gateway
   * (`USG_AUTHORIZATION_FAILED`) sale como los demás de la sesión. Un filtro con forma
   * equivocada lanza `TypeError` sin red.
   *
   * Es una lectura: se reintenta ante fallos de transporte, pero no ante errores de negocio.
   */
  async dailySalesSummary(request: DailySalesSummaryRequest = {}, options: DailySalesSummaryOptions = {}): Promise<DailySalesSummaryResult> {
    validateDailySalesSummaryRequest(request);
    const response = await this.#context.send(dailySalesSummaryRequest(request, options));
    return parseDailySalesSummaryResponse(response, request.pcc ?? this.#context.pcc);
  }
}
