# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `isMessageQueue(queue)` and `MESSAGE_QUEUE` (`'S'`) in the main entry, to tell the PCC's message
  queue apart from a `QueueRef` without hardcoding `'S'` (#191).

## [0.5.0] - 2026-11-06

Tier 4: queue activity, PNR history, the `S` message queue, `selection` in `list`, `onRawRequest`
and more of the queue fake in `sabre-client/testing`. It has three breaking changes, marked
**BREAKING** below. It is published first under the `next` dist-tag (`npm install
sabre-client@next`), and `latest` stays on `0.4.1` until it is tested.

### Upgrading from 0.4

- **`pcc` is no longer in the config.** Passing it to `new Sabre` or `new SabreLegacy` is a type
  error, and in JavaScript it is ignored. It was never read: the PCC you authenticate with goes in
  `credentials` (`buildCredentials`), and another PCC goes per operation, as `targetPcc` in REST
  or `pcc` in the queue operations.
- **`QueueRef` can be a `string`.** An alphabetic queue like `'S'` is `'S'`, and `count` and
  `place` return it that way instead of `{ name: 'S' }`. Code that does
  `typeof q === 'number' ? … : q.name` must handle the `string` case.
- **A `QueueStep` that is not done has a `kind`.** Check `step.kind === 'pnr'` before reading
  `step.item`; `kind: 'message'` carries a message of the `S` queue.

### Added

- The fake of `sabre-client/testing` answers `queue.activity` and `reservation.history`.
  `numMessages` follows the fake's queues, and the other counters are seeded with the new
  `activity` option (0 by default); the fake's actions do not change them, since no one has tested
  which counter Sabre raises. The history of each PNR is seeded with `histories`; without it, a
  known PNR returns a synthetic creation transaction. Inside a queue, the history of another PNR
  is rejected with `NAK6`, as in CERT. New types `QueueFakeActivity` and
  `QueueFakeHistoryTransaction`, and `QueueFakeCall` gets `locator` and the `'activity'` and
  `'history'` commands. New example `examples/queue-health.mjs`, tested against the fake (#167).

- `queueFakePnrs(fixture)` in `sabre-client/testing`: the PNRs of a recording (`queueFixtures.*`)
  as `QueueFakePnr[]`, ready for `createQueueFake`. The ones from `list` come first, in order, with
  `placedAt`, `placedBy` and `primaryPassenger` from their `Line`, and each one gets the paragraph
  that `access`, `ignore`, `remove` or `place` showed for it (#166).

- `createAnonymizer({ secrets? })` and `isSafeHostLine(line)` in `sabre-client/testing`: the
  anonymization the SDK's queue fixtures are recorded with, so consumers do not have to copy it.
  The anonymizer has `anonymize(text)` for a whole envelope, `maskLine` and `maskParagraph` for
  host-format lines, `aliasOf(locator)` and `leaks(text)`, which lists the real data left. The
  recording scripts now use it, and the output on the existing fixtures did not change. New types
  `Anonymizer`, `AnonymizerOptions` and `AnonymizerLeak` (#165).

- `onRawRequest`, next to `onRawResponse`, in every REST and `SabreLegacy` operation: what the SDK
  sent over the network (`operation`, `protocol`, `method`, full `url`, `headers` without
  `Authorization`, `body` and `attempts`). In SOAP the `BinarySecurityToken` of the envelope is
  `[REDACTED]`. It is called once, with the last attempt sent, before `onRawResponse`, and also
  when no attempt got an HTTP response. It is not called for the OAuth token, `openSession` or
  `close`. A callback that throws logs `sabre.request.rawRequestHookFailed` and the operation goes
  on. The body carries passenger data. New types `SabreRawRequest` and `SabreRawRequestCallback`
  (#160).

- `selection` in `session.queue.list`, as in `access` (up to 8 filters). In the list Sabre only
  accepts `QD` (date placed on the queue) or `AK` (the agent who placed it), and answers any other code with `VALID
  SELECTION CODE FOR QUEUE LIST ARE QD OR AK`, so the SDK throws a `TypeError` without calling
  Sabre. `list` needs no paging: production returned a queue of 1221 PNRs in one response (#162).

- `session.reservation.history(locator)` (Get Itinerary History, `TravelItineraryHistoryLLSRQ`
  2.4.0, the host's `*H`): the PNR history, one entry per transaction, with who signed it, when
  (`createdAt`, with a year) and from which PCC (`pcc`, `aaaPcc`), `receivedFrom`, and what changed
  with its `action`: `flightSegments` with their status, and SSR, ticketing, phones, names and
  emails as text in `generalInfo`, plus `remarks` and `accounting`. What is not typed stays in the
  raw response. It reads both `AAA_PseudoCityCode` (CERT) and `AAAPseudoCityCode` (the sample).
  Inside a queue, Sabre rejects the history of another PNR (`NAK6 -NOT ALLOWED- FINISH OR IGNORE
  OTHER ACTIVITY`, a `SabreBusinessError`) and the walk goes on. The history does not record queue
  placements. New `SessionReservation` and `ReservationHistory*` types (#164).

- `session.queue.activity({ pcc? })` (Get Queue Activity, `QueueAnalysisLLSRQ` 2.0.0, the host's
  `QA`): per queue, the eight counters (`numMessages`, `ended`, `ignored`, `moved`, `removed`,
  `transferred`, `leftMessageToContact`, `unableToReach`), the `totals` for the PCC and
  `analyzedAt`. The queue comes as in `count` (`'S'` for the message queue). It is a read, retried
  like `count`, and it does not need duty code 9. New types `QueueActivity`,
  `QueueActivityCounters`, `QueueActivityRequest`, `QueueActivityResponse` and
  `QueueActivityOptions` (#161).

- `parseQueuePlaceRemark(text)`: splits the `text` of a `QUEUE_PLACE` remark from Get Booking
  (`'MEX25SEP146/015'`) into `{ pcc, date, queue, pic }` (new `QueuePlaceRemark` type), or `null`
  if it does not have that shape or a part is out of range. `date` stays as `DDMMM`, without a
  year (#163).

- Get Seats response fields that Sabre sends outside the 3.0 spec: `reservationSegmentId` in
  `SeatSegmentRs` (it matches `flights[].itemId` and `allSegments[].id` in Get Booking) and
  `aisles` in `SeatCabinLayout`, with the new `SeatCabinAisle` type. `SeatMap.flightLegRef` can
  now be `null`, as `byPnrLocator` sends it on a nonstop flight (#159).
- `codeShared` in `ScheduleCarrier` (`scheduleDescs[].carrier`) of BFM and Revalidate: the
  operator's name, as Sabre sends it (e.g. `'/AVIANCA'`). It is not in the spec (#159).
- The config accepts credentials from `buildCredentials` whose version is not known at compile
  time (`buildCredentials(options: BuildCredentialsOptions)`), with no `authVersion` in the
  config: new `SabreConfigFromCredentials` and `SabreCredentialsAnyVersion` types. The version is
  taken from the credentials at runtime (Q-084, #159).
- Full `Booking` types for Get Booking and Create Booking, generated from the v1.33 spec: 128
  types with the `Booking` prefix (`BookingFlight`, `BookingFare`, `BookingTraveler`…), all
  exported. `booking.flights[0].flightStatusCode` now reads without a cast. Enums stay open
  (`| (string & {})`), and `Booking` keeps an index signature for fields Sabre adds later. The
  TSDoc notes what Q-091 found: `fares[].hasValidPricing: false` means the purchase deadline
  (`TAW`) has passed, the `TAW` comes in `fares[].creationDetails`, and `updatedDeparture*` is an
  operational delay, not a schedule change (#158).
- `respondedAt` in the SOAP results: `session.command()` and the queue operations (`count`,
  `list`, `access`, `ignore`, `remove` and `place`). It is Sabre's `eb:Timestamp`, in ISO 8601
  UTC (`'2026-11-06T17:34:16Z'`), with a year and a zone, unlike `countedAt` and `placedAt`. An
  end of queue that Sabre sends as an `stl:Error` also carries it (#157).

### Changed

- `queueFixtures` no longer reuses locator aliases across recordings: `place` now uses
  `AAAAAE`–`AAAAAF` and `placeWithoutInstructionCodeInside` uses `AAAAAG`–`AAAAAH` (`walk` keeps
  `AAAAAA`–`AAAAAD`). The signature lines of `walk` and `placeWithoutInstructionCodeInside`, which
  were masked whole (`… XXXXXX X`), now keep their shape with the alias (`… AAAAAA H`), as in
  `place`. Each fixture says so in `postprocessed`. Code that looked for `AAAAAA` in `place` must
  use `AAAAAE` (#166).

- The docs of `placedAt` now say what each date is: in `QueueListEntry` (`list`) it is when the PNR
  was placed on the queue, the date `QD` filters on; in `QueueItem` (`access` and the steps) it is
  the PNR's last change. The values do not change (#162).

- **BREAKING**: `QueueRef` is now `number | string | { name }` (ADR-028). An alphabetic queue
  (one or two uppercase letters, like `'S'`) is a `string` and is sent as `Number="S"`, as Sabre
  expects. `count` and `place` return it as `'S'` instead of `{ name: 'S' }`, which Sabre rejected
  with `INVALID QUEUE NAME FORMAT`. Code that does `typeof q === 'number' ? … : q.name` must
  handle the `string` case. A `{ name }` of one or two uppercase letters, a numeric string (`'12'`)
  and a lowercase letter (`'s'`) throw a `TypeError` without calling Sabre (#169).
- `list({ queue: 'S' })` throws a `TypeError` without calling Sabre: `S` is the PCC's message
  queue, and Sabre does not list it (#169).
- **BREAKING**: `QueueStep` has a `kind` when it is not done: `{ done: false, kind: 'pnr', item }`
  for a PNR, or `{ done: false, kind: 'message', message: { text } }` for a message of the `S`
  queue (new `QueueMessage` type). `access({ queue: 'S' })` and `ignore()` inside it now return
  the message instead of throwing a `SabreGatewayError`, and its end of queue (`END OF DISPLAY` as
  `Paragraph/Text` with status `Complete`) gives `{ done: true }`. Code that reads `step.item`
  must check `step.kind === 'pnr'` first. Showing a message does not remove it (CERT,
  2026-11-06). `process({ queue: 'S' })` and `place` inside `S` throw a `TypeError` without
  calling Sabre (#169).
- `sabre-client/testing`: in the queue fake, `queues['S']` holds messages (`string[]` each), not
  PNRs, and `access` shows them without `Line`. `place` to `S` is not simulated. New
  `fake.messages()` (#169).
- `sabre-client/testing`: the queue fake keeps alphabetic and named queues apart. In
  `QueueFakeOptions.queues`, `'S'` is the alphabetic queue and `'name:HOTELS'` (or `'HOTELS'`) a
  named one, and each response uses the right attribute (#169).

### Removed

- **BREAKING**: `pcc` in the `Sabre` and `SabreLegacy` config, deprecated in `0.4.1`. Passing it
  is now a type error in TypeScript, and in JavaScript it is no longer validated and is ignored.
  No client read it. The PCC you authenticate with goes in `credentials` (`buildCredentials`
  builds it); to work in another PCC, pass it per operation: `targetPcc` in REST, `pcc` in the
  queue operations (#147).

## [0.4.1] - 2026-11-04

### Changed

- `buildCredentials` now returns its `authVersion` in the credentials object, and the `Sabre` and
  `SabreLegacy` config takes it from there when the config has no `authVersion` of its own. With
  `buildCredentials({ authVersion: 'v2', … })`, the config no longer has to repeat
  `authVersion: 'v2'`, in the types or at runtime (#148). A config `authVersion` that does not
  match the credentials throws a `TypeError`. Hand-built credentials work as before.
- New types: `BuiltCredentialsV3`, `BuiltCredentialsV2` and `SabreConfigV2FromCredentials`.

### Deprecated

- `pcc` in the `Sabre` and `SabreLegacy` config. It was a reserved field, and no client reads
  it. It is still accepted and validated as before, and it will be removed in `0.5.0`. The PCC
  you authenticate with goes in `credentials` (`buildCredentials` builds it); to work in another
  PCC, pass it per operation: `targetPcc` in REST, `pcc` in the queue operations.

## [0.4.0] - 2026-11-04

Two additions, with nothing removed or changed in the `0.3.0` API: a helper to build
`credentials` and an escape hatch for host commands in the SOAP session.

### Upgrading from 0.3.0

- **The constructor does not change.** `credentials.username` still takes the full EPR
  (`<user>-<PCC>-<domain>` for v3, `V1:<user>:<PCC>:<domain>` for v2). `buildCredentials` is
  optional.
- **Examples and scripts use one set of variables.** `SABRE_USERNAME` is now the EPR user alone,
  not the full EPR, and `SABRE_ORGANIZATION` is gone. `SABRE_PCC`, `SABRE_DOMAIN` (`AA` by
  default), `SABRE_PASSWORD` and `SABRE_CLIENT_ID`/`SABRE_CLIENT_SECRET` complete it; see
  `.env.example`.
- **DEVCENTER credentials no longer work in the examples.** `DEVCENTER` is a group, not a PCC,
  and `buildCredentials` only takes a PCC of 3 or 4 characters.

### Added

- `buildCredentials` builds the `credentials` object from the EPR user, PCC, domain (`AA` by
  default) and password, plus the optional `clientId`/`clientSecret`. The same object works for
  `Sabre` and `SabreLegacy`: there is one set of credentials for REST and SOAP, and the OAuth
  version only changes the `username` format. It does not read environment variables.
- `session.command(command, options?)` sends a host command (`SabreCommandLLSRQ` 2.0.0) inside a
  SOAP session and returns the screen as text, plus `warnings` and `messageId`. The command is sent
  as is (`¥`, not `‡`), it is not retried unless `{ idempotent: true }`, and a host message on the
  screen does not throw. The screen comes back untrimmed, and a command longer than 1023 characters
  (counted as Sabre does: `!`, `%`, `$`, `&`, `¥` and `§` count 2) throws a `TypeError` without
  calling the network. The debug log carries only the first token of the command.

### Changed

- Get Seats `byPnrLocator` is now checked against Sabre (sandbox), with a booking created in
  the PCC used to authenticate. The "not checked against Sabre yet" limitation no longer
  applies; reading a booking from another PCC is still not possible, because the request has
  no `targetPcc`. In sandbox, seats come back as free (`F`) even when the PNR holds them.

## [0.3.0] - 2026-11-02

**Complete rewrite.** It is not an incremental update to
`0.2.4`: the package is rebuilt from scratch on a different architecture, and code written
against `0.2.4` will not work unchanged. Since the package is still `0.x`, the rewrite ships
as a minor bump. Versions `0.2.4` and earlier stay published as they are.

`0.3.0` covers Tier 1 and Tier 2 (Get Seats) of the Air Booking flow and Tier 3 (SOAP sessions
and queues). Get Ancillaries is NDC only and moved to after `0.3.0`.

### Added

- `Sabre` REST client, configured with an explicit `SabreConfig` object. The SDK never reads
  environment variables. `environment` selects sandbox (CERT) or production.
- Authentication with OAuth Token Create v3 (default) or v2 (`authVersion`), handled
  internally: in-memory token cache, proactive renewal before expiry, a single in-flight token
  request shared by concurrent calls, and one reactive retry on `401`.
- Optional `tokenStore` (`SabreTokenStore`) to reuse the token between processes.
- `sabre.air.bargainFinderMax`: Bargain Finder Max v5, with the `groupedItineraryResponse`
  references resolved into self-contained itineraries.
- `sabre.air.revalidateItinerary`: Revalidate Itinerary v5, plus
  `buildRevalidateItineraryRequest` to build the request from a Bargain Finder Max itinerary.
  Its own error catalog (`NO FARE FOR CLASS USED`, `NO SUCH FLIGHT`, …) gives stable, non-retryable
  `SabreBusinessError` codes.
- `sabre.booking.create`: Create Booking from the Booking Management API v1 through the ATPCO
  path (`flightDetails`), plus `buildBookingFlightDetails` to build `flightDetails` from a
  revalidated itinerary. It is never retried automatically. Warnings and non-fatal errors are
  returned on the result instead of being thrown. A request with
  `agency.ticketingPolicy: 'FUTURE_TICKETING'` and no `agency.futureTicketingPolicy` throws a
  `TypeError` before calling the network, since Sabre always rejects it.
- `sabre.air.getSeats`: Get Seats v3, seat map with availability and prices. One function for
  both endpoints: without `pnrLocator` it calls `byReservationPayload`, with `pnrLocator` it
  calls `byPnrLocator`. An empty `pnrLocator`, or one mixed with payload fields, throws a
  `TypeError` before calling the network. Get Seats has no published error catalog: `errors[]`
  without a seat map throws a non-retryable `SabreBusinessError`; otherwise errors and
  `warnings[]` are returned on the result. `onRawResponse` gets `air.getSeatsByPayload` or
  `air.getSeatsByPnrLocator` as `operation`. Prices are typed as `number | string`, because
  production sends numbers although the spec says strings. Known limitation: `byPnrLocator`
  has no `targetPcc`, so it cannot read a booking created in another PCC (Sabre answers
  `502 Viewership is restricted for the PNR`), and it has not been checked against Sabre yet.
- `buildSeatAvailabilityRequest` to build the Get Seats request from a revalidated itinerary
  (segments `S1`, `S2`, …, fare components and passengers). `segments` picks flights by number,
  starting at 1.
- Seat selection in `buildBookingFlightDetails`: `seats: [{ segmentIndex, travelerIndex, number }]`
  goes to `flightDetails.flights[].seats[]` (ATPCO, by seat number; `seatOffers` is NDC only and
  not supported). Both indexes start at 1. Invalid seat numbers or indexes throw a `TypeError`,
  and `sabre.booking.create` also checks `travelerIndex` against `travelers`. With
  `seatAvailability` (the Get Seats result), a chosen seat that has a price makes
  `sabre.booking.create` log a `sabre.booking.seat.priced` warning and book anyway.
- `sabre.booking.get`: Get Booking from the Booking Management API v1. The booking fields come
  at the top level of the response, as Sabre defines them. It throws only when there is no
  booking (for example `BOOKING_NOT_FOUND`); otherwise warnings and partial errors are
  returned on the result. Transient failures (`INTERNAL_SERVER_TIMEOUT`,
  `DOWNLINE_SERVICE_FAILURE`, gateway `429`/`5xx`) are retried.
- `sabre.booking.cancel`: Cancel Booking from the Booking Management API v1, for the whole
  booking (`cancelAll`) or by `itemId`. It is never retried automatically, and combinations
  that Sabre always rejects throw a `TypeError` before any request is sent.
  `NO_ITEMS_CANCELLED` throws `SabreBusinessError` even though Sabre sends it as a warning.
- Typed error hierarchy: `SabreError`, `SabreGatewayError`, `SabreOrchestrationError`,
  `SabreBusinessError` and `SabreWarning`, each with `retryable`. `SabreBusinessError` carries
  the `warnings` and other `errors` that arrived with it. `SabreError.raw` keeps the
  original response fragment; it can contain credentials or passenger data and is not
  enumerable.
- Retries with exponential backoff and full jitter (500 ms floor), only for idempotent
  operations, configurable per client and per request.
- `onRawResponse` request option on every REST operation: it receives Sabre's raw response
  (`SabreRawResponse`: `operation`, `status`, `headers`, `body` as text, `attempts`) once, from
  the last HTTP attempt, before the operation returns or throws. Token requests are not
  delivered. If the callback throws, the operation carries on and the SDK logs
  `sabre.request.rawResponseHookFailed` without the body. The body contains passenger data and
  never reaches the logger.
- Injectable `logger` that emits structured events and always redacts secrets, the
  `Authorization` header and passenger data.
- Gateway errors (`SabreGatewayError`) take their `code`, best effort, from `errorCode`,
  `error`, `errors[0].code` or `errors[0].type`, and add `errors[0].descriptionText` (or
  `errors[0].description`) to the message when Sabre sends it.
- `SabreLegacy` SOAP client, with the same `SabreConfig` as `Sabre`. The session's user, PCC and
  domain come from `credentials.username`. It opens `SessionCreateRQ` 2.0.0 when the credentials
  have `clientId` and `clientSecret`, and 1.0.0 when they have neither. Both were checked in
  production.
- SOAP sessions: `legacy.withSession(callback)` opens a session and always closes it, and
  `legacy.openSession()` hands it over with an idempotent `close()`. A session is exclusive: a
  second concurrent call throws `TypeError` without calling the network. `session.ping()`,
  `session.idleMs` and `openSession({ keepAlive: true })` (a ping after 13 minutes of
  inactivity). No session pool, and no automatic reopening.
- `SabreSessionError`, a subclass of `SabreGatewayError` with `kind`: `'limit'`, `'invalid'`,
  `'expired'` or `'blocked'`. After one, the session is unusable and later calls throw without
  calling the network.
- Queue Management in `session.queue`: `count`, `list`, `access`, `ignore`, `remove`, `place` and
  `exit`, with `QueueRef` (a queue number from 0 to 511, or `{ name }`). The end of the queue is a
  result (`{ done: true, reason: 'end-of-display' | 'empty' }`), not an error. The operations that
  move forward return the next PNR. `session.queue.state` tracks whether the session is inside a
  queue. `place` requires `instructionCode` (the PIC) in every target, because production rejects
  a `place` without it.
- `session.queue.process(request, callback)` walks a queue, runs the action the callback returns
  (`remove`, `ignore` or `place`) and always leaves the queue, with an optional `limit`.
- `parseQueueParagraph`, a best-effort parser for the host-format PNR of a queue item: queue
  notices, names, segments, the ticketing field and the received-from line. Lines it does not
  recognize go to `unparsed`. `resolveHostDate` resolves the year of a host date against a
  reference date.
- SOAP reliability: `onRawResponse` on every `SabreLegacy` operation, with the whole envelope
  and the session token replaced by `[REDACTED]`. Retries: reads (`count`, `list`, `ping`) are
  retried on transient failures. The operations that move the cursor are retried only on
  `USG_*_BUSY` and `PREVIOUS ENTRY ACTIVE`, and never after a network failure.
- `sabre-client/testing`, a separate entry point that is not part of the main bundle:
  `createQueueFake` returns a `fetch` that answers like Sabre's sessions and queues, for testing
  queue logic without the network. `queueFixtures` holds anonymized production responses.
- Web Standard APIs only: runs on Node.js `>=22.12` and on server-side edge runtimes.
  ESM-only build.

### Removed

- The whole `0.2.4` API. There is no compatibility layer.

[Unreleased]: https://github.com/CarlosIvanSoto/sabre/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/CarlosIvanSoto/sabre/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/CarlosIvanSoto/sabre/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/CarlosIvanSoto/sabre/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/CarlosIvanSoto/sabre/releases/tag/v0.3.0
