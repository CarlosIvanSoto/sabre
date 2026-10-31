# sabre-client

TypeScript SDK for the Sabre APIs.

[Leer en español](./README.es.md)

> **`0.3.0` is a complete rewrite, not an incremental update to `0.2.4`.**
> It is built on a different architecture (a `Sabre` REST client with a managed
> `AuthManager`, a typed error hierarchy, injectable logging with mandatory redaction, and
> runtime-agnostic Web Standard APIs). Code written against `0.2.4` will not work unchanged.
> Older versions stay published as they are.

## Status

`0.3.0` is **not released yet**. It will be released once both Tier 1 and Tier 2 of the
Air Booking flow are done. Until then, `npm install sabre-client` installs `0.2.4`.

Prereleases of the rewrite are published under the `next` tag:

```sh
npm install sabre-client@next
```

The API may still change before `0.3.0`.

Tier 1 covers the core Air Booking flow over REST:

| Step | Service | Method |
| - | - | - |
| Authentication | OAuth Token Create v3 / v2 | automatic |
| Shopping | Bargain Finder Max v5 | `sabre.air.bargainFinderMax` |
| Revalidation | Revalidate Itinerary v5 | `sabre.air.revalidateItinerary` |
| Booking | Create Booking (Booking Management API v1, ATPCO by `flightDetails`) | `sabre.booking.create` |
| Booking management | Get Booking and Cancel Booking (Booking Management API v1) | `sabre.booking.get`, `sabre.booking.cancel` |

Planned: Get Seats and Get Ancillaries (Tier 2), and a `SabreLegacy` client for SOAP services.

## Requirements

- Node.js `>=22.12`, or a server-side edge runtime with `fetch` and `crypto.subtle`
  (Cloudflare Workers, Vercel Edge Functions, Deno Deploy). The package uses only Web
  Standard APIs.
- ESM only.
- **Never run it in a browser.** Your Sabre credentials would be exposed to anyone with
  devtools.

## Configuration

The SDK never reads environment variables. Pass the configuration explicitly:

```ts
import { Sabre } from 'sabre-client';

const sabre = new Sabre({
  environment: 'sandbox', // 'sandbox' (CERT) or 'production'
  credentials: {
    clientId: process.env.SABRE_CLIENT_ID!,
    clientSecret: process.env.SABRE_CLIENT_SECRET!,
    username: process.env.SABRE_EPR_USERNAME!, // EPR user, e.g. `<user>-<PCC>-AA`
    password: process.env.SABRE_EPR_PASSWORD!,
  },
});
```

