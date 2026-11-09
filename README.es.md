# sabre-client

SDK de TypeScript para las APIs de Sabre.

[Read in English](./README.md)

> **`0.3.0` es una reescritura completa, no una actualización incremental de `0.2.4`.**
> Tiene otra arquitectura: un cliente REST `Sabre` con un `AuthManager` que gestiona el token,
> una jerarquía de errores tipada, un logger inyectable con redacción obligatoria y solo Web
> Standard APIs, para correr en cualquier runtime de servidor. El código escrito para `0.2.4`
> no funciona sin cambios. Las versiones anteriores siguen publicadas tal como están.

## Estado

La `0.5.1` está publicada con el dist-tag `next` mientras se prueba; `latest` sigue en la `0.4.1`.
Cubre el Tier 1 y el Tier 2 del flujo de Air Booking por REST, el Tier 3 (sesiones SOAP y colas) y
el Tier 4: actividad de colas, historial del PNR, la cola de mensajes `S`, `selection` en `list` y
`onRawRequest`. La línea `0.5` trae tres cambios incompatibles (ver
[Actualizar desde la 0.4](#actualizar-desde-la-04)).

```sh
npm install sabre-client@next   # 0.5.1
npm install sabre-client        # 0.4.1
```

El paquete sigue en `0.x`: una versión minor puede traer cambios incompatibles, y el
[CHANGELOG](./CHANGELOG.md) los marca.

### Actualizar desde la 0.4

- **`pcc` ya no está en la config.** Pasarlo a `new Sabre` o a `new SabreLegacy` da un error de
  tipos, y en JavaScript se ignora. El PCC con el que te autenticas va en `credentials` (ver
  [Credenciales](#credenciales)); otro PCC se pasa en cada operación, como `targetPcc` en REST o
  `pcc` en las operaciones de colas.
- **`QueueRef` puede ser un `string`.** Una cola alfabética como `'S'` es `'S'`, y `count` y
  `place` la devuelven así en lugar de `{ name: 'S' }`. El código que hace
  `typeof q === 'number' ? … : q.name` tiene que manejar el caso `string`.
- **Un `QueueStep` que no terminó tiene `kind`.** Revisa `step.kind === 'pnr'` antes de leer
  `step.item`; `kind: 'message'` trae un mensaje de la cola `S`.

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
| Colas | Get Queue Count, Get Queue Activity, Access Queue, Place Queue Message | `session.queue.count`, `activity`, `list`, `access`, `ignore`, `remove`, `place`, `exit`, `process` |
| Párrafo de cola | — (función pura) | `parseQueueParagraph`, `parseQueuePlaceRemark`, `resolveHostDate` |
| Historial del PNR | `TravelItineraryHistoryLLSRQ` 2.4.0 | `session.reservation.history` |
| Comandos de host | `SabreCommandLLSRQ` 2.0.0 | `session.command` |

Planeado después de `0.5.0`: Get Ancillaries (solo NDC).

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
    username: '<user>-<PCC>-AA', // usuario EPR ya armado (ver Credenciales abajo)
    password: process.env.SABRE_PASSWORD!,
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

### Credenciales

Hay **un solo juego de credenciales** para REST y SOAP: el mismo objeto `credentials` sirve para
`Sabre` y para `SabreLegacy`. Trae el usuario EPR, su PCC y su domain, el password del EPR y, de
forma opcional, el `clientId`/`clientSecret` de la app. La versión de OAuth solo cambia cómo se
escribe el `username` del EPR: `<user>-<PCC>-<domain>` (v3) o `V1:<user>:<PCC>:<domain>` (v2).

`buildCredentials` arma ese objeto a partir de las partes, así que no necesitas conocer ninguno de
los dos formatos. No lee variables de entorno y lanza un `TypeError` si algo no es válido:

```ts
import { Sabre, SabreLegacy, buildCredentials } from 'sabre-client';

const credentials = buildCredentials({
  authVersion: 'v3', // por defecto; 'v2' → `V1:<user>:<PCC>:<domain>`
  user: process.env.SABRE_USERNAME!, // solo el usuario EPR
  pcc: process.env.SABRE_PCC!, // el PCC al que pertenece el EPR
  domain: process.env.SABRE_DOMAIN || undefined, // 'AA' por defecto
  password: process.env.SABRE_PASSWORD!,
  clientId: process.env.SABRE_CLIENT_ID!, // obligatorio con v3; con v2, los dos o ninguno
  clientSecret: process.env.SABRE_CLIENT_SECRET!,
});

const sabre = new Sabre({ environment: 'sandbox', credentials });
const legacy = new SabreLegacy({ environment: 'sandbox', credentials });
```

El objeto que devuelve `buildCredentials` lleva su `authVersion`, así que la config no necesita
repetirlo: con `authVersion: 'v2'` en `buildCredentials`, `{ environment, credentials }` ya es una
config v2. Si también pasas `authVersion` en la config, tiene que coincidir; si no, el cliente lanza
un `TypeError`. Las credenciales que armas a mano no llevan `authVersion`, así que con v2 la config
sigue necesitando `authVersion: 'v2'`. Si la versión solo se conoce en runtime (por ejemplo, leída
de una variable de entorno a un `BuildCredentialsOptions`), el resultado de `buildCredentials`
también va directo a la config, sin `authVersion` en ella.

El PCC de las credenciales es con el que te autenticas. Trabajar en otro PCC no requiere otro
juego de credenciales: se pasa en cada operación, como `targetPcc` en `booking.create`, `get` y
`cancel`, o como `pcc` en las operaciones de colas.

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
- **`byPnrLocator` solo lee PNR del PCC con el que te autenticas.** Su request no tiene
  `targetPcc`, a diferencia de Create, Get y Cancel Booking. Si la reserva se creó con
  `targetPcc` en otro PCC, Sabre responde `502` con `Viewership is restricted for the PNR`,
  que llega como `SabreGatewayError`.
- **Qué está comprobado.** `byReservationPayload` se probó en producción, en solo lectura, con
  un vuelo directo y una conexión. La reserva con asiento se probó en sandbox: el asiento llega
  al PNR y `sabre.booking.get` lo devuelve en `flights[].seats[]`. `byPnrLocator` se probó en
  sandbox con una reserva hecha en el PCC con el que te autenticas: devuelve el mapa de los
  segmentos del PNR, con ids propios de Sabre para pasajero y segmento (`pnr_pax_1`,
  `segment_ancs_1`) en lugar de `P1` y `S1`. En sandbox ninguno de los dos endpoints refleja la
  ocupación: todos los asientos vienen en `F`, también el que tiene el PNR. Los precios llegan
  como número aunque el spec diga string, así que los tipos aceptan los dos.

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
  credentials: { username: 'V1:<user>:<PCC>:AA', password: process.env.SABRE_PASSWORD! },
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

### Comandos de host

`session.command(command, options?)` manda un comando de host de Sabre (`SabreCommandLLSRQ` 2.0.0)
dentro de la sesión y devuelve la pantalla como texto. **Es una vía de escape**, sin tipos ni
garantías: el SDK no interpreta la pantalla, y un comando puede cambiar la configuración del PCC o
emitir boletos. El SDK no tiene una lista de comandos permitidos o bloqueados.

```ts
const screen = await legacy.withSession((session) => session.command('W/PT¥*', { idempotent: true }));
// screen.text      → 'PSGR TYPE - ON' (como lo manda Sabre, sin recortar)
// screen.warnings  → los stl:Warning, si los hay
// screen.messageId → eb:MessageId, para soporte de Sabre
// screen.respondedAt → eb:Timestamp en UTC, p. ej. '2026-11-06T17:34:16Z'
```

- **El comando va tal cual.** En este servicio, el separador `‡` de Sabre se escribe `¥`
  (`W/PT‡*` en Sabre Red es `W/PT¥*` aquí); el SDK no lo convierte.
- **La pantalla no se recorta.** Las pantallas del host van alineadas por columna y pueden empezar
  con un espacio (` 17MAR  WED…`), así que `text` es el contenido de `Response` tal cual. Si
  necesitas recortarla, hazlo tú.
- **Hasta 1023 caracteres, contados como Sabre:** `!`, `%`, `$`, `&`, `¥` y `§` cuentan 2. Un
  comando más largo lanza un `TypeError` sin llamar a la red (Sabre respondería
  `REQUEST EXCEEDED MAXIMUM LENGTH`).
- **Sabre bloquea algunos comandos por su cuenta** (`SO`, `/@`, `¤¤`, según su whitelist), aunque
  el SDK no tenga una lista propia.
- **Algunos comandos cuestan más.** `JR` y `WPNI` cuentan como búsquedas "Worldfare".
- **Las máscaras del host** se responden con los dos primeros caracteres de la máscara.
- **Prefiere una API estructurada.** Sabre pide no usar este servicio para lo que ya tiene una:
  si el SDK tiene una operación para eso, úsala.
- **Sin reintentos por defecto**, porque el SDK no distingue una lectura de un cambio. Pasa
  `{ idempotent: true }` en los comandos de solo lectura y siguen la
  [política de reintentos](#reintentos).
- **Un mensaje del host no es un error.** `DUTY CODE 9 REQUIRED` o `FORMAT` llegan en `text`. Un
  SOAP fault o un `stl:Error` lanzan, como en cualquier otra llamada de la sesión.
- Los comandos que dependen de la misma firma (`SI9` y luego `W/PT¥ON`) tienen que ir en la misma
  sesión.
- El log de debug (`sabre.session.command`) lleva solo el primer token del comando, cortado a 4
  caracteres (`W/PT`, `DC`, `*IM`), nunca el comando entero ni la pantalla. La respuesta completa
  está disponible en `onRawResponse`.

### Historial del PNR

`session.reservation.history(locator, options?)` lee el historial del PNR (Get Itinerary History,
`TravelItineraryHistoryLLSRQ` 2.4.0, el `*H` del host), una entrada por transacción:

```ts
const { transactions } = await legacy.withSession((session) => session.reservation.history('ABC123'));
// transactions[0] → { rph, createdAt: '2026-11-04T17:15', agent, agentDutyCode, pcc, aaaPcc,
//                     receivedFrom, flightSegments, generalInfo, remarks, accounting }
```

- **Quién, cuándo y desde dónde**: `createdAt` (con año, sin zona horaria), el sine y el duty code
  del agente, el `pcc` de la firma, el `aaaPcc` del AAA y `receivedFrom`.
- **Qué cambió, con su `action`**: `flightSegments` con su estado en ese momento (`AS` alta, `XS`
  baja; fechas sin año, como las manda el host), y SSR, ticketing, teléfonos, nombres y emails como
  texto en `generalInfo` (`A4S`, `A7`, `A9`, `AN`, `APE`…). Sabre no publica la lista de valores de
  `action`. Asientos, autos, hoteles, tren, seguros y facturas no se tipan: quedan en la respuesta
  cruda (`onRawResponse`).
- **Trae datos del pasajero** (nombres, teléfonos, emails). El SDK nunca los manda al log.
- **No registra las colocaciones en cola**, ni las del sistema ni un `place` manual (CERT): para eso están
  `queue.list`/`access` o los remarks `QUEUE_PLACE` de Get Booking.
- **Llámalo fuera de un recorrido de cola.** Dentro de una cola, Sabre rechaza el historial de otro
  PNR con `NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY`, un `SabreBusinessError` (CERT). El
  PNR del AAA no cambia, `queue.state` sigue en `'inside'` y el recorrido sigue con `ignore`.
- Es una lectura: se reintenta. Un `locator` que no es de 6 caracteres alfanuméricos en mayúscula
  lanza un `TypeError` sin llamar a la red. Un PNR que no existe lanza un `SabreBusinessError`
  (`service: 'itineraryHistory'`).

### Colas

Las operaciones de cola están en `session.queue`. `pcc` es opcional en cada llamada, y por defecto
es el de la sesión. Una cola (`QueueRef`) tiene tres formas:

| Cola | `QueueRef` | Viaja como |
| - | - | - |
| Numérica, de 0 a 511 | `400` | `Number="400"` |
| Alfabética, una o dos letras mayúsculas | `'S'` | `Number="S"` |
| Con nombre (tablas QN y QNB) | `{ name: 'HOTELS' }` | `Name="HOTELS"` |

Las colas que devuelve `count` se pasan tal cual a las demás operaciones. `'S'` es la **cola de
mensajes** del PCC: tiene mensajes y no PNR, y Sabre no la lista, así que `list({ queue: 'S' })`
lanza un `TypeError` sin llamar a Sabre. Se recorre a mano: `access({ queue: 'S' })` devuelve el
primer mensaje (`kind: 'message'`) e `ignore()` el siguiente, sin sacarlo de la cola. `process` y
`place` dentro de la `S` lanzan un `TypeError` sin llamar a Sabre. `remove()` manda `QR`, pero
todavía no hay evidencia de qué hace Sabre con el mensaje. Para distinguirla, `isMessageQueue(queue)`
devuelve `true` solo con `'S'`, y `MESSAGE_QUEUE` es `'S'`:

```ts
import { isMessageQueue } from 'sabre-client';

const { queues } = await session.queue.count();
const pnrQueues = queues.filter(({ queue }) => !isMessageQueue(queue));
```

> **Migración desde la 0.4.x**: `count` devolvía la cola `S` como `{ name: 'S' }`, que Sabre
> rechaza (`INVALID QUEUE NAME FORMAT`). Ahora devuelve `'S'`. Un código como
> `typeof q === 'number' ? … : q.name` deja de compilar, porque `q` puede ser un `string`. Un
> `{ name }` de una o dos letras mayúsculas ahora lanza un `TypeError` que pide pasar la letra, y
> `'12'` o `'s'` también lanzan: cada cola tiene una sola forma.

| Método | Servicio de Sabre | Devuelve |
| - | - | - |
| `count({ pcc? })` | `QueueCountLLSRQ` | `{ queues: [{ queue, count }], totals, countedAt, warnings }` |
| `activity({ pcc? })` | `QueueAnalysisLLSRQ` | `{ queues: [{ queue, numMessages, ended, ignored, … }], totals, analyzedAt, warnings }` |
| `list({ queue, pcc?, primaryPassenger?, selection? })` | `QueueAccessLLSRQ` (`List`) | `{ locators, entries, paragraph, warnings }`, sin entrar a la cola |
| `access({ queue, pcc?, selection? })` | `QueueAccessLLSRQ` | `QueueStep` |
| `ignore()` | `QueueAccessLLSRQ` (`I`) | `QueueStep` |
| `remove({ from? })` | `QueueAccessLLSRQ` (`QR`) | `QueueStep` |
| `place({ to, locators? })` | `QueuePlaceLLSRQ` | `QueueStep` dentro de una cola, `{ placements, text, warnings }` fuera |
| `exit()` | `QueueAccessLLSRQ` (`QXI`) | `void` |

```ts
type QueueStep =
  | { done: false; kind: 'pnr'; item: QueueItem; warnings: SabreWarning[] }
  | { done: false; kind: 'message'; message: { text: string[] }; warnings: SabreWarning[] } // cola 'S'
  | { done: true; reason: 'end-of-display' | 'empty'; message: string; warnings: SabreWarning[] };
```

> **Migración desde la 0.4.x**: un paso que no terminó ahora trae `kind`. Comprueba
> `step.kind === 'pnr'` antes de leer `step.item`. Solo la cola `S` devuelve `kind: 'message'`.

- **`list` devuelve la cola entera en una respuesta**: no pagina, ni con más de 1000 PNR (1221 en
  unos 279 KB, en producción). `selection` la acota, pero en la lista Sabre solo acepta `QD`
  (fecha de colocación en la cola, p. ej. `{ function: 'QD', criteria: '05NOV' }`) o `AK` (el
  agente que lo colocó, PCC más firma, p. ej. `'PCC1AAT'`; todavía no se probó en la lista). Otro
  código lanza `TypeError` sin llamar a Sabre. El `placedAt` de una entrada de la lista es cuándo
  se colocó el PNR en la cola, la fecha por la que filtra `QD`.
- **`activity`** devuelve, por cola, los ocho contadores de la pantalla `QA` del host:
  `numMessages` (los que están hoy en la cola), `ended`, `ignored`, `moved`, `removed`,
  `transferred`, `leftMessageToContact` y `unableToReach`, más `totals` para el PCC. Sabre lista
  también colas vacías con contadores. Ninguna fuente dice desde cuándo cuentan, así que el SDK los
  devuelve tal cual. Como `count`, es una lectura: se reintenta, funciona dentro o fuera de una
  cola y no pide duty code 9.
- **Cada resultado de colas trae `respondedAt`**: el `eb:Timestamp` de Sabre, en ISO 8601 UTC
  (`'2026-11-06T17:34:16Z'`). A diferencia de `countedAt` y `placedAt`, que llegan como los manda
  el host (sin año y en hora local del PCC), trae año y zona. Solo falta si Sabre no lo manda.

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
  sin tocar. `placedAt` es el texto que llegó, con o sin año. Dentro de una cola es la última
  modificación del PNR, no su colocación en la cola: esa es el `placedAt` de `list`, y para un
  mismo PNR no coinciden. `resolveHostDate` lo convierte en una
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

### Leer un remark `QUEUE_PLACE`

Get Booking devuelve dónde se colocó el PNR como un remark con `type: 'QUEUE_PLACE'`. Su `text`
junta el PCC, la fecha, la cola y el PIC sin separadores. `parseQueuePlaceRemark(text)` lo separa:

```ts
parseQueuePlaceRemark('MEX25SEP146/015'); // { pcc: 'MEX', date: '25SEP', queue: 146, pic: 15 }
```

Devuelve `null` si el texto no tiene esa forma, o si el día, el mes, la cola (0–511) o el PIC
(0–191, 200–254) están fuera de rango. `date` viene sin año: se resuelve con
`resolveHostDate(date, referenceDate)`. Leer los remarks de la reserva le toca al consumidor.

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
- `queues['S']` es la cola de mensajes: cada elemento es el texto de un mensaje (`string[]`), no
  un PNR. `access` lo muestra sin `Line`, como Sabre, y `fake.messages()` da los que quedan. Que
  `remove` saque el mensaje es un supuesto del fake, no se probó con Sabre.
- `queue.activity`: `numMessages` sale de las colas del fake (sin el PNR en pantalla, como en
  `count`, igual que CERT). Los otros siete contadores valen 0, salvo que los siembres con
  `activity: { '9': { ignored: 27 } }`. Las acciones del fake **no** los cambian: nadie probó qué
  contador sube Sabre con cada acción.
- `reservation.history`: `histories: { AAAAAA: [transacciones] }` fija lo que devuelve cada PNR,
  con la forma de `ReservationHistoryTransaction` (las listas que falten llegan vacías). Un PNR que
  el fake conoce sin historial sembrado devuelve una transacción sintética (su creación), y un
  localizador desconocido da un error de host marcado como no simulado. Dentro de una cola, el
  historial de otro PNR se rechaza con `NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY` y el del
  PNR en pantalla se devuelve, como en CERT.
- Responde como producción: colas vacías, el fin de cola, `place` que mueve el PNR, el PIC
  obligatorio y una sesión vencida con `fake.expireSessions()`. `fake.calls` lista lo que pidió el
  SDK.
- **No simula** los PCC (las colas son las mismas para cualquier `pcc`) ni `selection`, que recibe
  un error en vez de la cola entera, en `access` y en `list`.
- `queueFixtures` trae las respuestas anonimizadas que se grabaron en producción (`walk`,
  `emptyQueue`, `place`…), como `{ operation, status, body }`. Cada una tiene sus propios alias de
  localizador (`walk`: `AAAAAA`–`AAAAAD`, `place`: `AAAAAE`–`AAAAAF`,
  `placeWithoutInstructionCodeInside`: `AAAAAG`–`AAAAAH`), y sus líneas de firma conservan la
  forma (`… <alias> H`).
- `queueFakePnrs(fixture)` convierte una grabación en los PNR del fake: primero los de `list`, en
  orden, con su `Line`, y el párrafo que mostró `access`, `ignore`, `remove` o `place` para cada
  uno. La cola la eliges tú, y puedes juntar fixtures. Los PNR de `queueFixtures` no traen
  `primaryPassenger`: el `list` se grabó sin `primaryPassenger: true` (`/LN`), así que Sabre no
  mandó el nombre. Si necesitas uno, agrégalo con un `map`:

  ```ts
  const fake = createQueueFake({
    queues: { '9': queueFakePnrs(queueFixtures.walk), '50': [] },
    pnrs: queueFakePnrs(queueFixtures.place),
  });

  const withPassenger = queueFakePnrs(queueFixtures.walk).map((pnr, index) => ({
    ...pnr,
    primaryPassenger: `TEST/PASSENGER${index + 1}`,
  }));
  ```

`examples/queue-review.mjs` es un ejemplo completo, y su test lo corre contra el fake.

#### Anonimizar respuestas grabadas

`createAnonymizer` aplica la regla con la que se grabaron las fixtures del SDK, para guardar las
respuestas de Sabre (por ejemplo, las de `onRawResponse`) sin datos de pasajeros:

```ts
import { createAnonymizer } from 'sabre-client/testing';

const anonymizer = createAnonymizer({ secrets: [pcc, username] });
const safe = anonymizer.anonymize(raw.body); // un sobre SOAP entero
anonymizer.maskParagraph(item.paragraph); // líneas en formato de host
if (anonymizer.leaks(safe).length > 0) throw new Error('quedan datos reales');
```

En un bundle de navegador, impórtalo de `sabre-client/anonymize`. Trae solo `createAnonymizer`,
`isSafeHostLine` y sus tipos, sin el fake ni las `queueFixtures`, que `sabre-client/testing` lleva
en un solo módulo (unos 230 KB) que los bundlers no pueden descartar:

```ts
import { isSafeHostLine } from 'sabre-client/anonymize';
```

- Cada localizador recibe un alias (`AAAAAA`, `AAAAAB`…), el mismo en todos los lugares donde
  aparece, también en los textos que pasen después por el mismo anonimizador. `PassengerName` pasa
  a `PASAJERO/UNO`, `Group` a `GRUPO`, `AgentSine` a `AAA` (salvo `SABRE`), `PseudoCityCode` a
  `XXXX`, `LNIATA` a `XXXXXX` y cada `secret` a `XXXX`.
- En las líneas en formato de host (`<Text>`, o `maskLine` y `maskParagraph`), solo quedan tal cual
  las de una lista blanca (`isSafeHostLine`: líneas vacías, avisos PIC como `011  SEE REMARKS`,
  títulos de sección, el fin de cola). En las demás, las letras pasan a `X` y los dígitos a `9`. La
  línea de firma conserva su forma, y su localizador solo si ya es un alias.
- `leaks(text)` lista los datos reales que siguen en `text` (`'secreto'`, `'localizador'`,
  `'nombre'`, `'línea del PNR'`, `'token'`): úsalo antes de escribir un archivo.
- Usa un anonimizador por grabación. Es una regla, no una garantía: revisa lo que guardas.

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
`'openSession'`, `'close'`, `'ping'`, `'command'` o `'queue.<método>'`. El token de la sesión
(`BinarySecurityToken`) se reemplaza por `[REDACTED]` donde aparezca. No se cambia nada más.

> [!WARNING]
> `body` es la respuesta cruda y **trae datos de pasajeros**. El SDK nunca lo manda al logger.
> Dónde lo guardas es tu responsabilidad.

## Request crudo

Las mismas operaciones aceptan `onRawRequest`, al lado de `onRawResponse`. Recibe lo que el SDK
mandó por la red, por ejemplo para mostrar el request real junto a la respuesta:

```ts
import type { SabreRawRequest } from 'sabre-client';

let sent: SabreRawRequest | undefined;
await sabre.booking.get({ confirmationId }, { onRawRequest: (r) => (sent = r) });
// sent: { operation: 'booking.get', protocol: 'rest', method, url, headers, body, attempts }
```

- `operation` es el mismo valor que recibe `onRawResponse`. `url` es la URL completa, con su query
  string. `headers` son los que se mandaron, **sin `Authorization`** (se quita el header entero).
  `body` es el texto que se mandó, o `undefined` si no hubo. En REST va tal cual; en
  `SabreLegacy` es el sobre SOAP completo con el `BinarySecurityToken` reemplazado por
  `[REDACTED]`, igual que en la respuesta.
- Se llama **una vez**, con el último intento que se mandó, antes de que la operación devuelva o
  lance y antes que `onRawResponse`. A diferencia de este, se llama también si ningún intento tuvo
  respuesta HTTP (error de red, abort), siempre que se haya mandado al menos uno. No se llama si la
  operación lanza antes de mandar nada (por ejemplo, un `TypeError` de validación).
- En SOAP, `eb:MessageId` y `eb:Timestamp` son nuevos en cada intento, así que el sobre que llega
  es el del último intento.
- No se llama con la autenticación: el request de token de OAuth, `openSession`
  (`SessionCreateRQ`, cuyo sobre lleva la contraseña del EPR) y `close` (`SessionCloseRQ`).
- Es síncrono y su retorno se ignora. Si lanza, el SDK registra
  `sabre.request.rawRequestHookFailed` sin el body y la operación sigue.

> [!WARNING]
> `body` y `url` **traen datos de pasajeros** (localizadores, nombres, contactos). El SDK nunca los
> manda al logger. Dónde los guardas es tu responsabilidad.

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
`sabre.request.retry`, `sabre.request.rawResponseHookFailed`,
`sabre.request.rawRequestHookFailed`, `sabre.auth.token.refresh`,
`sabre.auth.token.store`, `sabre.booking.seat.priced`, `sabre.session.open`,
`sabre.session.close`, `sabre.session.closeFailed`, `sabre.session.keepAliveFailed`,
`sabre.session.command`, `sabre.queue.exitTolerated`, `sabre.queue.exitFailed`) y nunca los bodies
crudos de request o response. Los secretos, el header `Authorization` y los datos de pasajeros
se redactan siempre antes de llegar a tu logger.

## Changelog

Ver [CHANGELOG.md](./CHANGELOG.md).
