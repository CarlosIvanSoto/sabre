// Logger inyectable. Ver sabre-wiki/wiki/sdk/configuracion-logging-y-build.md.
import { redact } from './redact.js';

/**
 * Interfaz mínima de logger, compatible con `winston` y `console`.
 * Con `pino`, que invierte el orden: `info: (m, c) => pino.info(c, m)`.
 */
export interface SabreLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export type SabreLogLevel = keyof SabreLogger;

/** Eventos estables que emite el SDK como `message`. */
export type SabreLogEvent =
  | 'sabre.request.start'
  | 'sabre.request.end'
  | 'sabre.request.retry'
  | 'sabre.auth.token.refresh'
  | 'sabre.auth.token.store';

/** Logger interno: redacta siempre el contexto y no hace nada si no hay logger. */
export class EventLogger {
  readonly #logger: SabreLogger | undefined;

  constructor(logger?: SabreLogger) {
    this.#logger = logger;
  }

  emit(level: SabreLogLevel, event: SabreLogEvent, context: Record<string, unknown> = {}): void {
    if (this.#logger === undefined) return;
    try {
      this.#logger[level](event, redact(context) as Record<string, unknown>);
    } catch {
      // Un logger que falla no debe romper la request en curso.
    }
  }
}
