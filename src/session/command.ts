// Send Sabre Command (`SabreCommandLLSRQ` 2.0.0): un comando de host dentro de la sesión, con la
// pantalla como texto crudo. Ver sabre-wiki/wiki/proyectos/sabre-client/decisiones/comandos-de-host.md
// (ADR-021) y wiki/entities/send-sabre-command.md. Request como `sabre-legacy-client@1.0.8` y el
// script de configuración de agencia del 2026-11-03.
import type { RequestOptions } from '../air/bargain-finder-max.js';
import { SabreGatewayError, type SabreWarning } from '../errors/index.js';
import { type SoapResponse, textOf, untrimmedPayload, xmlEscape } from '../http/soap-transport.js';
import type { SessionRequest } from './session.js';

export const SABRE_COMMAND_SERVICE = 'sabreCommand';
const NAMESPACE = 'http://webservices.sabre.com/sabreXML/2011/10';

/** Largo máximo de `HostCommand`, contado como Sabre (ver `sabreCommandLength`). */
export const MAX_COMMAND_LENGTH = 1023;
/** Caracteres que Sabre cuenta doble en el largo del comando. */
const DOUBLE_WIDTH = new Set(['!', '%', '$', '&', '¥', '§']);

export interface SabreCommandOptions extends RequestOptions {
  /**
   * `true` solo si el comando es una lectura (`W/PT¥*`, `DC¥…`): entra en la política de
   * reintentos. Por defecto `false`, porque el SDK no sabe si un comando cambia algo.
   */
  idempotent?: boolean;
}

export interface SabreCommandResponse {
  /**
   * La pantalla tal como la devuelve Sabre (`Response`), sin interpretar y sin recortar: las
   * pantallas van alineadas por columna y pueden empezar con un espacio (` 17MAR  WED…`). Recortar
   * es decisión de quien la lee. Un mensaje de host (`DUTY CODE 9 REQUIRED`, `FORMAT`) llega aquí:
   * no lanza.
   */
  text: string;
  /** Los `stl:Warning` de la respuesta. No lanzan. */
  warnings: SabreWarning[];
  /** `eb:MessageId` de la respuesta, el dato que pide soporte de Sabre. */
  messageId: string | undefined;
}

function fail(message: string): never {
  throw new TypeError(`sabre-client: ${message}`);
}

/** Cuerpo de `SabreCommandLLSRQ`: el comando va tal cual, escapado para XML y sin transformar. */
export function sabreCommandPayload(command: string): string {
  return `<SabreCommandLLSRQ xmlns="${NAMESPACE}" Version="2.0.0" ReturnHostCommand="true"><Request Output="SCREEN"><HostCommand>${xmlEscape(command)}</HostCommand></Request></SabreCommandLLSRQ>`;
}

/**
 * Lo único del comando que va al log: lo que está antes del primer `¥`, `‡` o espacio, cortado a
 * 4 caracteres (`W/PT`, `DC`, `*IM`, `SI9`). Un comando sin separador puede traer un localizador
 * o un nombre (`*ABC123`, `N-SMITH/JOHN`); el corte deja solo el principio.
 */
export function commandToken(command: string): string {
  return (command.trim().split(/[¥‡\s]/u)[0] ?? '').slice(0, 4);
}

/**
 * Largo del comando como lo cuenta Sabre: cada carácter vale 1, salvo `!`, `%`, `$`, `&`, `¥` y
 * `§`, que valen 2. Más de `MAX_COMMAND_LENGTH` y Sabre responde `REQUEST EXCEEDED MAXIMUM LENGTH`.
 */
export function sabreCommandLength(command: string): number {
  let length = 0;
  for (const char of command) length += DOUBLE_WIDTH.has(char) ? 2 : 1;
  return length;
}

/** Valida el comando y arma la request. Sin reintento salvo `idempotent: true`. */
export function sabreCommandRequest(command: string, options: SabreCommandOptions): SessionRequest {
  if (typeof command !== 'string' || command.trim() === '') fail('command es requerido y debe ser un string no vacío');
  const length = sabreCommandLength(command);
  if (length > MAX_COMMAND_LENGTH) {
    fail(`command mide ${length} y el máximo es ${MAX_COMMAND_LENGTH} (!, %, $, &, ¥ y § cuentan 2); Sabre respondería REQUEST EXCEEDED MAXIMUM LENGTH`);
  }
  const { idempotent = false, ...requestOptions } = options;
  if (typeof idempotent !== 'boolean') fail('idempotent debe ser un boolean');
  return {
    service: SABRE_COMMAND_SERVICE,
    action: 'SabreCommandLLSRQ',
    payload: sabreCommandPayload(command),
    idempotent,
    operation: 'command',
    ...requestOptions,
  };
}

/**
 * Lee `SabreCommandLLSRS`: solo la pantalla, los avisos y el `MessageId`. La pantalla sale de un
 * parseo sin recorte (`untrimmedPayload`), no del payload compartido. Sin `Response` la pantalla
 * queda vacía. Otro elemento en el `Body` es una respuesta que el SDK no entiende.
 */
export function parseSabreCommandResponse(response: SoapResponse): SabreCommandResponse {
  if (response.payloadName !== 'SabreCommandLLSRS') {
    throw new SabreGatewayError(`${SABRE_COMMAND_SERVICE}: respuesta no reconocida (${response.payloadName})`, {
      protocol: 'soap',
      status: response.status,
      retryable: false,
      raw: response.raw,
    });
  }
  return {
    text: textOf((untrimmedPayload(response.raw) ?? response.payload).Response) ?? '',
    warnings: response.warnings,
    messageId: response.messageId,
  };
}
