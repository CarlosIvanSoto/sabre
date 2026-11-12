// Ventas del día: el «Summary» del DQB (`TKT_TravelAgencyReportsRQ` / `DailySalesSummaryRQ` 1.2.2).
// Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/ventas-del-dia-summary.md (ADR-030) y
// wiki/sources/display-audit-trail-user-guide-v4.md.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreBusinessError, SabreGatewayError } from '../errors/index.js';
import { asArray, respondedAtField, type SoapResponse, textOf, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from '../session/session.js';

export const DAILY_SALES_SUMMARY_SERVICE = 'dailySalesSummary';
const NAMESPACE = 'http://www.sabre.com/ns/Ticketing/AsrServices/1.0';
/** El máximo que admite Sabre, según la guía (el design dice que el default es 30). */
const CLIENT_TIMEOUT_SECS = 25;

export type DailySalesDocumentType = 'TKT' | 'EMD' | 'RFND' | 'RFEMD' | 'MCO';
export type DailySalesSettlementType = 'TAT' | 'TCH' | 'TKT' | 'NDC';

export interface DailySalesSummaryRequest {
  /** PCC del reporte. Sin él, Sabre usa el home PCC del token. Otro PCC necesita Branch Access. */
  pcc?: string;
  /** `'YYYY-MM-DD'`. Sin ella, Sabre da el día en curso. Una sola fecha, sin rango. */
  date?: string;
  /** Un solo tipo de documento. Sin él, todos. */
  documentType?: DailySalesDocumentType;
  /** Un solo tipo de settlement. */
  settlementType?: DailySalesSettlementType;
  /** La aerolínea, por código (2 caracteres) o número (3 dígitos). */
  airline?: { code?: string; number?: string };
  /** Todas las transacciones de ese documento. Sabre recomienda no combinarlo con otros filtros. */
  documentNumber?: string;
}

export type DailySalesSummaryOptions = RequestOptions;

/** Un pago de la transacción. Los importes van como string, tal cual llegan. */
export interface DailySalesPaymentDetail {
  fop: string;
  /** `Cash` o `Credit`. */
  category: string;
  cardType?: string;
  amount: string;
}

export interface DailySalesPayments {
  currencyCode: string;
  total: string;
  details: DailySalesPaymentDetail[];
}

/** Un movimiento del día: una venta, un reembolso, un void… */
export interface DailySalesTransaction {
  /** El reembolso llega como `RFD`, aunque la guía dice `RFND` (producción, 2026-11-12). */
  documentType: 'TKT' | 'EMD' | 'RFD' | 'RFND' | 'RFEMD' | 'MCO' | (string & {});
  transactionCode: 'SALE' | 'RFND' | 'CNCL' | 'VOID' | (string & {});
  /** `A` additional collection, `E` even exchange, `N` net remit, `P`, `R`, `SF`, `V` void, `X` cancel refund. */
  documentStatusCode?: string;
  settlementType: string;
  pnrLocator?: string;
  passengerName?: string;
  documentNumber: string;
  lastConjunctiveDocumentNumber?: string;
  stockType?: string;
  airline: { code: string; number?: string };
  commission?: { amount?: string; percent?: string };
  payments?: DailySalesPayments;
  agentSine: string;
  agentPseudoCity?: string;
  /**
   * Fecha y hora **tal como llegan, sin zona**: `'YYYY-MM-DDTHH:MM:SS.sss'`. En producción vienen
   * en hora local del PCC (México, 2026-11-12); el SDK no las convierte porque no conoce la zona.
   */
  transactionDateTime: string;
  electronicDocument?: boolean;
  nonInteractive?: boolean;
  itineraryType?: 'D' | 'I' | (string & {});
  automatedRefund?: boolean;
}

/** Un total de `TotalDailySales`: por tipo de transacción, settlement y moneda. */
export interface DailySalesTotal {
  transactionType: string;
  settlementType: string;
  currencyCode?: string;
  cash?: { amount: string; count?: number };
  credit?: { amount: string; count?: number };
  commission?: { amount: string; count?: number };
}

export interface DailySalesSummaryResult {
  /**
   * - `complete`: el reporte entero;
   * - `incomplete`: Sabre no pudo leer algunos documentos (`failedDocuments`); faltan transacciones;
   * - `deferred`: Sabre lo dejó en caché (`deferred.reportId`) o sigue corriendo. El SDK no pide
   *   `CachedReportRQ`: hay que volver a pedir el reporte más tarde.
   *
   * Solo `complete` es el día entero.
   */
  status: 'complete' | 'incomplete' | 'deferred';
  pcc: string;
  agencyName?: string;
  /** `DSHeader`/`DailySalesReport` `ReportDate`, tal cual. */
  reportDate?: string;
  transactions: DailySalesTransaction[];
  totals: DailySalesTotal[];
  /** Los documentos de `Error status="Incomplete"`. */
  failedDocuments?: string[];
  deferred?: { reportId?: string; chunkNumber?: number; maxChunks?: number; queryStillRunning: boolean };
  /** `eb:Timestamp` de la respuesta, en ISO 8601 UTC. */
  respondedAt?: string;
}

const PCC = /^[A-Z0-9]{3,4}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_TYPES: readonly string[] = ['TKT', 'EMD', 'RFND', 'RFEMD', 'MCO'];
const SETTLEMENT_TYPES: readonly string[] = ['TAT', 'TCH', 'TKT', 'NDC'];

/** Valida el request sin red: un valor con forma equivocada lanza `TypeError`. */
export function validateDailySalesSummaryRequest(request: DailySalesSummaryRequest): void {
  const fail = (detail: string): never => {
    throw new TypeError(`sabre-client: reporting.dailySalesSummary: ${detail}`);
  };
  if (request.pcc !== undefined && !PCC.test(request.pcc)) fail('pcc debe tener 3 o 4 letras mayúsculas o dígitos');
  if (request.date !== undefined && (!DATE.test(request.date) || Number.isNaN(Date.parse(`${request.date}T00:00:00Z`)))) {
    fail("date debe tener la forma 'YYYY-MM-DD'");
  }
  if (request.documentType !== undefined && !DOCUMENT_TYPES.includes(request.documentType)) fail(`documentType debe ser ${DOCUMENT_TYPES.join(', ')}`);
  if (request.settlementType !== undefined && !SETTLEMENT_TYPES.includes(request.settlementType)) fail(`settlementType debe ser ${SETTLEMENT_TYPES.join(', ')}`);
  if (request.airline !== undefined) {
    const { code, number } = request.airline;
    if (code === undefined && number === undefined) fail('airline necesita code o number');
    if (code !== undefined && !/^[A-Z0-9]{2}$/.test(code)) fail('airline.code debe tener 2 caracteres');
    if (number !== undefined && !/^\d{3}$/.test(number)) fail('airline.number debe tener 3 dígitos');
  }
  if (request.documentNumber !== undefined && !/^\d{10,15}$/.test(request.documentNumber)) fail('documentNumber debe tener de 10 a 15 dígitos');
}

/**
 * Cuerpo de `DailySalesSummaryRQ`, con los filtros en el orden del design. El design escribe
 * `DocumentNumber` por error como un segundo `DocumentType`; aquí va con su nombre.
 */
export function dailySalesSummaryPayload(request: DailySalesSummaryRequest = {}): string {
  const { pcc, date, documentType, settlementType, airline, documentNumber } = request;
  const airlineXml =
    airline === undefined
      ? ''
      : `<Airline>${airline.code === undefined ? '' : `<AirlineCode>${xmlEscape(airline.code)}</AirlineCode>`}${airline.number === undefined ? '' : `<AirlineNumber>${xmlEscape(airline.number)}</AirlineNumber>`}</Airline>`;
  const criteria = [
    pcc === undefined ? '' : `<PseudoCityCode>${xmlEscape(pcc)}</PseudoCityCode>`,
    airlineXml,
    date === undefined ? '' : `<ReportDate>${xmlEscape(date)}</ReportDate>`,
    settlementType === undefined ? '' : `<SettlementType>${xmlEscape(settlementType)}</SettlementType>`,
    documentType === undefined ? '' : `<DocumentType>${xmlEscape(documentType)}</DocumentType>`,
    documentNumber === undefined ? '' : `<DocumentNumber>${xmlEscape(documentNumber)}</DocumentNumber>`,
  ].join('');
  return `<DailySalesSummaryRQ xmlns="${NAMESPACE}" version="1.2.2"><Header/><SelectionCriteria isCacheLateLargeReports="false" clientTimeoutSecs="${CLIENT_TIMEOUT_SECS}">${criteria}</SelectionCriteria></DailySalesSummaryRQ>`;
}

/**
 * Es una lectura: los reintentos de transporte siguen como siempre. No hay reintentos de negocio
 * (ADR-030): el consumidor vuelve a pedir el reporte en su siguiente ciclo.
 */
export function dailySalesSummaryRequest(request: DailySalesSummaryRequest, options: DailySalesSummaryOptions): SessionRequest {
  return {
    service: DAILY_SALES_SUMMARY_SERVICE,
    action: 'TKT_TravelAgencyReportsRQ',
    payload: dailySalesSummaryPayload(request),
    idempotent: true,
    operation: 'reporting.dailySalesSummary',
    ...options,
  };
}

type XmlNode = Record<string, unknown>;

const node = (value: unknown): XmlNode | undefined => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'object' && first !== null ? (first as XmlNode) : undefined;
};
const attribute = (value: unknown, name: string): string | undefined => {
  const found = node(value)?.[`@${name}`];
  return typeof found === 'string' ? found : undefined;
};
const text = (value: unknown): string | undefined => {
  const found = textOf(Array.isArray(value) ? value[0] : value)?.trim();
  return found === undefined || found === '' ? undefined : found;
};
const flag = (value: string | undefined): boolean | undefined => (value === 'true' ? true : value === 'false' ? false : undefined);
const integer = (value: string | undefined): number | undefined => (value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined);
/** Quita las claves `undefined`, para respetar `exactOptionalPropertyTypes`. */
function defined<R extends object>(entries: { [K in keyof R]-?: R[K] | undefined }): R {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as R;
}

