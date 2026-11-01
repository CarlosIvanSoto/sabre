// Armado de `flightDetails` de Create Booking desde un itinerario de BFM/Revalidate.
// El mapeo está inferido, ninguna fuente lo documenta: ver la tabla "Mapeo desde un
// itinerario de BFM/Revalidate → flightDetails" en sabre-wiki/wiki/entities/booking-management-api.md.
import type { GetSeatsResponse } from '../air/get-seats.js';
import type { Itinerary, ItineraryGroup } from '../air/grouped-itinerary.js';
import { itineraryFlights } from '../air/itinerary-flights.js';
import type { FlightDetails, FlightToBook, PassengerPricing, PriceComparison } from './create-booking-request.js';

/** Patrón de `BookGenericSeat.number` en el spec de Booking Management. */
const SEAT_NUMBER = /^[0-9]+[A-Z]$/;

/** Asiento elegido para un vuelo del itinerario. */
export interface BookingSeatSelection {
  /**
   * Número del vuelo en el itinerario, empezando en 1 (`1` es `flights[0]`). Misma base que
   * `travelerIndex`, para no confundirlos.
   */
  segmentIndex: number;
  /** Número del viajero en `travelers[]` de Create Booking, empezando en 1 (lo fija el spec). */
  travelerIndex: number;
  /** Fila y columna, p. ej. `13A`. */
  number: string;
}

/** Asiento elegido que tiene precio en Get Seats. Sin datos del pasajero. */
export interface PricedSeat {
  /** Empieza en 1, como en `BookingSeatSelection`. */
  segmentIndex: number;
  /** Vuelo comercializador, p. ej. `AA1234`. */
  flight: string;
  seat: string;
  amount: string;
  currencyCode: string;
}

/**
 * Asientos con precio de cada `FlightDetails` armado por `buildBookingFlightDetails`. El
 * helper es puro y no tiene logger: `booking.create` los busca acá y emite el `warn` con el
 * logger del cliente. Si el objeto se clona, el aviso se pierde; el request no cambia.
 */
const pricedSeats = new WeakMap<FlightDetails, PricedSeat[]>();

/** @internal Para `booking.create`. */
export function pricedSeatsOf(details: FlightDetails | undefined): PricedSeat[] {
  return details === undefined ? [] : (pricedSeats.get(details) ?? []);
}

export interface BookingFlightDetailsSource {
  /** Grupo del itinerario: aporta la fecha de cada tramo. */
  group: ItineraryGroup;
  /** Itinerario elegido, idealmente el devuelto por Revalidate Itinerary. */
  itinerary: Itinerary;
  /**
   * Umbral de precio. `desiredAmount` sale de `totalFare.totalPrice` del itinerario. El spec no
   * tiene campo de moneda: se supone la del pricing (la del PCC, salvo `currencyPricing`).
   */
  priceComparison?: Omit<PriceComparison, 'desiredAmount'>;
  /**
   * Asientos por número, para `flights[segmentIndex - 1].seats[]` (camino ATPCO; `seatOffers` es
   * solo NDC). Conviene elegir asientos sin cargo: no se sabe qué hace Sabre con uno cobrable.
   */
  seats?: BookingSeatSelection[];
  /**
   * Respuesta de `sabre.air.getSeats` para el mismo itinerario. Si un asiento elegido tiene
   * precio ahí, `booking.create` emite `sabre.booking.seat.priced` (`warn`) y reserva igual.
   */
  seatAvailability?: GetSeatsResponse;
}

/**
 * Arma `flightDetails` para reservar por el camino ATPCO un itinerario ya revalidado.
 *
 * - `flights[]`: vuelo comercializador, aeropuertos, fecha y clase con las mismas reglas que
 *   Revalidate (`itineraryFlights`); `departureTime` en `HH:MM` y `flightStatusCode: 'NN'`.
 *   `isMarriageGroup` no se manda: no hay fuente para él.
 * - `flightPricing[0].qualifiers`: `passengersPricing` desde `passengerInfoList` y
 *   `validatingAirlineCode` desde `validatingCarrierCode` de la primera cotización.
 * - `seats`: se validan sin llamar a Sabre (`number` con el patrón del spec, vuelo y viajero
 *   existentes, los dos índices empiezan en 1) y se agregan a `flights[segmentIndex - 1].seats[]`.
 *   Sin `seats`, nada cambia.
 */
