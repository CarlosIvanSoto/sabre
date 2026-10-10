// Redacción obligatoria antes de que cualquier dato llegue al logger.
// Ver sabre-wiki/wiki/sdk/configuracion-logging-y-build.md.

export const REDACTED = '[REDACTED]';

/**
 * Claves cuyo valor se enmascara completo, comparadas sin distinguir mayúsculas
 * ni separadores (`client_secret`, `Client-Secret` y `clientSecret` son la misma).
 */
const SENSITIVE_KEYS = new Set(
  [
    // Credenciales
    'clientSecret',
    'password',
    'username',
    'authorization',
    'binarySecurityToken',
    'accessToken',
    'refreshToken',
    'token',
    // Datos de pasajero
    'travelers',
    'passengers',
  ].map(normalizeKey),
);

function normalizeKey(key: string): string {
  return key.replace(/[-_\s]/g, '').toLowerCase();
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

/** Copia profunda de `value` con los campos sensibles enmascarados. No muta la entrada. */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet());
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));
  if (value instanceof Headers) return redactEntries(value.entries(), seen);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    // Los errores del SDK definen toJSON sin `raw`; para el resto, solo nombre y mensaje.
    const json = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() : undefined;
    return redactValue(json ?? { name: value.name, message: value.message }, seen);
  }
  return redactEntries(Object.entries(value), seen);
}

function redactEntries(entries: Iterable<[string, unknown]>, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(item, seen);
  }
  return out;
}
