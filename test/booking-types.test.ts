// Tipos completos de `Booking` (#158): se leen sin cast. Los corre `npm run typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { Booking, BookingFare, BookingFareCreationDetails, BookingFlight, GetBookingResponse } from '../src/index.js';
import atpco from './fixtures/get-booking.sandbox-atpco.json';
import ndc from './fixtures/get-booking.wiki-example.json';

describe('tipos de Booking', () => {
  it('flights[].flightStatusCode se lee sin cast', () => {
    const read = (booking: GetBookingResponse) => booking.flights?.[0]?.flightStatusCode;
    expectTypeOf(read).returns.toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<Booking['flights']>[number]>().toEqualTypeOf<BookingFlight>();
  });

  it('el TAW, hasValidPricing y updatedDeparture* (Q-091)', () => {
    expectTypeOf<BookingFare['creationDetails']>().toEqualTypeOf<BookingFareCreationDetails | undefined>();
    expectTypeOf<BookingFareCreationDetails['purchaseDeadlineDate']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<BookingFare['hasValidPricing']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<BookingFlight['updatedDepartureDate']>().toEqualTypeOf<string | undefined>();
  });

  it('un campo que Sabre agregue después de la v1.33 sigue entrando', () => {
    const booking: Booking = { bookingId: 'ABC123', newField: { any: 'thing' } };
    expectTypeOf(booking.newField).toEqualTypeOf<unknown>();
  });
  it('la reserva real de CERT (ATPCO) y el ejemplo NDC del wiki entran sin cast', () => {
    const real: Booking = atpco.response.body;
    const example: Booking = ndc;
    expectTypeOf(real).toEqualTypeOf<Booking>();
    expectTypeOf(example).toEqualTypeOf<Booking>();
  });
});