export function buildBookingFlightDetails(source: BookingFlightDetailsSource): FlightDetails {
  const { group, itinerary, priceComparison, seats = [], seatAvailability } = source;
  const flights = itineraryFlights(group, itinerary).map(
    ({ schedule, departureDate, bookingCode }): FlightToBook => ({
      flightNumber: schedule.carrier.marketingFlightNumber,
      airlineCode: schedule.carrier.marketing,
      fromAirportCode: schedule.departure.airport,
      toAirportCode: schedule.arrival.airport,
      departureDate,
      departureTime: schedule.departure.time.slice(0, 5),
      bookingClass: bookingCode,
      flightStatusCode: 'NN',
    }),
  );

  const fare = itinerary.pricingInformation[0]?.fare;
  if (fare === undefined) {
    throw new TypeError('sabre-client: el itinerario no trae pricingInformation');
  }
  const passengersPricing = fare.passengerInfoList.map(
    ({ passengerInfo }): PassengerPricing => ({
      passengerCode: passengerInfo.passengerType,
      numberOfpassengers: passengerInfo.passengerNumber ?? 1,
    }),
  );

  let priceComparisons: PriceComparison[] | undefined;
  if (priceComparison !== undefined) {
    const total = fare.totalFare?.totalPrice;
    if (total === undefined) {
      throw new TypeError('sabre-client: el itinerario no trae totalFare.totalPrice para priceComparison');
    }
    priceComparisons = [{ desiredAmount: amount(total), ...priceComparison }];
  }

  const travelerCount = passengersPricing.reduce((n, p) => n + (p.numberOfpassengers ?? 1), 0);
  const priced: PricedSeat[] = [];
  for (const selection of seats) {
    const flight = flights[validSeat(selection, flights.length, travelerCount)]!;
    (flight.seats ??= []).push({ number: selection.number, travelerIndex: selection.travelerIndex });
    const price = seatAvailability === undefined ? undefined : seatPrice(seatAvailability, flight, selection.number);
    if (price !== undefined) {
      priced.push({
        segmentIndex: selection.segmentIndex,
        flight: `${flight.airlineCode}${flight.flightNumber}`,
        seat: selection.number,
        ...price,
      });
    }
  }

  const details: FlightDetails = {
    flights,
    flightPricing: [
      {
        ...(priceComparisons === undefined ? {} : { priceComparisons }),
        qualifiers: {
          passengersPricing,
          ...(fare.validatingCarrierCode === undefined ? {} : { validatingAirlineCode: fare.validatingCarrierCode }),
        },
      },
    ],
  };
  if (priced.length > 0) pricedSeats.set(details, priced);
  return details;
}

/** Devuelve la posición en `flights[]` (`segmentIndex - 1`) si la selección es válida; si no, `TypeError`. */
function validSeat(selection: BookingSeatSelection, flightCount: number, travelerCount: number): number {
  const { segmentIndex, travelerIndex, number } = selection;
  if (typeof number !== 'string' || !SEAT_NUMBER.test(number)) {
    throw new TypeError(`sabre-client: el asiento ${String(number)} no cumple ^[0-9]+[A-Z]$ (p. ej. 13A)`);
  }
  if (!Number.isInteger(segmentIndex) || segmentIndex < 1 || segmentIndex > flightCount) {
    throw new TypeError(
      `sabre-client: el asiento ${number} pide el vuelo ${segmentIndex}, y hay ${flightCount} (empieza en 1)`,
    );
  }
  if (!Number.isInteger(travelerIndex) || travelerIndex < 1 || travelerIndex > travelerCount) {
    throw new TypeError(
      `sabre-client: el asiento ${number} pide el viajero ${travelerIndex}, y hay ${travelerCount} (empieza en 1)`,
    );
  }
  return segmentIndex - 1;
}

/**
 * Precio del asiento en Get Seats, si es mayor que cero. El segmento se busca por vuelo,
 * fecha y aeropuerto de salida, no por `id`: así no depende de cómo se armó el request.
 * Ruta: `seats[].offerItemRefIds` → `offerItems[].priceDefinitionRef` → `priceDefinitions[]`.
 */
function seatPrice(
  availability: GetSeatsResponse,
  flight: FlightToBook,
  number: string,
): { amount: string; currencyCode: string } | undefined {
  const { response } = availability;
  const segmentIds = new Set(
    response.segments
      .filter(
        (s) =>
          s.bookingAirlineCode === flight.airlineCode &&
          s.bookingFlightNumber === flight.flightNumber &&
          s.departureAirportCode === flight.fromAirportCode &&
          s.departureDate === flight.departureDate,
      )
      .map((s) => s.id),
  );
  const row = Number(number.slice(0, -1));
  const column = number.slice(-1);
  const seat = response.seatMaps
    .filter((map) => segmentIds.has(map.segmentRef))
    .flatMap((map) => map.cabinCompartments ?? [])
    .flatMap((cabin) => cabin.seatRows ?? [])
    .filter((r) => r.row === row)
    .flatMap((r) => r.seats)
    .find((s) => s.column === column);

  for (const itemId of seat?.offerItemRefIds ?? []) {
    const item = response.offerItems.find((i) => i.id === itemId);
    const price = response.priceDefinitions?.find((p) => p.id === item?.priceDefinitionRef);
    if (price !== undefined && Number(price.totalPrice.amount) > 0) {
      // Sabre manda número aunque el spec diga string: se normaliza para el evento.
      return { amount: String(price.totalPrice.amount), currencyCode: price.currencyCode };
    }
  }
  return undefined;
}

/** `1234.5` → `'1234.5'`; el spec acepta hasta 3 decimales. */
function amount(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}
