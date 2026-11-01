# sabre-client

SDK de TypeScript para las APIs de Sabre.

[Read in English](./README.md)

> **`0.3.0` es una reescritura completa, no una actualización incremental de `0.2.4`.**
> Tiene otra arquitectura: un cliente REST `Sabre` con un `AuthManager` que gestiona el token,
> una jerarquía de errores tipada, un logger inyectable con redacción obligatoria y solo Web
> Standard APIs, para correr en cualquier runtime de servidor. El código escrito para `0.2.4`
> no funciona sin cambios. Las versiones anteriores siguen publicadas tal como están.

## Estado

`0.3.0` **todavía no está publicada**. Se publica cuando estén terminados el Tier 1 y el
Tier 2 del flujo de Air Booking. Mientras tanto, `npm install sabre-client` instala `0.2.4`.

Las prereleases de la reescritura se publican con el tag `next`:

```sh
npm install sabre-client@next
```

La API todavía puede cambiar antes de `0.3.0`.

El Tier 1 cubre el flujo básico de Air Booking por REST:

| Paso | Servicio | Método |
| - | - | - |
| Autenticación | OAuth Token Create v3 / v2 | automática |
| Búsqueda | Bargain Finder Max v5 | `sabre.air.bargainFinderMax` |
| Revalidación | Revalidate Itinerary v5 | `sabre.air.revalidateItinerary` |
| Reserva | Create Booking (Booking Management API v1, ATPCO por `flightDetails`) | `sabre.booking.create` |
| Gestión de la reserva | Get Booking y Cancel Booking (Booking Management API v1) | `sabre.booking.get`, `sabre.booking.cancel` |

El Tier 2 agrega la elección de asiento:

| Paso | Servicio | Método |
| - | - | - |
| Mapa de asientos | Get Seats v3 (`byReservationPayload` y `byPnrLocator`) | `sabre.air.getSeats` |

Planeado después de `0.3.0`: Get Ancillaries (solo NDC) y un cliente `SabreLegacy` para los
servicios SOAP.

## Requisitos

- Node.js `>=22.12`, o un runtime edge de servidor con `fetch` y `crypto.subtle`
  (Cloudflare Workers, Vercel Edge Functions, Deno Deploy). El paquete usa solo Web Standard
  APIs.
- Solo ESM.
- **Nunca lo corras en un navegador.** Tus credenciales de Sabre quedarían expuestas a
  cualquiera con las devtools.

## Configuración

El SDK nunca lee variables de entorno. La configuración se pasa explícitamente:

```ts
import { Sabre } from 'sabre-client';

const sabre = new Sabre({
  environment: 'sandbox', // 'sandbox' (CERT) o 'production'
  credentials: {
    clientId: process.env.SABRE_CLIENT_ID!,
    clientSecret: process.env.SABRE_CLIENT_SECRET!,
    username: process.env.SABRE_EPR_USERNAME!, // usuario EPR, p. ej. `<user>-<PCC>-AA`
    password: process.env.SABRE_EPR_PASSWORD!,
  },
});
```

