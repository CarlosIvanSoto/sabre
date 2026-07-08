/**
 * Clase de error personalizada para los errores de la API de Sabre.
 * Extiende la clase Error nativa para proporcionar más contexto.
 */
export class SabreError extends Error {
  public readonly details: string;
  public readonly statusCode: number;

  constructor(message: string, statusCode: number, details: string) {
    super(message);
    this.name = 'SabreError';
    this.statusCode = statusCode;
    this.details = details;
  }
}