/** Un `Error` de `Header/Results` (estructura STL): estado, código y mensaje. */
interface SummaryError {
  status?: string;
  code: string;
  message: string;
}

function summaryErrors(payload: XmlNode): SummaryError[] {
  const results = [node(payload.Header)?.Results, payload.Results];
  return results.flatMap((value) =>
    asArray(node(value)?.Error).map((error) => {
      const entry = node(error);
      const message = text(entry?.Message) ?? text(entry?.Description) ?? text(error) ?? '';
      const code = text(entry?.ErrorCode) ?? text(entry?.Code) ?? attribute(error, 'code') ?? attribute(entry?.Message, 'code') ?? /^\s*(\d{4,6})\b/.exec(message)?.[1] ?? 'UNKNOWN';
      const status = attribute(error, 'status');
      return defined<SummaryError>({ status, code, message });
    }),
  );
}

/** Los números de documento de "The following are the failed transactions : [n1, n2]". */
function failedDocumentsOf(message: string): string[] {
  const list = message.slice(message.indexOf(':') + 1);
  return [...list.matchAll(/\d{7,}/g)].map((match) => match[0]);
}

function readTransaction(value: unknown, response: SoapResponse): DailySalesTransaction {
  const transaction = node(value) ?? {};
  const details = node(transaction.DocumentDetails) ?? {};
  const documentType = text(transaction.DocumentType);
  const documentNumber = text(details.DocumentNumber);
  const transactionCode = text(details.TransactionCode);
  const transactionDateTime = text(transaction.TransactionDateTime);
  if (documentType === undefined || documentNumber === undefined || transactionCode === undefined || transactionDateTime === undefined) {
    throw malformed('Transaction sin DocumentType, DocumentNumber, TransactionCode o TransactionDateTime', response);
  }
  const airline = transaction.AirlineCode;
  const commission = node(transaction.Commission);
  const payments = node(transaction.Payments);
  const documentPayment = node(payments?.DocumentPayment);
  return defined<DailySalesTransaction>({
    documentType,
    transactionCode,
    documentStatusCode: text(details.DocumentStatusCode),
    settlementType: text(transaction.SettlementType) ?? '',
    pnrLocator: text(transaction.PnrLocator),
    passengerName: text(transaction.PassengerName),
    documentNumber,
    lastConjunctiveDocumentNumber: text(details.LastConjunctiveDocumentNumber),
    stockType: text(details.StockType),
    airline: defined<DailySalesTransaction['airline']>({ code: text(airline) ?? '', number: attribute(airline, 'AirlineNumber') }),
    commission:
      commission === undefined ? undefined : defined<NonNullable<DailySalesTransaction['commission']>>({ amount: text(commission.Amount), percent: text(commission.Percent) }),
    payments:
      payments === undefined
        ? undefined
        : {
            currencyCode: text(payments.CurrencyCode) ?? '',
            total: text(documentPayment?.PaymentTotal) ?? '',
            details: asArray(documentPayment?.PaymentDetail).map((detail) =>
              defined<DailySalesPaymentDetail>({
                fop: attribute(detail, 'fop') ?? '',
                category: attribute(detail, 'category') ?? '',
                cardType: attribute(detail, 'cardType'),
                amount: text(node(detail)?.PaymentAmount) ?? '',
              }),
            ),
          },
    agentSine: text(transaction.AgentSine) ?? '',
    agentPseudoCity: text(transaction.AgentPseudoCity),
    transactionDateTime,
    electronicDocument: flag(attribute(value, 'electronicDocument')),
    nonInteractive: flag(attribute(value, 'nonInteractive')),
    itineraryType: attribute(value, 'itineraryType'),
    automatedRefund: flag(attribute(value, 'automatedRefund')),
  });
}

