/**
 * Utilidades puras y genéricas compartidas por `createOAuthV2` y
 * `createOAuthV3`. Deliberadamente no incluye nada del *flujo* de
 * autenticación (encoding de credenciales, forma del request, manejo de
 * errores específico del endpoint) — eso se queda duplicado a propósito
 * en cada factory porque son detalles de dominio que difieren entre v2 y
 * v3, no accidentes de copy-paste.
 */

export function joinUrl(base: string, path: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  const prefixed = path.startsWith('/') ? path : `/${path}`;
  return `${trimmed}${prefixed}`;
}

export function tryParseJson(body: string): unknown {
  if (!body) return undefined;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
