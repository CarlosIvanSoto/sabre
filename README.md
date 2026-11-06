# sabre-client

TypeScript SDK for the Sabre APIs.

[Leer en español](./README.es.md)

> **`0.3.0` is a complete rewrite, not an incremental update to `0.2.4`.**
> It is built on a different architecture (a `Sabre` REST client with a managed
> `AuthManager`, a typed error hierarchy, injectable logging with mandatory redaction, and
> runtime-agnostic Web Standard APIs). Code written against `0.2.4` will not work unchanged.
> Older versions stay published as they are.

## Status

`0.4.0` is the current release of the rewrite. It covers Tier 1 and Tier 2 of the Air Booking
flow over REST, and Tier 3 (SOAP sessions and queues). It adds `buildCredentials` and host
commands (`session.command`) to `0.3.0`, with no breaking changes.

```sh
npm install sabre-client
```

The package is still `0.x`: a minor version may include breaking changes, and the
[CHANGELOG](./CHANGELOG.md) marks them.

Tier 1 covers the core Air Booking flow over REST:

| Step | Service | Method |
| - | - | - |
| Authentication | OAuth Token Create v3 / v2 | automatic |
| Shopping | Bargain Finder Max v5 | `sabre.air.bargainFinderMax` |
| Revalidation | Revalidate Itinerary v5 | `sabre.air.revalidateItinerary` |
| Booking | Create Booking (Booking Management API v1, ATPCO by `flightDetails`) | `sabre.booking.create` |
| Booking management | Get Booking and Cancel Booking (Booking Management API v1) | `sabre.booking.get`, `sabre.booking.cancel` |

Tier 2 adds seat selection:

| Step | Service | Method |
| - | - | - |
| Seat map | Get Seats v3 (`byReservationPayload` and `byPnrLocator`) | `sabre.air.getSeats` |