function readTotals(report: XmlNode | undefined): DailySalesTotal[] {
  const amountOf = (value: unknown): { amount: string; count?: number } | undefined => {
    const amount = text(value);
    return amount === undefined ? undefined : defined<{ amount: string; count?: number }>({ amount, count: integer(attribute(value, 'count')) });
  };
  return asArray(report?.TotalDailySales).flatMap((total) => {
    const transactionType = text(node(total)?.TransactionType) ?? '';
    return asArray(node(total)?.SalesBySettlement).flatMap((settlement) => {
      const settlementType = text(node(settlement)?.SettlementType) ?? '';
      return asArray(node(settlement)?.SaleTotals).map((totals) => {
        const sale = node(totals);
        return defined<DailySalesTotal>({
          transactionType,
          settlementType,
          currencyCode: text(sale?.CurrencyCode),
          cash: amountOf(sale?.CashTotals),
          credit: amountOf(sale?.CreditTotals),
          commission: amountOf(sale?.CommissionTotals),
        });
      });
    });
  });
}

/**
 * Lee `DailySalesSummaryRS`. Un `Error` de `Header/Results` que no es `status="Incomplete"` lanza
 * `SabreBusinessError` con su código (`45100` Branch Access, `21212` versión…). `Incomplete` no
 * lanza: da `status: 'incomplete'` con `failedDocuments`. `isQueryStillRunning="true"` o un
 * `reportId` dan `status: 'deferred'`.
 */
