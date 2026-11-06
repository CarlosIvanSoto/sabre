// El remark `QUEUE_PLACE` de Get Booking: dónde se colocó el PNR. Ver
// sabre-wiki/wiki/proyectos/sabre-client/decisiones/tier-4-colas-avanzadas.md (A4) y
// wiki/entities/booking-management-api.md (Q-090).
import { isInstructionCode } from './queue-place.js';
import { MAX_QUEUE_NUMBER } from './queue-ref.js';

/** Un remark `QUEUE_PLACE` ya separado en sus partes. */
export interface QueuePlaceRemark {
  /** El PCC de la cola, de 3 o 4 caracteres alfanuméricos (`'MEX'`, `'AB12'`). */
  pcc: string;
  /**
   * La fecha de la colocación, `DDMMM` sin año, tal cual llegó (`'25SEP'`). El año se resuelve con
   * `resolveHostDate(date, referenceDate)`.
   */
  date: string;
  /** El número de cola, de 0 a 511. */
  queue: number;
  /** El PIC (prefatory instruction code), de 0 a 191 o de 200 a 254. Llega con ceros a la izquierda. */
  pic: number;
}

const MONTHS = new Set(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']);

/**
 * `PCC` + `DDMMM` + cola + `/` + PIC, sin separadores: `MEX25SEP146/015`. El mes son las tres letras
 * que van antes de la cola, así que un PCC de 4 caracteres que termina en dígito (`AB1205JUL…`) no
 * se confunde con el día.
 */
const REMARK = /^([A-Z0-9]{3,4})(\d{2})([A-Z]{3})(\d{1,3})\/(\d{1,3})$/;

/**
 * Parsea el `text` de un remark `QUEUE_PLACE` de Get Booking (`remarks[].type === 'QUEUE_PLACE'`).
 * La forma salió de remarks reales de producción (Q-090): `MEX25SEP146/015` da
 * `{ pcc: 'MEX', date: '25SEP', queue: 146, pic: 15 }`.
 *
 * Devuelve `null` si el texto no tiene esa forma, o si el día no está entre 01 y 31, el mes entre
 * `JAN` y `DEC`, la cola entre 0 y 511, o el PIC en 0–191 o 200–254. No lanza: con un valor que no
 * es un string también devuelve `null`. Ignora los espacios a los costados. Sabre manda el texto en
 * mayúsculas, así que uno en minúsculas da `null`.
 */
export function parseQueuePlaceRemark(text: string): QueuePlaceRemark | null {
  if (typeof text !== 'string') return null;
  const match = REMARK.exec(text.trim());
  if (match === null) return null;
  const [, pcc, day, month, queueText, picText] = match as unknown as [string, string, string, string, string, string];
  const dayNumber = Number(day);
  if (dayNumber < 1 || dayNumber > 31 || !MONTHS.has(month)) return null;
  const queue = Number(queueText);
  const pic = Number(picText);
  if (queue > MAX_QUEUE_NUMBER || !isInstructionCode(pic)) return null;
  return { pcc, date: `${day}${month}`, queue, pic };
}