Tier 3 adds the `SabreLegacy` SOAP client, with a stateful session and Queue Management (see
[SOAP sessions and queues](#soap-sessions-and-queues-sabrelegacy)):

| Step | Service | Method |
| - | - | - |
| Session | `SessionCreateRQ` 2.0.0 / 1.0.0, `OTA_PingRQ`, `SessionCloseRQ` | `legacy.withSession`, `legacy.openSession` |
| Queues | Get Queue Count, Get Queue Activity, Access Queue, Place Queue Message | `session.queue.count`, `activity`, `list`, `access`, `ignore`, `remove`, `place`, `exit`, `process` |
| Queue paragraph | — (pure function) | `parseQueueParagraph`, `parseQueuePlaceRemark`, `resolveHostDate` |
| PNR history | `TravelItineraryHistoryLLSRQ` 2.4.0 | `session.reservation.history` |
| Host commands | `SabreCommandLLSRQ` 2.0.0 | `session.command` |

Planned after `0.4.0`: Get Ancillaries (NDC only).

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
    username: '<user>-<PCC>-AA', // EPR username, already built (see Credentials below)
    password: process.env.SABRE_PASSWORD!,
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

> **`pcc` is deprecated** since `0.4.1` and will be removed in `0.5.0`. It was a reserved field,
> and no client reads it. The PCC you authenticate with goes in `credentials` (see
> [Credentials](#credentials) and `buildCredentials`). To work in another PCC, pass it per
> operation: `targetPcc` in REST, `pcc` in the queue operations.

### Credentials

There is **one set of credentials** for REST and SOAP: the same `credentials` object works for
`Sabre` and for `SabreLegacy`. It holds the EPR user, its PCC and domain, the EPR password and,
optionally, the app's `clientId`/`clientSecret`. The OAuth version only changes how the EPR
`username` is written: `<user>-<PCC>-<domain>` (v3) or `V1:<user>:<PCC>:<domain>` (v2).

`buildCredentials` builds that object from the parts, so you don't have to know either format.
It does not read environment variables and throws a `TypeError` on invalid input:

```ts
import { Sabre, SabreLegacy, buildCredentials } from 'sabre-client';

const credentials = buildCredentials({
  authVersion: 'v3', // default; 'v2' → `V1:<user>:<PCC>:<domain>`
  user: process.env.SABRE_USERNAME!, // the EPR user alone
  pcc: process.env.SABRE_PCC!, // the PCC the EPR belongs to
  domain: process.env.SABRE_DOMAIN || undefined, // 'AA' by default
  password: process.env.SABRE_PASSWORD!,
  clientId: process.env.SABRE_CLIENT_ID!, // required with v3; with v2, both or neither
  clientSecret: process.env.SABRE_CLIENT_SECRET!,
});

const sabre = new Sabre({ environment: 'sandbox', credentials });
const legacy = new SabreLegacy({ environment: 'sandbox', credentials });
```

The object that `buildCredentials` returns carries its `authVersion`, so the config does not
need to repeat it: with `authVersion: 'v2'` in `buildCredentials`, `{ environment, credentials }`
is already a v2 config. If you pass `authVersion` in the config too, it must match, or the client
throws a `TypeError`. Credentials you build by hand have no `authVersion`, so with v2 the config
still needs `authVersion: 'v2'`. If the version is only known at runtime (for example, read
from an environment variable into a `BuildCredentialsOptions`), the result of `buildCredentials`
can still go straight into the config, with no `authVersion` there.

The PCC in the credentials is the one you authenticate with. Working in another PCC is not a
second set of credentials: pass it per operation, as `targetPcc` in `booking.create`, `get` and
`cancel`, or as `pcc` in the queue operations.

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

## Choosing a seat

`sabre.air.getSeats` returns the seat map with availability and prices. It is one function
for both Get Seats endpoints: without `pnrLocator` it goes to `byReservationPayload` (before
booking), with `pnrLocator` it goes to `byPnrLocator` (an existing PNR).

Before booking, build the request from the revalidated itinerary with
`buildSeatAvailabilityRequest`, pick a seat, and pass it to `buildBookingFlightDetails`:

```ts
import { buildBookingFlightDetails, buildSeatAvailabilityRequest } from 'sabre-client';

// After step 2 of "Booking a flight": `confirmedGroup` and `confirmed`.
const seatMap = await sabre.air.getSeats(
  buildSeatAvailabilityRequest({ group: confirmedGroup, itinerary: confirmed, currencyCode: 'USD' }),
);

// seatMaps[].segmentRef is S1, S2, … in itinerary order. `occupationStatusCode: 'F'` is a free
// seat; one with `offerItemRefIds` may have a price (offerItems[].priceDefinitionRef →
// priceDefinitions[]). Here: the first free seat of the first flight with no offer item.
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
    // Both indexes start at 1: first flight of the itinerary, first traveler.
    seats: seat === undefined ? [] : [{ segmentIndex: 1, travelerIndex: 1, number: seat.number }],
    seatAvailability: seatMap,
  }),
  travelers: [{ givenName: 'JANE', surname: 'DOE', passengerCode: 'ADT' }],
  contactInfo: { emails: ['jane@example.com'], phones: ['5550000000'] },
});
```

For a booking that already exists, ask by locator:

```ts
const pnrSeats = await sabre.air.getSeats({ pnrLocator: booking.confirmationId! });
```

Things to know:

- **Seats are booked by number, ATPCO only.** The seat goes to `flightDetails.flights[].seats[]`
  (`BookSeat`). `seatOffers` and the Get Seats `offerId` are NDC only and are not supported.
  `areaPreferences` and `changeOfGaugeSeats` are not supported by the helper either.
- **Prefer free seats.** It is not known what Sabre does with a chargeable seat requested by
  number through ATPCO. If you pass `seatAvailability` and the chosen seat has a price,
  `sabre.booking.create` logs a `sabre.booking.seat.priced` warning (segment, flight, seat,
  amount and currency, no passenger data) and books anyway.
- **Local validation.** A seat number that does not match `^[0-9]+[A-Z]$`, a `segmentIndex` or
  `travelerIndex` that does not exist, or a `pnrLocator` that is empty or mixed with payload
  fields (`segments`, `passengers`, `returnSeatMapsOnlyForSegmentRefs`) throws a `TypeError`
  before any request is sent.
- **Errors.** Get Seats has no published error catalog. `errors[]` without a seat map throws a
  non-retryable `SabreBusinessError`; with a seat map, errors and `warnings[]` come back in
  `seatMap.errors` and `seatMap.warnings`. Both endpoints are reads, so gateway `429`/`5xx`
  are retried.
- **`byPnrLocator` only reads PNRs from the PCC you authenticate with.** Its request has no
  `targetPcc`, unlike Create, Get and Cancel Booking. If the booking was created with
  `targetPcc` in another PCC, Sabre answers `502` with `Viewership is restricted for the PNR`,
  which surfaces as a `SabreGatewayError`.
- **What has been checked.** `byReservationPayload` was checked read-only in production, for
  a nonstop and a connection. Booking with a seat was checked in sandbox: the seat reaches the
  PNR and `sabre.booking.get` returns it in `flights[].seats[]`. `byPnrLocator` was checked in
  sandbox with a booking made in the PCC you authenticate with: it returns the map for the PNR's
  segments, with Sabre's own passenger and segment ids (`pnr_pax_1`, `segment_ancs_1`) instead
  of `P1` and `S1`. In sandbox neither endpoint reflects occupancy: every seat comes back as
  `F`, including the one the PNR holds. Prices arrive as numbers even though the spec says
  strings, so the types accept both.

## SOAP sessions and queues (`SabreLegacy`)

`SabreLegacy` is the client for Sabre's SOAP services. It takes the same `SabreConfig` as `Sabre`.
The session's user, PCC and domain come from `credentials.username`
(`V1:<user>:<PCC>:<domain>` or `<user>-<PCC>-<domain>`). The `SessionCreateRQ` version comes from
the credentials: 2.0.0 with `clientId` and `clientSecret`, 1.0.0 without them. Passing only one of
the two, or a `username` in neither format, throws a `TypeError` when the client is created.

```ts
import { SabreLegacy } from 'sabre-client';

const legacy = new SabreLegacy({
  environment: 'production',
  authVersion: 'v2',
  credentials: { username: 'V1:<user>:<PCC>:AA', password: process.env.SABRE_PASSWORD! },
});

const counts = await legacy.withSession((session) => session.queue.count());
```

### Sessions

- **`withSession(callback)` is the recommended form.** It opens a session, lends it to the
  callback and always closes it, also when the callback throws. It returns what the callback
  returns. If closing fails, it logs `sabre.session.closeFailed` and keeps the callback's result
  or error.
- **`openSession(options?)`** is for controlling the session's lifetime yourself. Close it with
  `try { … } finally { await session.close() }`. `close()` is idempotent. If the runtime has
  `Symbol.asyncDispose`, `await using` works too, but the types do not declare it.
- **A session is exclusive.** Sabre does not allow concurrent calls on one session, so a second
  call while another is in flight throws `TypeError: sabre-client: session busy` without calling
  the network. Calls after `close()` throw `session closed`.
- **Inactivity.** Sabre documents a 15-minute inactivity timeout (in production, sessions have
  lasted longer). `session.idleMs` is the
  time since Sabre last answered, and `session.ping()` resets it. With
  `openSession({ keepAlive: true })`, the SDK pings after 13 minutes of inactivity. It is off by
  default, because a timer does not survive between serverless or edge invocations.
- **No pool, and no automatic reopening.** Each `withSession` opens and closes one session. After
  a `SabreSessionError`, the session is unusable: later calls throw `session unusable` without
  calling the network, and `close()` resolves without calling it. The SDK does not reopen the
  session, because the queue cursor is already lost. Starting over is your decision.

### Host commands

`session.command(command, options?)` sends a Sabre host command (`SabreCommandLLSRQ` 2.0.0)
inside the session and returns the screen as text. **It is an escape hatch**, with no types and
no guarantees: the SDK does not parse the screen, and a command can change the PCC configuration
or issue tickets. There is no list of allowed or blocked commands.

```ts
const screen = await legacy.withSession((session) => session.command('W/PT¥*', { idempotent: true }));
// screen.text      → 'PSGR TYPE - ON' (as Sabre sends it, not trimmed)
// screen.warnings  → the stl:Warning entries, if any
// screen.messageId → eb:MessageId, for Sabre support
// screen.respondedAt → eb:Timestamp in UTC, e.g. '2026-11-06T17:34:16Z'
```

- **The command is sent as is.** In this service Sabre's `‡` separator is written `¥`
  (`W/PT‡*` in Sabre Red is `W/PT¥*` here); the SDK does not convert it.
- **The screen is not trimmed.** Host screens are aligned by column and can start with a space
  (` 17MAR  WED…`), so `text` is the content of `Response` as is. Trim it yourself if you need to.
- **Up to 1023 characters, counted as Sabre does:** `!`, `%`, `$`, `&`, `¥` and `§` count 2. A
  longer command throws a `TypeError` without calling the network (Sabre would answer
  `REQUEST EXCEEDED MAXIMUM LENGTH`).
- **Sabre blocks some commands on its own** (`SO`, `/@`, `¤¤`, per its whitelist), even though
  the SDK has no list of its own.
- **Some commands cost more.** `JR` and `WPNI` count as "Worldfare" searches.
- **Host masks** are answered with the first two characters of the mask.
- **Prefer a structured API.** Sabre asks not to use this service for what already has one: when
  the SDK has an operation for it, use that.
- **No retries by default**, because the SDK cannot tell a read from a change. Pass
  `{ idempotent: true }` for read-only commands and they follow the [retry policy](#retries).
- **A host message is not an error.** `DUTY CODE 9 REQUIRED` or `FORMAT` come back in `text`. A
  SOAP fault or an `stl:Error` throws, like any other session call.
- Commands that need the same sign-in (`SI9` followed by `W/PT¥ON`) must run in the same session.
- The debug log (`sabre.session.command`) carries only the first token of the command, cut to 4
  characters (`W/PT`, `DC`, `*IM`), never the whole command or the screen. The full response is
  available through `onRawResponse`.

### PNR history

`session.reservation.history(locator, options?)` reads the PNR history (Get Itinerary History,
`TravelItineraryHistoryLLSRQ` 2.4.0, the host's `*H`), one entry per transaction:

```ts
const { transactions } = await legacy.withSession((session) => session.reservation.history('ABC123'));
// transactions[0] → { rph, createdAt: '2026-11-04T17:15', agent, agentDutyCode, pcc, aaaPcc,
//                     receivedFrom, flightSegments, generalInfo, remarks, accounting }
```

- **Who, when and from where**: `createdAt` (with a year, no time zone), the agent's sine and duty
  code, the signing `pcc`, the AAA's `aaaPcc` and `receivedFrom`.
- **What changed, with its `action`**: `flightSegments` with their status at that moment
  (`AS` added, `XS` cancelled; dates without a year, as the host sends them), and SSR, ticketing,
  phones, names and emails as text in `generalInfo` (`A4S`, `A7`, `A9`, `AN`, `APE`…). Sabre does
  not publish the list of `action` values. Seats, cars, hotels, rail, insurance and invoices are
  not typed: they stay in the raw response (`onRawResponse`).
- **It carries passenger data** (names, phones, emails). The SDK never logs it.
- **It does not record queue placements**, neither the system's nor a manual `place` (CERT): for that, use
  `queue.list`/`access` or the `QUEUE_PLACE` remarks of Get Booking.
- **Call it outside a queue walk.** Inside a queue, Sabre rejects the history of another PNR with
  `NAK6 -NOT ALLOWED- FINISH OR IGNORE OTHER ACTIVITY`, a `SabreBusinessError` (CERT). The PNR in
  the AAA does not change, `queue.state` stays `'inside'`, and the walk goes on with `ignore`.
- It is a read: it is retried. A `locator` that is not 6 uppercase alphanumeric characters throws a
  `TypeError` without calling the network. A PNR that does not exist throws a `SabreBusinessError`
  (`service: 'itineraryHistory'`).

### Queues

The queue operations live in `session.queue`. `pcc` is optional in every call and defaults to the
session's PCC. A queue (`QueueRef`) comes in three forms:

| Queue | `QueueRef` | Sent as |
| - | - | - |
| Numeric, 0 to 511 | `400` | `Number="400"` |
| Alphabetic, one or two uppercase letters | `'S'` | `Number="S"` |
| Named (QN and QNB tables) | `{ name: 'HOTELS' }` | `Name="HOTELS"` |

The queues returned by `count` can be passed straight to the other operations. `'S'` is the PCC's
**message queue**: it holds messages, not PNRs, and Sabre does not list it, so `list({ queue: 'S' })`
throws a `TypeError` without calling Sabre. Walk it by hand: `access({ queue: 'S' })` returns the
first message (`kind: 'message'`) and `ignore()` the next one, leaving it in the queue. `process`
and `place` inside `S` throw a `TypeError` without calling Sabre. `remove()` sends `QR`, but there
is no evidence yet of what Sabre does with the message.

> **Migrating from 0.4.x**: `count` used to return the `S` queue as `{ name: 'S' }`, which Sabre
> rejects (`INVALID QUEUE NAME FORMAT`). It now returns `'S'`. Code that does
> `typeof q === 'number' ? … : q.name` no longer compiles, because `q` can be a `string`. A
> `{ name }` of one or two uppercase letters now throws a `TypeError` that tells you to pass the
> letter instead, and `'12'` or `'s'` throw too: each queue has a single form.

| Method | Sabre service | Returns |
| - | - | - |
| `count({ pcc? })` | `QueueCountLLSRQ` | `{ queues: [{ queue, count }], totals, countedAt, warnings }` |
| `activity({ pcc? })` | `QueueAnalysisLLSRQ` | `{ queues: [{ queue, numMessages, ended, ignored, … }], totals, analyzedAt, warnings }` |
| `list({ queue, pcc?, primaryPassenger?, selection? })` | `QueueAccessLLSRQ` (`List`) | `{ locators, entries, paragraph, warnings }`, without entering the queue |
| `access({ queue, pcc?, selection? })` | `QueueAccessLLSRQ` | `QueueStep` |
| `ignore()` | `QueueAccessLLSRQ` (`I`) | `QueueStep` |
| `remove({ from? })` | `QueueAccessLLSRQ` (`QR`) | `QueueStep` |
| `place({ to, locators? })` | `QueuePlaceLLSRQ` | `QueueStep` inside a queue, `{ placements, text, warnings }` outside |
| `exit()` | `QueueAccessLLSRQ` (`QXI`) | `void` |

```ts
type QueueStep =
  | { done: false; kind: 'pnr'; item: QueueItem; warnings: SabreWarning[] }
  | { done: false; kind: 'message'; message: { text: string[] }; warnings: SabreWarning[] } // queue 'S'
  | { done: true; reason: 'end-of-display' | 'empty'; message: string; warnings: SabreWarning[] };
```

> **Migrating from 0.4.x**: a step that is not done now has a `kind`. Check `step.kind === 'pnr'`
> before reading `step.item`. Only the `S` queue returns `kind: 'message'`.

- **`list` returns the whole queue in one response**: there is no paging, even with more than 1000
  PNRs (1221 in about 279 KB, in production). `selection` narrows it, but in the list Sabre only
  accepts `QD` (date placed on the queue, e.g. `{ function: 'QD', criteria: '05NOV' }`) or `AK`
  (the agent who placed it, PCC plus sine, e.g. `'PCC1AAT'`; not tested in the list yet).
  Any other code throws a `TypeError` without calling Sabre. The `placedAt` of a list entry is
  when the PNR was placed on the queue, the date `QD` filters on.
- **`activity`** returns, per queue, the eight counters of the host's `QA` screen: `numMessages`
  (on the queue now), `ended`, `ignored`, `moved`, `removed`, `transferred`,
  `leftMessageToContact` and `unableToReach`, plus `totals` for the PCC. Sabre also lists empty
  queues that have counters. No source says since when the counters run, so the SDK returns them
  as they come. Like `count`, it is a read: it is retried, it works inside or outside a queue, and
  it does not need duty code 9.
- **Every queue result carries `respondedAt`**: Sabre's `eb:Timestamp`, in ISO 8601 UTC
  (`'2026-11-06T17:34:16Z'`). Unlike `countedAt` and `placedAt`, which come as the host sends them
  (no year, PCC local time), it has a year and a zone. It is missing only if Sabre does not send it.

- **The end of the queue is a result, not an error.** `END OF DISPLAY FOR REQUESTED DATA` gives
  `{ done: true, reason: 'end-of-display' }`, and an empty queue (`QUEUE SELECTED WAS EMPTY`)
  gives `reason: 'empty'`. In both cases the session is left outside the queue. Any other Sabre
  error is thrown as a `SabreBusinessError`.
- **The operations that move forward return the next item**, so there is no extra call per PNR.
  Inside a queue, `place` moves the current PNR to the target queues and returns the next one.
- **The SDK tracks whether the session is inside a queue** (`session.queue.state`: `'outside'`,
  `'inside'` or `'unknown'`). `ignore`, `remove` and `exit` outside a queue throw a `TypeError`
  without calling the network. So do `access` while inside a queue, and `place` with `locators`
  inside a queue or in `'unknown'`. When an operation fails inside a queue with an error that is
  not a session error, the state becomes `'unknown'`, because the SDK cannot tell whether Sabre
  left the session inside. Call `exit()` to get out: in `'unknown'`, it tolerates
  `CANNOT DO THIS IF OFF QUEUE`.
- **`place`**: inside a queue it places the current PNR. With `locators` (up to 6), it places
  those PNRs from outside a queue. Without either, it places the PNR in the AAA.
- **`instructionCode` (the PIC) is required in every `place` target.** It must be 0–191 or 200–254.
  Production rejects a `place` without it, although the design says it is optional.
- **`QueueItem`** has `locator`, the `placedAt` and `placedBy` of `Line`, `primaryPassenger` and
  `group` when Sabre sends them, and `paragraph`: the PNR in host format, line by line and
  untouched. `placedAt` is the text that arrived, with or without the year. Inside a queue it is
  the PNR's last change, not when it was placed on the queue: that one is the `placedAt` of
  `list`, and the two differ for the same PNR. `resolveHostDate`
  turns it into a full date.
- `count` inside a queue does not count the PNR on screen.

### Walking a queue with `process`

`process` enters the queue, calls your callback for each PNR, runs the action it returns and stops
at the end of the queue. It does nothing the primitives cannot do: it covers the common case and
makes sure the session leaves the queue.

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

- When it reaches `limit`, it leaves the queue with `QXI`. `limit` is optional and has no default
  cap, but passing one is recommended.
- If the callback throws, `process` leaves the queue with `QXI` and rethrows. It does not turn the
  error into `ignore`. To carry on, catch the error in the callback and return `ignore`.

### Reading the paragraph

`parseQueueParagraph(item.paragraph, { referenceDate })` is a separate pure function that does not
run on its own. It returns `{ messages, passengers, segments, ticketing, receivedFrom, unparsed }`:
the queue notices (`011  SEE REMARKS` → `{ instructionCode: 11, text: 'SEE REMARKS' }`), names,
segments with their status, the ticketing field with an `issued` flag, and the received-from line.

- **It is best effort.** The host format has no contract. A line the parser does not recognize
  goes to `unparsed`, and the parser does not throw.
- **`referenceDate` is required.** Host dates have no year (`06SEP`), so the year is resolved
  against that date. Segments and ticketing take the nearest date within ±6 months, and the
  received-from line goes backwards. Dates come out as ISO strings without a time zone.
- It does not read deadlines that airlines write as free text in remarks, SSR or OSI. Their format
  belongs to each airline. The text is still in `paragraph`.

### Reading a `QUEUE_PLACE` remark

Get Booking returns where the PNR was placed as a remark with `type: 'QUEUE_PLACE'`. Its `text`
packs the PCC, the date, the queue and the PIC with no separators. `parseQueuePlaceRemark(text)`
splits it:

```ts
parseQueuePlaceRemark('MEX25SEP146/015'); // { pcc: 'MEX', date: '25SEP', queue: 146, pic: 15 }
```

It returns `null` if the text does not have that shape, or if the day, month, queue (0–511) or PIC
(0–191, 200–254) are out of range. `date` has no year: resolve it with
`resolveHostDate(date, referenceDate)`. Reading the remarks from the booking is up to you.

### Testing your queue logic: `sabre-client/testing`

`sabre-client/testing` is a separate entry point with a fake of Sabre's sessions and queues. It is
not part of the main bundle. `createQueueFake` returns a `fetch` that you pass in `config.fetch`,
so your test goes through the SDK's real transport, session and parsing, without the network:

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
fake.openSessions; // 0: the session was closed
```

- Each PNR is a paragraph, with the locator taken from its signature line, or
  `{ locator, paragraph?, placedAt?, placedBy?, primaryPassenger? }`. A paragraph without a
  signature line gets a synthetic one. `pnrs` adds PNRs that are not in any queue, for
  `place({ locators })`. The fake has no AAA: outside a queue, `place` needs `locators`.
- `queues['S']` is the message queue: each item is a message's text (`string[]`), not a PNR.
  `access` shows it without `Line`, as Sabre does, and `fake.messages()` lists the ones left.
  That `remove` takes a message out is an assumption of the fake, not tested against Sabre.
- It answers like production: empty queues, the end of the queue, `place` moving the PNR, the
  required PIC, and an expired session with `fake.expireSessions()`. `fake.calls` lists what the
  SDK asked for.
- **Not simulated**: PCCs (the queues are the same for any `pcc`) and `selection`, which gets an
  error instead of the whole queue, in `access` and in `list`.
- `queueFixtures` holds the anonymized responses recorded in production (`walk`, `emptyQueue`,
  `place`, …), as `{ operation, status, body }`. Each one has its own locator aliases (`walk`:
  `AAAAAA`–`AAAAAD`, `place`: `AAAAAE`–`AAAAAF`, `placeWithoutInstructionCodeInside`:
  `AAAAAG`–`AAAAAH`), and their signature lines keep their shape (`… <alias> H`).
- `queueFakePnrs(fixture)` turns a recording into the fake's PNRs: those of `list` first, in
  order, with their `Line`, and the paragraph `access`, `ignore`, `remove` or `place` showed for
  each one. You choose the queue, and you can mix fixtures:

  ```ts
  const fake = createQueueFake({
    queues: { '9': queueFakePnrs(queueFixtures.walk), '50': [] },
    pnrs: queueFakePnrs(queueFixtures.place),
  });
  ```

`examples/queue-review.mjs` is a full example, and its test runs it against the fake.

#### Anonymizing recorded responses

`createAnonymizer` applies the rule the SDK's fixtures were recorded with, so you can store
Sabre's responses (for example from `onRawResponse`) without passenger data:

```ts
import { createAnonymizer } from 'sabre-client/testing';

const anonymizer = createAnonymizer({ secrets: [pcc, username] });
const safe = anonymizer.anonymize(raw.body); // a whole SOAP envelope
anonymizer.maskParagraph(item.paragraph); // host-format lines
if (anonymizer.leaks(safe).length > 0) throw new Error('real data left');
```

- Each locator gets an alias (`AAAAAA`, `AAAAAB`…), the same one everywhere it appears, also in
  later texts passed to the same anonymizer. `PassengerName` becomes `PASAJERO/UNO`, `Group`
  becomes `GRUPO`, `AgentSine` becomes `AAA` (except `SABRE`), `PseudoCityCode` becomes `XXXX`,
  `LNIATA` becomes `XXXXXX`, and each `secret` becomes `XXXX`.
- In host-format lines (`<Text>`, or `maskLine` and `maskParagraph`), only the lines of a
  whitelist stay as they are (`isSafeHostLine`: empty lines, PIC notices like `011  SEE REMARKS`,
  section titles, the end of the queue). In the others, letters become `X` and digits `9`. The
  signature line keeps its shape, and its locator only if it is already an alias.
- `leaks(text)` lists the real data still in `text` (`'secreto'`, `'localizador'`, `'nombre'`,
  `'línea del PNR'`, `'token'`): use it before writing a file.
- Use one anonymizer per recording. It is a rule, not a guarantee: check what you store.

## Error handling

Every error thrown by the SDK extends `SabreError`:

| Class | When | Extra fields |
| - | - | - |
| `SabreGatewayError` | HTTP or gateway failure (`ERR.2SG.*`, `401`, `429`, `5xx`, OAuth errors) | `protocol`, `status`, `code` |
| `SabreOrchestrationError` | Orchestrated service error inside a `200` (`SP.*`) | `code` |
| `SabreBusinessError` | Error from a service's own catalog (e.g. `No Availability`, a booking that was not created) | `service`, `code`, `warnings`, `errors` |
| `SabreSessionError` | SOAP session failure in `SabreLegacy`, a subclass of `SabreGatewayError` | `kind`: `'limit'` (more than 50 sessions), `'invalid'`, `'expired'`, `'blocked'` |
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

Every REST operation (`air.bargainFinderMax`, `air.revalidateItinerary`, `air.getSeats`,
`booking.create`, `booking.get` and `booking.cancel`), and every `SabreLegacy` operation, accepts
an `onRawResponse` callback in its
options, next to `signal`. It receives Sabre's response as it arrived, for example to store it
next to the typed result. For `air.getSeats`, `operation` names the endpoint that was called
(`air.getSeatsByPayload` or `air.getSeatsByPnrLocator`):

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

In `SabreLegacy`, `protocol` is `'soap'`, `body` is the whole SOAP envelope, and `operation` is
`'openSession'`, `'close'`, `'ping'`, `'command'` or `'queue.<method>'`. The session token
(`BinarySecurityToken`) is replaced by `[REDACTED]` wherever it appears. Nothing else is changed.

> [!WARNING]
> `body` is the raw response and **contains passenger data**. The SDK never sends it to the
> logger. Where you store it is up to you.

## Raw request

The same operations accept `onRawRequest`, next to `onRawResponse`. It receives what the SDK sent
over the network, for example to show the real request next to the response:

```ts
import type { SabreRawRequest } from 'sabre-client';

let sent: SabreRawRequest | undefined;
await sabre.booking.get({ confirmationId }, { onRawRequest: (r) => (sent = r) });
// sent: { operation: 'booking.get', protocol: 'rest', method, url, headers, body, attempts }
```

- `operation` is the same value `onRawResponse` gets. `url` is the full URL, with its query
  string. `headers` are the ones sent, **without `Authorization`** (the whole header is dropped).
  `body` is the text sent, or `undefined` if there was none. In REST it is untouched; in
  `SabreLegacy` it is the whole SOAP envelope with the `BinarySecurityToken` replaced by
  `[REDACTED]`, as in the response.
- It is called **once**, with the last attempt sent, before the operation returns or throws and
  before `onRawResponse`. Unlike `onRawResponse`, it is also called when no attempt got an HTTP
  response (network error, abort), as long as at least one was sent. It is not called if the
  operation throws before sending anything (for example a `TypeError` from validation).
- In SOAP, `eb:MessageId` and `eb:Timestamp` are new on every attempt, so the envelope you get is
  the one of the last attempt.
- It is not called for authentication: the OAuth token request, `openSession`
  (`SessionCreateRQ`, whose envelope carries the EPR password) and `close` (`SessionCloseRQ`).
- It is synchronous and its return value is ignored. If it throws, the SDK logs
  `sabre.request.rawRequestHookFailed` without the body, and the operation carries on.

> [!WARNING]
> `body` and `url` **contain passenger data** (locators, names, contact details). The SDK never
> sends them to the logger. Where you store them is up to you.

## Retries

Only idempotent operations are retried: Bargain Finder Max and Revalidate Itinerary (both
are read-only `POST`s). Create Booking is never retried. Retries use exponential backoff with
full jitter and a 500 ms floor, on `429`, `500`, `503`, `504`, `SP.PROVIDER_ERROR` and the
temporary errors in the Bargain Finder Max catalog.

In `SabreLegacy`, `count`, `list` and `ping` are reads and are retried on transient failures. The
operations that move the queue cursor (`access`, `ignore`, `remove`, `place`, `exit`) are retried
only on the `USG_*_BUSY` codes, which are taken to mean that Sabre did not process the request, and on
`PREVIOUS ENTRY ACTIVE` (3 × 1 s). They are never retried after a network failure, because the PNR
may already have moved: the queue state becomes `'unknown'`.

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
`sabre.request.retry`, `sabre.request.rawResponseHookFailed`,
`sabre.request.rawRequestHookFailed`, `sabre.auth.token.refresh`,
`sabre.auth.token.store`, `sabre.booking.seat.priced`, `sabre.session.open`,
`sabre.session.close`, `sabre.session.closeFailed`, `sabre.session.keepAliveFailed`,
`sabre.session.command`, `sabre.queue.exitTolerated`, `sabre.queue.exitFailed`), never raw
request or response bodies. Secrets, the `Authorization` header and passenger data are always
redacted before they reach your logger.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