| Opción | Default | Descripción |
| - | - | - |
| `environment` | requerido | `'sandbox'` → `api.cert.platform.sabre.com`, `'production'` → `api.platform.sabre.com` |
| `authVersion` | `'v3'` | Versión de OAuth Token Create. `'v3'` necesita `clientId`, `clientSecret`, `username` y `password`; `'v2'` solo el `username` EPR (`V1:<user>:<PCC>:AA`) y el `password` |
| `credentials` | requerido | Ver arriba |
| `logger` | ninguno | Cualquier objeto con `debug`, `info`, `warn` y `error` (ver [Logging](#logging)) |
| `retry` | `{ maxRetries: 3, baseDelayMs: 500 }` | Política de reintentos del cliente; cada request puede pisarla |
| `fetch` | `fetch` global | `fetch` propio (proxies, tests, otros runtimes) |
| `tokenStore` | solo en memoria | Comparte el token entre procesos (ver [Reutilizar el token](#reutilizar-el-token)) |

### Autenticación

Nunca pides el token tú. El cliente lo obtiene en la primera llamada, lo cachea, lo renueva
alrededor de una hora antes de que expire y comparte una sola petición en vuelo entre llamadas
concurrentes. Si Sabre rechaza un token con `401`, el cliente obtiene uno nuevo y reintenta esa
request una vez.

## Reservar un vuelo

El flujo completo del Tier 1: buscar, revalidar el itinerario elegido y reservarlo.

```ts
import { Sabre, buildRevalidateItineraryRequest, buildBookingFlightDetails } from 'sabre-client';

const sabre = new Sabre({ environment: 'sandbox', credentials });

// 1. Buscar con Bargain Finder Max. El request es el body que documenta Sabre.
const search = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: { Source: [{ PseudoCityCode: 'XXXX', RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] },
    OriginDestinationInformation: [
      { DepartureDateTime: '2026-12-01T10:00:00', OriginLocation: { LocationCode: 'DFW' }, DestinationLocation: { LocationCode: 'LAX' } },
    ],
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }] }] },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  },
};
const found = await sabre.air.bargainFinderMax(search);

// Las respuestas llegan con las referencias ya resueltas: cada itinerario trae sus tramos,
// horarios y tarifas en línea, sin tener que buscar por `ref`.
const group = found.itineraryGroups[0]!;
const itinerary = group.itineraries[0]!;

// 2. Revalidar el itinerario elegido (disponibilidad y precio, sin retener inventario).
const revalidated = await sabre.air.revalidateItinerary(
  buildRevalidateItineraryRequest({ search, group, itinerary }),
);
const confirmedGroup = revalidated.itineraryGroups[0]!;
const confirmed = confirmedGroup.itineraries[0]!;

// 3. Reservarlo por el camino ATPCO (`flightDetails`).
const booking = await sabre.booking.create({
  flightDetails: buildBookingFlightDetails({ group: confirmedGroup, itinerary: confirmed }),
  travelers: [{ givenName: 'JANE', surname: 'DOE', passengerCode: 'ADT' }],
  contactInfo: { emails: ['jane@example.com'], phones: ['5550000000'] },
});

console.log(booking.confirmationId); // localizador del PNR
```

`buildBookingFlightDetails` convierte el itinerario revalidado en el bloque `flightDetails` de
Create Booking. Sabre no documenta ese mapeo y todavía no se comprobó con una reserva real en
sandbox, así que revisa el request antes de depender de él.

`sabre.booking.create` **nunca se reintenta automáticamente**, porque no es idempotente. Si
Sabre crea la reserva con avisos o errores no fatales, la llamada no lanza: revisa
`booking.warnings` y `booking.errors`.

`sabre.booking.get` lee una reserva por `confirmationId`. A diferencia de Create Booking, la
respuesta trae los campos de la reserva en el primer nivel (`bookingId`, `flights`,
`travelers`, …), tal como la define Sabre. Usa `returnOnly` para pedir solo las secciones que
necesitas; además, la llamada es más rápida:

```ts
const pnr = await sabre.booking.get({
  confirmationId: booking.confirmationId,
  returnOnly: ['FLIGHTS', 'TRAVELERS'],
});
```

Solo lanza `SabreBusinessError` si no hay reserva (por ejemplo, `BOOKING_NOT_FOUND`). Si la
reserva existe, los problemas parciales vuelven en `pnr.warnings` y `pnr.errors`; una reserva
sin emitir suele traer el aviso `RESOURCE_UNAVAILABLE` porque todavía no tiene fare rules. Es
una lectura, así que los fallos transitorios se reintentan.

`sabre.booking.cancel` cancela la reserva entera (`cancelAll: true`) o productos concretos por
el `itemId` que devuelve `get`:

```ts
await sabre.booking.cancel({ confirmationId: booking.confirmationId, cancelAll: true });
await sabre.booking.cancel({ confirmationId: pnr.bookingId, flights: [{ itemId: '2' }] });
```

Como `create`, **nunca se reintenta automáticamente**. Las combinaciones que Sabre siempre
rechaza (`cancelAll` junto con listas, ni `cancelAll` ni listas, `offerItemId` junto con
`flightTicketOperation`) lanzan un `TypeError` antes de enviar nada. Si Sabre responde
`NO_ITEMS_CANCELLED`, la llamada lanza `SabreBusinessError` aunque Sabre lo mande como aviso,
porque no se canceló nada; los errores que explican el motivo están en `error.errors`. El aviso
`END_TRANSACTION_PROBLEM` significa que la confirmación sigue pendiente: verifica el resultado
con `sabre.booking.get`.

Toda request acepta un `AbortSignal`. Las búsquedas aceptan además una política de reintentos
propia:

```ts
await sabre.air.bargainFinderMax(search, { signal, retry: { maxRetries: 1 } });
```

## Elegir un asiento

`sabre.air.getSeats` devuelve el mapa de asientos con disponibilidad y precio. Es una sola
función para los dos endpoints de Get Seats: sin `pnrLocator` va a `byReservationPayload`
(antes de reservar), y con `pnrLocator` va a `byPnrLocator` (un PNR ya creado).

Antes de reservar, arma el request desde el itinerario revalidado con
`buildSeatAvailabilityRequest`, elige un asiento y pásalo a `buildBookingFlightDetails`:

```ts
import { buildBookingFlightDetails, buildSeatAvailabilityRequest } from 'sabre-client';

// Después del paso 2 de "Reservar un vuelo": `confirmedGroup` y `confirmed`.
const seatMap = await sabre.air.getSeats(
  buildSeatAvailabilityRequest({ group: confirmedGroup, itinerary: confirmed, currencyCode: 'USD' }),
);

// seatMaps[].segmentRef es S1, S2, … en el orden del itinerario. `occupationStatusCode: 'F'` es
// un asiento libre; uno con `offerItemRefIds` puede tener precio (offerItems[].priceDefinitionRef
// → priceDefinitions[]). Acá: el primer asiento libre del primer vuelo sin offer item.
const rows = seatMap.response.seatMaps
  .filter((map) => map.segmentRef === 'S1')
  .flatMap((map) => map.cabinCompartments ?? [])
  .flatMap((cabin) => cabin.seatRows ?? []);
const seat = rows
  .flatMap((row) => row.seats.map((s) => ({ number: `${row.row}${s.column}`, ...s })))
  .find((s) => s.occupationStatusCode === 'F' && (s.offerItemRefIds ?? []).length === 0);

const booking = await sabre.booking.create({
  flightDetails: buildBookingFlightDetails({
    group: confirmedGroup,
    itinerary: confirmed,
    // Los dos índices empiezan en 1: primer vuelo del itinerario, primer viajero.
    seats: seat === undefined ? [] : [{ segmentIndex: 1, travelerIndex: 1, number: seat.number }],
    seatAvailability: seatMap,
  }),
  travelers: [{ givenName: 'JANE', surname: 'DOE', passengerCode: 'ADT' }],
  contactInfo: { emails: ['jane@example.com'], phones: ['5550000000'] },
});
```

Para una reserva que ya existe, pide el mapa por localizador:

```ts
const pnrSeats = await sabre.air.getSeats({ pnrLocator: booking.confirmationId! });
```

A tener en cuenta:

- **El asiento se reserva por número, solo por ATPCO.** Va en `flightDetails.flights[].seats[]`
  (`BookSeat`). `seatOffers` y el `offerId` de Get Seats son solo NDC y no están soportados.
  El helper tampoco soporta `areaPreferences` ni `changeOfGaugeSeats`.
- **Mejor asientos sin cargo.** No se sabe qué hace Sabre con un asiento cobrable pedido por
  número por ATPCO. Si pasas `seatAvailability` y el asiento elegido tiene precio,
  `sabre.booking.create` registra el aviso `sabre.booking.seat.priced` (segmento, vuelo,
  asiento, monto y moneda, sin datos del pasajero) y reserva igual.
- **Validación local.** Un número de asiento que no cumple `^[0-9]+[A-Z]$`, un `segmentIndex` o
  `travelerIndex` que no existe, o un `pnrLocator` vacío o mezclado con campos del payload
  (`segments`, `passengers`, `returnSeatMapsOnlyForSegmentRefs`) lanzan `TypeError` antes de
  enviar la request.
- **Errores.** Get Seats no tiene catálogo de errores publicado. Un `errors[]` sin mapa lanza
  `SabreBusinessError` no reintentable; con mapa, los errores y los `warnings[]` vuelven en
  `seatMap.errors` y `seatMap.warnings`. Los dos endpoints son de lectura, así que los `429` y
  `5xx` del gateway se reintentan.
- **Qué está comprobado.** `byReservationPayload` se probó en producción, en solo lectura, con
  un vuelo directo y una conexión. `byPnrLocator` y la reserva con asiento todavía no se
  probaron contra Sabre. Los precios llegan como número aunque el spec diga string, así que
  los tipos aceptan los dos.

## Manejo de errores

Todos los errores que lanza el SDK extienden `SabreError`:

| Clase | Cuándo | Campos extra |
| - | - | - |
| `SabreGatewayError` | Falla HTTP o del gateway (`ERR.2SG.*`, `401`, `429`, `5xx`, errores de OAuth) | `protocol`, `status`, `code` |
| `SabreOrchestrationError` | Error de un servicio orquestado dentro de un `200` (`SP.*`) | `code` |
| `SabreBusinessError` | Error del catálogo propio de un servicio (p. ej. `No Availability`, una reserva que no se creó) | `service`, `code`, `warnings`, `errors` |
| `SabreWarning` | Aviso no fatal (p. ej. `category: WARNING` en Create Booking) | `service`, `code` |

Todos tienen `retryable`, que indica si la política de reintentos puede volver a intentar.

```ts
import { SabreBusinessError, SabreGatewayError } from 'sabre-client';

try {
  await sabre.booking.create(request);
} catch (error) {
  if (error instanceof SabreBusinessError) {
    console.error(error.service, error.code, error.message);
  } else if (error instanceof SabreGatewayError) {
    console.error(error.status, error.code);
  }
  throw error;
}
```

> [!WARNING]
> `SabreError.raw` guarda el fragmento original de la respuesta, sin tocar, para debugging.
> **Puede contener credenciales o datos de pasajeros.** No es enumerable, así que no aparece en
> `JSON.stringify` ni en un spread, pero sigue accesible como `error.raw`. Nunca lo mandes a un
> logger, a un tracker de errores ni a un servicio de monitoreo sin sanitizarlo antes.

## Respuesta cruda

Toda operación REST (`air.bargainFinderMax`, `air.revalidateItinerary`, `air.getSeats`,
`booking.create`, `booking.get` y `booking.cancel`) acepta un callback `onRawResponse` en sus
opciones, junto a `signal`. Recibe la respuesta de Sabre tal cual llegó, por ejemplo para
guardarla junto al resultado tipado. En `air.getSeats`, `operation` indica el endpoint que se
llamó (`air.getSeatsByPayload` o `air.getSeatsByPnrLocator`):

```ts
import type { SabreRawResponse } from 'sabre-client';

let raw: SabreRawResponse | undefined;
const booking = await sabre.booking.get({ confirmationId }, { onRawResponse: (r) => (raw = r) });
// raw: { operation: 'booking.get', protocol: 'rest', status, headers, body, attempts }
```

- Se llama **una vez**, con el último intento HTTP, antes de que la operación devuelva o lance.
  También se llama cuando la operación lanza `SabreBusinessError` (un `200` con `errors[]`) o
  `SabreGatewayError` (un no `2xx`). Si hubo reintentos, `attempts` cuenta todos los intentos HTTP.
- No se llama si ningún intento tuvo respuesta HTTP (error de red, abort), ni con las llamadas de
  token. Tras un `401`, recibe la respuesta del reintento con el token nuevo.
- Es síncrono y su retorno se ignora. Si lanza, el SDK lo atrapa, registra
  `sabre.request.rawResponseHookFailed` sin el body y la operación sigue: un callback que falla
  nunca hace que `booking.create` pierda su `confirmationId`. Para guardar de forma asíncrona,
  conserva el valor y escríbelo cuando la llamada vuelva.

> [!WARNING]
> `body` es la respuesta cruda y **trae datos de pasajeros**. El SDK nunca lo manda al logger.
> Dónde lo guardas es tu responsabilidad.

## Reintentos

Solo se reintentan las operaciones idempotentes: Bargain Finder Max y Revalidate Itinerary
(ambas son `POST` de solo lectura). Create Booking nunca se reintenta. Los reintentos usan
backoff exponencial con full jitter y un piso de 500 ms, ante `429`, `500`, `503`, `504`,
`SP.PROVIDER_ERROR` y los errores temporales del catálogo de Bargain Finder Max.

## Reutilizar el token

Por defecto el token vive en memoria, uno por instancia de `Sabre`. Para compartirlo entre
procesos (scripts, funciones serverless), pasa un `tokenStore`. El SDK no trae ninguna
implementación:

```ts
import type { SabreTokenStore } from 'sabre-client';

const tokenStore: SabreTokenStore = {
  async get(key) {
    return JSON.parse((await kv.get(key)) ?? 'null') ?? undefined;
  },
  async set(key, token) {
    await kv.put(key, JSON.stringify(token));
  },
};
```

`key` identifica el entorno, la versión de OAuth y un hash de la identidad de la credencial,
así que un mismo store sirve a varios clientes. No contiene secretos, pero el token guardado sí
lo es: protegerlo te toca a ti. Si `get` o `set` lanzan, el SDK sigue con su caché en memoria.

## Logging

No hay logging salvo que pases un `logger`. Es compatible con `console` y `winston`; con `pino`,
invierte los argumentos:

```ts
const sabre = new Sabre({
  environment: 'sandbox',
  credentials,
  logger: {
    debug: (m, c) => pino.debug(c, m),
    info: (m, c) => pino.info(c, m),
    warn: (m, c) => pino.warn(c, m),
    error: (m, c) => pino.error(c, m),
  },
});
```

El SDK registra eventos estructurados (`sabre.request.start`, `sabre.request.end`,
`sabre.request.retry`, `sabre.request.rawResponseHookFailed`, `sabre.auth.token.refresh`,
`sabre.auth.token.store`, `sabre.booking.seat.priced`) y nunca los bodies
crudos de request o response. Los secretos, el header `Authorization` y los datos de pasajeros
se redactan siempre antes de llegar a tu logger.

## Changelog

Ver [CHANGELOG.md](./CHANGELOG.md).