| Option | Default | Description |
| - | - | - |
| `environment` | required | `'sandbox'` → `api.cert.platform.sabre.com`, `'production'` → `api.platform.sabre.com` |
| `authVersion` | `'v3'` | OAuth Token Create version. `'v3'` needs `clientId`, `clientSecret`, `username` and `password`; `'v2'` only needs the EPR `username` (`V1:<user>:<PCC>:AA`) and `password` |
| `credentials` | required | See above |
| `logger` | none | Any object with `debug`, `info`, `warn` and `error` (see [Logging](#logging)) |
| `retry` | `{ maxRetries: 3, baseDelayMs: 500 }` | Client-wide retry policy; every request can override it |
| `fetch` | global `fetch` | Custom `fetch` (proxies, tests, other runtimes) |
| `tokenStore` | in-memory only | Shares the token between processes (see [Token reuse](#token-reuse)) |

### Authentication

You never request a token yourself. The client gets one on the first call, caches it, renews
it about an hour before it expires, and shares a single in-flight request between concurrent
calls. If Sabre rejects a token with `401`, the client gets a new one and retries that request
once.

## Booking a flight

The full Tier 1 flow: search, revalidate the chosen itinerary, and book it.

```ts
import { Sabre, buildRevalidateItineraryRequest, buildBookingFlightDetails } from 'sabre-client';

const sabre = new Sabre({ environment: 'sandbox', credentials });

// 1. Search with Bargain Finder Max. The request is the body Sabre documents.
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

// Responses come with references already resolved: every itinerary has its legs,
// schedules and fares inline, no `ref` lookups needed.
const group = found.itineraryGroups[0]!;
const itinerary = group.itineraries[0]!;

// 2. Revalidate the chosen itinerary (availability and price, no inventory held).
const revalidated = await sabre.air.revalidateItinerary(
  buildRevalidateItineraryRequest({ search, group, itinerary }),
);
const confirmedGroup = revalidated.itineraryGroups[0]!;
const confirmed = confirmedGroup.itineraries[0]!;

// 3. Book it through the ATPCO path (`flightDetails`).
const booking = await sabre.booking.create({
  flightDetails: buildBookingFlightDetails({ group: confirmedGroup, itinerary: confirmed }),
  travelers: [{ givenName: 'JANE', surname: 'DOE', passengerCode: 'ADT' }],
  contactInfo: { emails: ['jane@example.com'], phones: ['5550000000'] },
});

console.log(booking.confirmationId); // PNR locator
```

`buildBookingFlightDetails` maps the revalidated itinerary to the `flightDetails` block of
Create Booking. That mapping is not documented by Sabre and has not been checked against a
real sandbox booking yet, so review the request before you rely on it.

`sabre.booking.create` is **never retried automatically**, because it is not idempotent. If
Sabre creates the booking with warnings or non-fatal errors, the call does not throw. Check
`booking.warnings` and `booking.errors`.

`sabre.booking.get` reads a booking by `confirmationId`. Unlike Create Booking, the response
has the booking fields at the top level (`bookingId`, `flights`, `travelers`, …), as Sabre
defines it. Use `returnOnly` to ask only for the sections you need, which also makes the call
faster:

```ts
const pnr = await sabre.booking.get({
  confirmationId: booking.confirmationId,
  returnOnly: ['FLIGHTS', 'TRAVELERS'],
});
```

It throws `SabreBusinessError` only when there is no booking (for example
`BOOKING_NOT_FOUND`). If the booking exists, partial problems come back in `pnr.warnings`
and `pnr.errors`; an unticketed booking usually carries a `RESOURCE_UNAVAILABLE` warning
because it has no fare rules yet. It is a read, so transient failures are retried.

`sabre.booking.cancel` cancels the whole booking (`cancelAll: true`) or specific items by the
`itemId` that `get` returns:

```ts
await sabre.booking.cancel({ confirmationId: booking.confirmationId, cancelAll: true });
await sabre.booking.cancel({ confirmationId: pnr.bookingId, flights: [{ itemId: '2' }] });
```

Like `create`, it is **never retried automatically**. Combinations that Sabre always rejects
(`cancelAll` together with item lists, no `cancelAll` and no list, `offerItemId` together with
`flightTicketOperation`) throw a `TypeError` before any request is sent. If Sabre answers
`NO_ITEMS_CANCELLED`, the call throws `SabreBusinessError` even though Sabre sends it as a
warning, because nothing was cancelled; the errors that explain why are in `error.errors`. An
`END_TRANSACTION_PROBLEM` warning means the confirmation is still pending: check the result
with `sabre.booking.get`.

Every request accepts an `AbortSignal`. Shopping calls also accept a per-request retry policy:

```ts
await sabre.air.bargainFinderMax(search, { signal, retry: { maxRetries: 1 } });
```

## Error handling

Every error thrown by the SDK extends `SabreError`:

| Class | When | Extra fields |
| - | - | - |
| `SabreGatewayError` | HTTP or gateway failure (`ERR.2SG.*`, `401`, `429`, `5xx`, OAuth errors) | `protocol`, `status`, `code` |
| `SabreOrchestrationError` | Orchestrated service error inside a `200` (`SP.*`) | `code` |
| `SabreBusinessError` | Error from a service's own catalog (e.g. `No Availability`, a booking that was not created) | `service`, `code`, `warnings`, `errors` |
| `SabreWarning` | Non-fatal warning (e.g. `category: WARNING` in Create Booking) | `service`, `code` |

All of them have `retryable`, which says whether the retry policy may try again.

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
> `SabreError.raw` holds the original response fragment, untouched, for debugging. It **can
> contain credentials or passenger data**. It is not enumerable, so it does not show up in
> `JSON.stringify` or object spreads, but you can still read `error.raw`. Never send it to a
> logger, error tracker or monitoring service without sanitizing it first.

## Raw response

Every REST operation (`air.bargainFinderMax`, `air.revalidateItinerary`, `booking.create`,
`booking.get` and `booking.cancel`) accepts an `onRawResponse` callback in its options, next to
`signal`. It receives Sabre's response as it arrived, for example to store it next to the typed
result:

```ts
import type { SabreRawResponse } from 'sabre-client';

let raw: SabreRawResponse | undefined;
const booking = await sabre.booking.get({ confirmationId }, { onRawResponse: (r) => (raw = r) });
// raw: { operation: 'booking.get', protocol: 'rest', status, headers, body, attempts }
```

- It is called **once**, with the last HTTP attempt, before the operation returns or throws.
  It is also called when the operation throws `SabreBusinessError` (a `200` with `errors[]`) or
  `SabreGatewayError` (a non-`2xx`). After retries, `attempts` counts every HTTP attempt.
- It is not called if no attempt got an HTTP response (network error, abort), nor for token
  requests. After a `401`, it gets the response of the retry with the new token.
- It is synchronous and its return value is ignored. If it throws, the SDK catches it, logs
  `sabre.request.rawResponseHookFailed` without the body, and the operation carries on: a
  failing callback never makes `booking.create` lose its `confirmationId`. To persist
  asynchronously, keep the value and write it after the call returns.

> [!WARNING]
> `body` is the raw response and **contains passenger data**. The SDK never sends it to the
> logger. Where you store it is up to you.

## Retries

Only idempotent operations are retried: Bargain Finder Max and Revalidate Itinerary (both
are read-only `POST`s). Create Booking is never retried. Retries use exponential backoff with
full jitter and a 500 ms floor, on `429`, `500`, `503`, `504`, `SP.PROVIDER_ERROR` and the
temporary errors in the Bargain Finder Max catalog.

## Token reuse

By default the token lives in memory, one per `Sabre` instance. To share it between
processes (scripts, serverless functions), pass a `tokenStore`. The SDK does not ship any
implementation:

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

`key` identifies the environment, the OAuth version and a hash of the credential identity,
so one store can serve several clients. It contains no secrets, but the stored token is one:
protecting it is up to you. If `get` or `set` throws, the SDK falls back to its in-memory
cache.

## Logging

Logging is off unless you pass a `logger`. It is compatible with `console` and `winston`;
for `pino`, swap the arguments:

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

The SDK logs structured events (`sabre.request.start`, `sabre.request.end`,
`sabre.request.retry`, `sabre.request.rawResponseHookFailed`, `sabre.auth.token.refresh`,
`sabre.auth.token.store`), never raw
request or response bodies. Secrets, the `Authorization` header and passenger data are always
redacted before they reach your logger.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