export function parseDailySalesSummaryResponse(response: SoapResponse, fallbackPcc: string): DailySalesSummaryResult {
  const payload = response.payload;
  const errors = summaryErrors(payload);
  const fatal = errors.filter((error) => error.status?.toLowerCase() !== 'incomplete');
  const [first, ...rest] = fatal;
  if (first !== undefined) {
    throw new SabreBusinessError(`${DAILY_SALES_SUMMARY_SERVICE}: ${first.code} ${first.message}`.trim(), {
      service: DAILY_SALES_SUMMARY_SERVICE,
      code: first.code,
      raw: response.raw,
      errors: rest.map(
        (error) => new SabreBusinessError(`${DAILY_SALES_SUMMARY_SERVICE}: ${error.code} ${error.message}`.trim(), { service: DAILY_SALES_SUMMARY_SERVICE, code: error.code, raw: response.raw }),
      ),
    });
  }
  const incomplete = errors.filter((error) => error.status?.toLowerCase() === 'incomplete');

  const header = node(payload.DSHeader);
  const report = node(payload.DailySalesReport);
  const reportId = attribute(payload, 'reportId');
  const queryStillRunning = attribute(payload, 'isQueryStillRunning') === 'true';
  const deferred = reportId !== undefined || queryStillRunning;

  return defined<DailySalesSummaryResult>({
    status: deferred ? 'deferred' : incomplete.length > 0 ? 'incomplete' : 'complete',
    pcc: text(header?.PseudoCityCode) ?? fallbackPcc,
    agencyName: text(header?.AgencyName),
    reportDate: text(report?.ReportDate) ?? text(header?.ReportDate),
    transactions: asArray(report?.Transaction).map((transaction) => readTransaction(transaction, response)),
    totals: readTotals(report),
    failedDocuments: incomplete.length > 0 ? incomplete.flatMap((error) => failedDocumentsOf(error.message)) : undefined,
    deferred: deferred
      ? defined<NonNullable<DailySalesSummaryResult['deferred']>>({
          reportId,
          chunkNumber: integer(attribute(payload, 'chunkNumber')),
          maxChunks: integer(attribute(payload, 'maxChunks')),
          queryStillRunning,
        })
      : undefined,
    respondedAt: respondedAtField(response.raw).respondedAt,
  });
}

function malformed(detail: string, response: SoapResponse): SabreGatewayError {
  return new SabreGatewayError(`${DAILY_SALES_SUMMARY_SERVICE}: respuesta no reconocida (${detail})`, {
    protocol: 'soap',
    retryable: false,
    raw: response.raw,
  });
}
