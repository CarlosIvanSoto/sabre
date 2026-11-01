# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**Complete rewrite.** This will be released as `0.3.0`. It is not an incremental update to
`0.2.4`: the package is rebuilt from scratch on a different architecture, and code written
against `0.2.4` will not work unchanged. Since the package is still `0.x`, the rewrite ships
as a minor bump. Versions `0.2.4` and earlier stay published as they are.

`0.3.0` will be released once Tier 1 and Tier 2 (Get Seats) of the Air Booking flow are done.
Get Ancillaries is NDC only and moved to after `0.3.0`.

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
  production sends numbers although the spec says strings.
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
  `error` or `errors[0].code`, and add `errors[0].descriptionText` to the message when Sabre
  sends it.
- Web Standard APIs only: runs on Node.js `>=22.12` and on server-side edge runtimes.
  ESM-only build.

### Removed

- The whole `0.2.4` API. There is no compatibility layer.
