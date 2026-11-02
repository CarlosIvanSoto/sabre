// Fechas de host sin año → strings ISO, con la regla del año. Ver
// sabre-wiki/wiki/sdk/tier-3-sesion-y-colas-soap.md (punto 3 y decisiones de la revisión).

/**
 * Cómo se elige el año cuando el texto no lo trae:
 *
 * - `'past'`: la fecha más reciente que no sea posterior a `referenceDate` (el mismo día cuenta).
 *   Es la regla de los hechos que ya pasaron: la línea de recibido, `placedAt` y `countedAt`.
 * - `'nearest'`: la fecha más cercana a `referenceDate`, hacia adelante o hacia atrás, dentro de
 *   ±6 meses. Es la regla de los segmentos y del plazo de ticketing (`T-`, `TAW`). Con un empate
 *   gana la fecha futura.
 */
export type HostDateDirection = 'past' | 'nearest';

export interface ResolveHostDateOptions {
  /** Regla del año. Por defecto `'past'`, la de `placedAt` y `countedAt`. */
  direction?: HostDateDirection;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const DAY_MS = 86_400_000;

/** Medio año, en días: la distancia más larga de una fecha a la referencia con `'nearest'`. */
const HALF_YEAR_DAYS = 184;

interface HostDate {
  year?: number;
  month: number;
  day: number;
  time?: string;
}

/**
 * Convierte una fecha de host en un string ISO sin zona horaria: `'YYYY-MM-DD'`, o
 * `'YYYY-MM-DDTHH:mm'` si el texto trae hora.
 *
 * Formatos que reconoce (sin distinguir mayúsculas, sin espacios a los costados):
 *
 * - `06SEP` y `06SEP26`, como en los segmentos, el ticketing y la línea de recibido;
 * - `12-21` y `12-21T07:00`, como el `DateTime` de `QueueCountRS`;
 * - `2024-05-15` y `2024-05-15T13:24`, como el `DateTime` de una línea de cola real.
 *
 * Si el texto trae año, se usa ese (un año de dos dígitos es del 2000 en adelante). Si no, el año
 * se resuelve contra `referenceDate` con la regla de `options.direction`.
 *
 * `referenceDate` es un `'YYYY-MM-DD'` (puede seguir una hora, que no se usa) o un `Date`, del que
 * se toma el día en UTC. Conviene pasar el día en el calendario del PCC: la regla compara días, y
 * con zonas distintas la referencia puede quedar un día corrida.
 *
 * Devuelve `undefined` si el texto no tiene un formato reconocido, si la fecha no existe
 * (`2026-02-29`, `31APR`) o si no hay un año que cumpla la regla (un `29FEB` sin un año bisiesto a
 * menos de 6 meses, con `'nearest'`). Lanza `TypeError` si `referenceDate` no es válida.
 */
export function resolveHostDate(
  text: string,
  referenceDate: Date | string,
  options: ResolveHostDateOptions = {},
): string | undefined {
  const reference = referenceDay(referenceDate);
  const direction = options.direction ?? 'past';
  if (direction !== 'past' && direction !== 'nearest') {
    throw new TypeError("sabre-client: direction debe ser 'past' o 'nearest'");
  }
  if (typeof text !== 'string') return undefined;

  const parsed = parseHostDate(text.trim().toUpperCase());
  if (parsed === undefined) return undefined;

  const year = parsed.year ?? resolveYear(parsed.month, parsed.day, reference, direction);
  if (year === undefined || !isValidDate(year, parsed.month, parsed.day)) return undefined;

  const date = `${pad(year, 4)}-${pad(parsed.month, 2)}-${pad(parsed.day, 2)}`;
  return parsed.time === undefined ? date : `${date}T${parsed.time}`;
}

function parseHostDate(text: string): HostDate | undefined {
  // 06SEP, 06SEP26
  let match = /^(\d{1,2})([A-Z]{3})(\d{2})?$/.exec(text);
  if (match !== null) {
    const month = MONTHS.indexOf(match[2]!) + 1;
    if (month === 0) return undefined;
    return {
      ...(match[3] !== undefined && { year: 2000 + Number(match[3]) }),
      month,
      day: Number(match[1]),
    };
  }

  // 12-21, 12-21T07:00, 2024-05-15, 2024-05-15T13:24
  match = /^(?:(\d{4})-)?(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(text);
  if (match === null) return undefined;
  const [, year, month, day, hours, minutes] = match;
  if (hours !== undefined && (Number(hours) > 23 || Number(minutes) > 59)) return undefined;
  return {
    ...(year !== undefined && { year: Number(year) }),
    month: Number(month),
    day: Number(day),
    ...(hours !== undefined && { time: `${hours}:${minutes}` }),
  };
}

/** Año que cumple la regla, o `undefined` si ninguno de los candidatos la cumple. */
function resolveYear(month: number, day: number, reference: number, direction: HostDateDirection) {
  const year = new Date(reference).getUTCFullYear();

  if (direction === 'past') {
    // Hacia atrás no hay ventana: un 29FEB puede caer hasta 8 años antes (con un 2100 en medio).
    for (let candidate = year; candidate >= year - 8; candidate--) {
      if (isValidDate(candidate, month, day) && dayNumber(candidate, month, day) <= reference) return candidate;
    }
    return undefined;
  }

  let best: { year: number; distance: number } | undefined;
  for (const candidate of [year + 1, year, year - 1]) {
    if (!isValidDate(candidate, month, day)) continue;
    const distance = Math.abs(dayNumber(candidate, month, day) - reference);
    // Los candidatos van del futuro al pasado: con un empate se queda el futuro.
    if (best === undefined || distance < best.distance) best = { year: candidate, distance };
  }
  return best !== undefined && best.distance <= HALF_YEAR_DAYS * DAY_MS ? best.year : undefined;
}

/**
 * El día de `referenceDate`, como milisegundos UTC de su medianoche. Lanza `TypeError` si no es
 * válida. Lo usa también el parser del párrafo, para validarla aunque el párrafo no traiga fechas.
 */
export function referenceDay(referenceDate: Date | string): number {
  if (referenceDate instanceof Date) {
    const time = referenceDate.getTime();
    if (Number.isNaN(time)) throw new TypeError('sabre-client: referenceDate es un Date inválido');
    return time - (((time % DAY_MS) + DAY_MS) % DAY_MS);
  }
  if (typeof referenceDate === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(referenceDate.trim());
    if (match !== null) {
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      if (isValidDate(year, month, day)) return dayNumber(year, month, day);
    }
  }
  throw new TypeError("sabre-client: referenceDate es obligatoria, como 'YYYY-MM-DD' o un Date válido");
}

function dayNumber(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}
