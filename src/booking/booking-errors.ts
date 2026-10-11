// `errors[]` de la Booking Management API: mismo `Error` del spec en Create, Get y Cancel.
// Ver sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md.
import { SabreBusinessError, SabreWarning } from '../errors/index.js';

const WARNING = 'WARNING';

/** Elemento de `errors[]` tal cual lo manda Sabre (`Error` del spec; los avisos comparten forma). */
export interface BookingResponseError {
  /** `BAD_REQUEST`, `APPLICATION_ERROR`, `WARNING`, … */
  category: string;
  /** P. ej. `UNABLE_TO_BOOK_FLIGHTS`. */
  type: string;
  description?: string;
  fieldPath?: string;
  fieldName?: string;
  /** Puede traer datos del request (p. ej. un email): no se copia a los errores del SDK. */
  fieldValue?: string;
}

export function responseErrors(response: { errors?: BookingResponseError[] }): BookingResponseError[] {
  return Array.isArray(response.errors) ? response.errors.filter(isObject) as BookingResponseError[] : [];
}

export function isWarning(item: BookingResponseError): boolean {
  return typeof item.category === 'string' && item.category.toUpperCase() === WARNING;
}

export function toWarning(service: string, item: BookingResponseError): SabreWarning {
  return new SabreWarning(messageOf(service, item), { service, code: codeOf(item), raw: item });
}

export interface BusinessErrorAttachments {
  warnings?: SabreWarning[];
  errors?: SabreBusinessError[];
  retryable?: boolean;
}

export function toBusinessError(
  service: string,
  item: BookingResponseError,
  { warnings = [], errors = [], retryable = false }: BusinessErrorAttachments = {},
): SabreBusinessError {
  return new SabreBusinessError(messageOf(service, item), {
    service,
    code: codeOf(item),
    raw: item,
    warnings,
    errors,
    retryable,
  });
}

export function codeOf(item: BookingResponseError): string {
  return typeof item.type === 'string' && item.type !== '' ? item.type : String(item.category);
}

/** Sin `fieldValue`, que puede traer datos del pasajero; queda en `raw`. */
function messageOf(service: string, item: BookingResponseError): string {
  const where = typeof item.fieldPath === 'string' && item.fieldPath !== '' ? ` en ${item.fieldPath}` : '';
  const description = typeof item.description === 'string' && item.description !== '' ? `: ${item.description}` : '';
  return `${service}: ${String(item.category)} ${codeOf(item)}${where}${description}`;
}

export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
