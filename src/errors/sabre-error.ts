/**
 * Clase base para todos los errores que lanza este cliente.
 *
 * Atrapar `SabreError` atrapa cualquier categoría de error que el cliente
 * pueda lanzar. Para manejo condicional más específico, usar `instanceof`
 * con una de las subclases (`SabreApiResponseError`,
 * `SabreAuthenticationError`, `SabreNetworkError`, `SabreTimeoutError`,
 * `SabreParseError`).
 *
 * `statusCode`/`details` se mantienen aquí (en vez de solo en las
 * subclases) por compatibilidad con el `new SabreError(message, statusCode,
 * details)` que ya usaba este paquete antes de la jerarquía; son opcionales
 * porque no todas las subclases (p.ej. `SabreNetworkError`) tienen un
 * status HTTP que reportar. `cause` (opción estándar de `Error`) preserva
 * la causa real sin filtrar su tipo en la firma pública.
 */
export class SabreError extends Error {
  public readonly statusCode?: number;
  public readonly details?: string;

  constructor(message: string, statusCode?: number, details?: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SabreError';
    this.statusCode = statusCode;
    this.details = details;
  }
}
