// Clasificación de errores de negocio en `groupedItineraryResponse.messages[]`, compartida por
// los servicios que responden con ese modelo (Bargain Finder Max, Revalidate Itinerary).
// Ver sabre-wiki/wiki/sdk/manejo-y-mapeo-de-errores.md.
import { SabreBusinessError, SabreError } from '../errors/index.js';
import type { ItineraryMessage } from './grouped-itinerary.js';

/** Entrada de catálogo: se compara por substring del `text`, sin distinguir mayúsculas. */
export interface ItineraryMessageCatalogEntry {
  code: string;
  retryable: boolean;
}

/**
 * Paso 3 del orden de detección: un mensaje con `severity: Error` en
 * `groupedItineraryResponse.messages[]` (respuesta 200) es un `SabreBusinessError`.
 *
 * En sandbox, los mensajes `Error` son genéricos (`No complete journey can be built…`,
 * `Error during Processing`) y el texto del catálogo llega en un mensaje `Info`
 * (`NO FLIGHT SCHEDULES FOR QUALIFIERS USED`). Por eso, cuando hay algún `Error`, el
 * catálogo se busca en el `text` de todos los mensajes.
 */
export function classifyItineraryMessages(
  body: unknown,
  service: string,
  catalog: ReadonlyArray<ItineraryMessageCatalogEntry>,
): SabreError | undefined {
  const response = isObject(body) ? body.groupedItineraryResponse : undefined;
  if (!isObject(response)) {
    return new SabreError(`${service}: respuesta malformada, falta groupedItineraryResponse`, {
      retryable: false,
      raw: body,
    });
  }
  const messages = Array.isArray(response.messages) ? (response.messages as Partial<ItineraryMessage>[]) : [];
  const error = messages.find((message) => message.severity?.toLowerCase() === 'error');
  if (error === undefined) return undefined;

  const match = findInCatalog(messages, catalog);
  const text = match?.text ?? (typeof error.text === 'string' ? error.text : '');
  const known = match?.entry;
  const code = known?.code ?? error.code ?? text;
  return new SabreBusinessError(`${service}: ${text || code}`, {
    service,
    code,
    retryable: known?.retryable ?? false,
    raw: body,
  });
}

function findInCatalog(
  messages: Partial<ItineraryMessage>[],
  catalog: ReadonlyArray<ItineraryMessageCatalogEntry>,
): { entry: ItineraryMessageCatalogEntry; text: string } | undefined {
  for (const message of messages) {
    if (typeof message.text !== 'string') continue;
    const text = message.text.toLowerCase();
    const entry = catalog.find((candidate) => text.includes(candidate.code.toLowerCase()));
    if (entry !== undefined) return { entry, text: message.text };
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
