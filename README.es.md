# sabre-client

SDK de TypeScript para las APIs de Sabre.

[Read in English](./README.md)

> **`0.3.0` es una reescritura completa, no una actualización incremental de `0.2.4`.**
> Tiene otra arquitectura: un cliente REST `Sabre` con un `AuthManager` que gestiona el token,
> una jerarquía de errores tipada, un logger inyectable con redacción obligatoria y solo Web
> Standard APIs, para correr en cualquier runtime de servidor. El código escrito para `0.2.4`
> no funciona sin cambios. Las versiones anteriores siguen publicadas tal como están.

## Estado

`0.3.0` **todavía no está publicada en npm**. Se publica cuando estén terminados el Tier 1 y
el Tier 2 del flujo de Air Booking. Mientras tanto, `npm install sabre-client` instala `0.2.4`.

El Tier 1 cubre el flujo básico de Air Booking por REST:

| Paso | Servicio | Método |
| - | - | - |
| Autenticación | OAuth Token Create v3 / v2 | automática |
| Búsqueda | Bargain Finder Max v5 | `sabre.air.bargainFinderMax` |
| Revalidación | Revalidate Itinerary v5 | `sabre.air.revalidateItinerary` |
| Reserva | Create Booking (Booking Management API v1, ATPCO por `flightDetails`) | `sabre.booking.create` |

Planeado: Get Seats y Get Ancillaries (Tier 2), y un cliente `SabreLegacy` para los servicios SOAP.

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

Toda request acepta un `AbortSignal`. Las búsquedas aceptan además una política de reintentos
propia:

```ts
await sabre.air.bargainFinderMax(search, { signal, retry: { maxRetries: 1 } });
```

## Manejo de errores

Todos los errores que lanza el SDK extienden `SabreError`:

| Clase | Cuándo | Campos extra |
| - | - | - |
| `SabreGatewayError` | Falla HTTP o del gateway (`ERR.2SG.*`, `401`, `429`, `5xx`, errores de OAuth) | `protocol`, `status`, `code` |
| `SabreOrchestrationError` | Error de un servicio orquestado dentro de un `200` (`SP.*`) | `code` |
| `SabreBusinessError` | Error del catálogo propio de un servicio (p. ej. `No Availability`, una reserva que no se creó) | `service`, `code`, `warnings` |
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
`sabre.request.retry`, `sabre.auth.token.refresh`, `sabre.auth.token.store`) y nunca los bodies
crudos de request o response. Los secretos, el header `Authorization` y los datos de pasajeros
se redactan siempre antes de llegar a tu logger.

## Changelog

Ver [CHANGELOG.md](./CHANGELOG.md).
