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
Tier 2 del flujo de Air Booking, y el Tier 3 (sesiones SOAP y colas). Mientras tanto, `npm install sabre-client` instala `0.2.4`.

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

El Tier 3 agrega el cliente SOAP `SabreLegacy`, con una sesión stateful y Queue Management (ver
[Sesiones SOAP y colas](#sesiones-soap-y-colas-sabrelegacy)):

| Paso | Servicio | Método |
| - | - | - |
| Sesión | `SessionCreateRQ` 2.0.0 / 1.0.0, `OTA_PingRQ`, `SessionCloseRQ` | `legacy.withSession`, `legacy.openSession` |
| Colas | Get Queue Count, Access Queue, Place Queue Message | `session.queue.count`, `list`, `access`, `ignore`, `remove`, `place`, `exit`, `process` |
| Párrafo de cola | — (función pura) | `parseQueueParagraph`, `resolveHostDate` |

Planeado después de `0.3.0`: Get Ancillaries (solo NDC).

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

## Sesiones SOAP y colas (`SabreLegacy`)

`SabreLegacy` es el cliente de los servicios SOAP de Sabre. Recibe la misma `SabreConfig` que
`Sabre`. Usuario, PCC y domain de la sesión salen de `credentials.username`
(`V1:<user>:<PCC>:<domain>` o `<user>-<PCC>-<domain>`). La versión de `SessionCreateRQ` sale de
las credenciales: 2.0.0 con `clientId` y `clientSecret`, 1.0.0 sin ellos. Si pasas solo uno de los
dos, o un `username` que no está en ninguno de los dos formatos, se lanza un `TypeError` al crear
el cliente.

```ts
import { SabreLegacy } from 'sabre-client';

const legacy = new SabreLegacy({
  environment: 'production',
  authVersion: 'v2',
  credentials: { username: 'V1:<user>:<PCC>:AA', password: process.env.SABRE_EPR_PASSWORD! },
});

const counts = await legacy.withSession((session) => session.queue.count());
```

### Sesiones

- **`withSession(callback)` es la forma recomendada.** Abre una sesión, se la presta al callback y
  la cierra siempre, también si el callback lanza. Devuelve lo mismo que el callback. Si el cierre
  falla, registra `sabre.session.closeFailed` y conserva el resultado o el error del callback.
- **`openSession(options?)`** sirve para controlar tú la vida de la sesión. Se cierra con
  `try { … } finally { await session.close() }`. `close()` es idempotente. Si el runtime tiene
  `Symbol.asyncDispose`, también funciona `await using`, pero los tipos no lo declaran.
- **Una sesión es exclusiva.** Sabre no admite llamadas concurrentes en una misma sesión, así que
  una segunda llamada mientras otra está en vuelo lanza `TypeError: sabre-client: session busy`
  sin llamar a la red. Las llamadas después de `close()` lanzan `session closed`.
- **Inactividad.** Sabre documenta un timeout de 15 minutos de inactividad (en producción, las
  sesiones duraron más).
  `session.idleMs` es el tiempo desde la última respuesta de Sabre, y `session.ping()` lo
  reinicia. Con `openSession({ keepAlive: true })`, el SDK manda un ping a los 13 minutos de
  inactividad. Viene apagado, porque un timer no sobrevive entre invocaciones serverless o edge.
- **Sin pool, y sin reabrir sola.** Cada `withSession` abre y cierra una sesión. Después de un
  `SabreSessionError`, la sesión queda inutilizable: las llamadas siguientes lanzan
  `session unusable` sin red, y `close()` resuelve sin red. El SDK no la reabre, porque el cursor
  de la cola ya se perdió. Volver a empezar es decisión tuya.

### Colas

Las operaciones de cola están en `session.queue`. `pcc` es opcional en cada llamada, y por defecto
es el de la sesión. Una cola es un número de 0 a 511, o `{ name }` para las colas alfabéticas
(`QueueRef`). Las colas que devuelve `count` se pasan tal cual a las demás operaciones.

| Método | Servicio de Sabre | Devuelve |
| - | - | - |
| `count({ pcc? })` | `QueueCountLLSRQ` | `{ queues: [{ queue, count }], totals, countedAt, warnings }` |
| `list({ queue, pcc?, primaryPassenger? })` | `QueueAccessLLSRQ` (`List`) | `{ locators, entries, paragraph, warnings }`, sin entrar a la cola |
| `access({ queue, pcc?, selection? })` | `QueueAccessLLSRQ` | `QueueStep` |
| `ignore()` | `QueueAccessLLSRQ` (`I`) | `QueueStep` |
| `remove({ from? })` | `QueueAccessLLSRQ` (`QR`) | `QueueStep` |
| `place({ to, locators? })` | `QueuePlaceLLSRQ` | `QueueStep` dentro de una cola, `{ placements, text, warnings }` fuera |
| `exit()` | `QueueAccessLLSRQ` (`QXI`) | `void` |

```ts
type QueueStep =
  | { done: false; item: QueueItem; warnings: SabreWarning[] }
  | { done: true; reason: 'end-of-display' | 'empty'; message: string; warnings: SabreWarning[] };
```

- **El fin de cola es un resultado, no un error.** `END OF DISPLAY FOR REQUESTED DATA` da
  `{ done: true, reason: 'end-of-display' }`, y una cola vacía (`QUEUE SELECTED WAS EMPTY`) da
  `reason: 'empty'`. En los dos casos la sesión queda fuera de la cola. Cualquier otro error de
  Sabre se lanza como `SabreBusinessError`.
- **Las operaciones que avanzan devuelven el ítem siguiente**, así que no hace falta una llamada
  extra por PNR. Dentro de una cola, `place` mueve el PNR actual a las colas de destino y devuelve
  el siguiente.
- **El SDK lleva la cuenta de si la sesión está dentro de una cola** (`session.queue.state`:
  `'outside'`, `'inside'` o `'unknown'`). Fuera de una cola, `ignore`, `remove` y `exit` lanzan un
  `TypeError` sin llamar a la red. Lo mismo pasa con `access` estando dentro de una cola, y con
  `place` con `locators` dentro de una cola o en `'unknown'`. Si una operación falla
  dentro de una cola con un error que no es de sesión, el estado pasa a `'unknown'`, porque el SDK
  no sabe si Sabre dejó la sesión adentro. Para salir, llama a `exit()`: con `'unknown'`, tolera
  `CANNOT DO THIS IF OFF QUEUE`.
- **`place`**: dentro de una cola coloca el PNR actual. Con `locators` (hasta 6), coloca esos PNR
  desde fuera de una cola. Sin ninguno de los dos, coloca el PNR del AAA.
- **`instructionCode` (el PIC) es obligatorio en cada destino de `place`.** Tiene que estar en
  0–191 o 200–254. Producción rechaza un `place` sin PIC, aunque el design lo dé como opcional.
- **`QueueItem`** trae `locator`, el `placedAt` y el `placedBy` de `Line`, `primaryPassenger` y
  `group` cuando Sabre los manda, y `paragraph`: el PNR en formato de host, línea por línea y
  sin tocar. `placedAt` es el texto que llegó, con o sin año. `resolveHostDate` lo convierte en una
  fecha completa.
- `count` dentro de una cola no cuenta el PNR que está en pantalla.

### Recorrer una cola con `process`

`process` entra a la cola, llama a tu callback por cada PNR, ejecuta la acción que devuelve y
termina en el fin de cola. No hace nada que no se pueda hacer con las primitivas: cubre el caso
común y se asegura de que la sesión salga de la cola.

```ts
const result = await legacy.withSession((session) =>
  session.queue.process({ queue: 12, limit: 200 }, (item) => {
    if (isDone(item)) return { action: 'remove' };
    if (needsReview(item)) return { action: 'place', to: [{ queue: 50, instructionCode: 11 }] };
    return { action: 'ignore' };
  }),
);
// result: { visited: number; ended: 'end-of-display' | 'empty' | 'limit' }
```

- Al llegar a `limit`, sale de la cola con `QXI`. `limit` es opcional y no tiene tope por defecto,
  pero conviene pasarlo.
- Si el callback lanza, `process` sale de la cola con `QXI` y propaga el error. No lo convierte en
  `ignore`. Para seguir de largo, atrapa el error en el callback y devuelve `ignore`.

### Leer el párrafo

`parseQueueParagraph(item.paragraph, { referenceDate })` es una función pura aparte, que no corre
sola. Devuelve `{ messages, passengers, segments, ticketing, receivedFrom, unparsed }`: los avisos
de cola (`011  SEE REMARKS` → `{ instructionCode: 11, text: 'SEE REMARKS' }`), los nombres, los
segmentos con su estado, el campo de ticketing con una marca `issued` y la línea de recibido.

- **Es best effort.** El formato de host no tiene contrato. Una línea que el parser no reconoce va
  a `unparsed`, y el parser no lanza.
- **`referenceDate` es obligatorio.** Las fechas del host vienen sin año (`06SEP`), así que el año
  se resuelve contra esa fecha. Los segmentos y el ticketing toman la fecha más cercana dentro de
  ±6 meses, y la línea de recibido se resuelve hacia atrás. Las fechas salen como strings ISO sin
  zona horaria.
- No lee los plazos que las aerolíneas escriben como texto libre en remarks, SSR u OSI. Su formato
  lo pone cada aerolínea. El texto sigue en `paragraph`.

### Probar tu lógica de colas: `sabre-client/testing`

`sabre-client/testing` es una entrada aparte, con un fake de las sesiones y las colas de Sabre. No
forma parte del bundle principal. `createQueueFake` devuelve un `fetch` que pasas en
`config.fetch`, así que tu test pasa por el transporte, la sesión y el parseo reales del SDK, sin
red:

```ts
import { SabreLegacy } from 'sabre-client';
import { createQueueFake } from 'sabre-client/testing';

const fake = createQueueFake({
  queues: {
    '12': [
      [' 1.1DOE/JANE', ' 1 XX 123Y 15DEC 2 MEXCUN HK1', 'ABCD.ABCD*AAA 1200/01NOV26 AAAAAA H'],
      { locator: 'BBBBBB', paragraph: [' 1.1ROE/JOHN'] },
    ],
  },
});
const legacy = new SabreLegacy({ ...config, fetch: fake.fetch });

await legacy.withSession((session) => session.queue.process({ queue: 12 }, () => ({ action: 'remove' })));

fake.locators(12); // []
fake.openSessions; // 0: la sesión se cerró
```

- Cada PNR es un párrafo, con el localizador tomado de su línea de firma, o
  `{ locator, paragraph?, placedAt?, placedBy?, primaryPassenger? }`. A un párrafo sin línea de
  firma se le agrega una sintética. `pnrs` agrega PNR que no están en ninguna cola, para
  `place({ locators })`. El fake no tiene AAA: fuera de una cola, `place` necesita `locators`.
- Responde como producción: colas vacías, el fin de cola, `place` que mueve el PNR, el PIC
  obligatorio y una sesión vencida con `fake.expireSessions()`. `fake.calls` lista lo que pidió el
  SDK.
- **No simula** los PCC (las colas son las mismas para cualquier `pcc`) ni `selection`, que recibe
  un error en vez de la cola entera.
- `queueFixtures` trae las respuestas anonimizadas que se grabaron en producción (`walk`,
  `emptyQueue`, `place`…), como `{ operation, status, body }`.

`examples/queue-review.mjs` es un ejemplo completo, y su test lo corre contra el fake.

## Manejo de errores

Todos los errores que lanza el SDK extienden `SabreError`:

| Clase | Cuándo | Campos extra |
| - | - | - |
| `SabreGatewayError` | Falla HTTP o del gateway (`ERR.2SG.*`, `401`, `429`, `5xx`, errores de OAuth) | `protocol`, `status`, `code` |
| `SabreOrchestrationError` | Error de un servicio orquestado dentro de un `200` (`SP.*`) | `code` |
| `SabreBusinessError` | Error del catálogo propio de un servicio (p. ej. `No Availability`, una reserva que no se creó) | `service`, `code`, `warnings`, `errors` |
| `SabreSessionError` | Falla de la sesión SOAP de `SabreLegacy`, subclase de `SabreGatewayError` | `kind`: `'limit'` (más de 50 sesiones), `'invalid'`, `'expired'`, `'blocked'` |
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
`booking.create`, `booking.get` y `booking.cancel`), y toda operación de `SabreLegacy`, acepta un
callback `onRawResponse` en sus
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

En `SabreLegacy`, `protocol` es `'soap'`, `body` es el sobre SOAP completo, y `operation` es
`'openSession'`, `'close'`, `'ping'` o `'queue.<método>'`. El token de la sesión
(`BinarySecurityToken`) se reemplaza por `[REDACTED]` donde aparezca. No se cambia nada más.

> [!WARNING]
> `body` es la respuesta cruda y **trae datos de pasajeros**. El SDK nunca lo manda al logger.
> Dónde lo guardas es tu responsabilidad.

## Reintentos

Solo se reintentan las operaciones idempotentes: Bargain Finder Max y Revalidate Itinerary
(ambas son `POST` de solo lectura). Create Booking nunca se reintenta. Los reintentos usan
backoff exponencial con full jitter y un piso de 500 ms, ante `429`, `500`, `503`, `504`,
`SP.PROVIDER_ERROR` y los errores temporales del catálogo de Bargain Finder Max.

En `SabreLegacy`, `count`, `list` y `ping` son lecturas y se reintentan ante fallos transitorios.
Las operaciones que mueven el cursor de la cola (`access`, `ignore`, `remove`, `place`, `exit`) se
reintentan solo ante los `USG_*_BUSY`, que se toman como señal de que Sabre no procesó el request, y ante
`PREVIOUS ENTRY ACTIVE` (3 × 1 s). Nunca se reintentan después de un fallo de red, porque el PNR
pudo haberse movido: el estado de la cola pasa a `'unknown'`.

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
`sabre.auth.token.store`, `sabre.booking.seat.priced`, `sabre.session.open`,
`sabre.session.close`, `sabre.session.closeFailed`, `sabre.session.keepAliveFailed`,
`sabre.queue.exitTolerated`, `sabre.queue.exitFailed`) y nunca los bodies
crudos de request o response. Los secretos, el header `Authorization` y los datos de pasajeros
se redactan siempre antes de llegar a tu logger.

## Changelog

Ver [CHANGELOG.md](./CHANGELOG.md).
