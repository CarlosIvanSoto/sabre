import { Traveler, TravelersGroup, Flight, Journey, FareRule, FareOffer, Fare, Hotel, Car, Train, Cruise, SegmentBasics, FlightTicket, TotalPayments, SpecialService, AccountingItem } from './booking'
import { CreationDetails, ContactInformation, Remark, OtherServiceInformation, FutureTicketingPolicy } from '../common/interfaces'
/**
 * Contiene información de reserva.
 */
export interface Booking {
  bookingId: string
  /**
   * La fecha de inicio de la reserva en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html).
   *
   * format: date
   * example: 2019-07-09
   */
  startDate?: string
  /**
   * La fecha de finalización de la reserva en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html).
   *
   * format: date
   * example: 2019-07-19
   */
  endDate?: string
  /**
   * Si es "verdadero", la reserva se puede cancelar en su totalidad o en segmentos. Consulte la matriz `refundPenalties` para obtener más información.
   *
   * example: False
   */
  isCancelable?: boolean
  /**
   * Si es cierto, se emitió al menos un billete para la reserva.
   *
   * example: False
   */
  isTicketed?: boolean
  /**
   * El identificador de cliente utilizado por su agencia de viajes, también conocido como número de cliente o número DK. Puede ser una cadena de seis, siete o 10 caracteres.
   *
   * pattern: ^[0-9A-Z]{6}([1-9A-Z*]{1}|[0-9A-Z]{4})?$
   * example: 1234567
   */
  agencyCustomerNumber?: string
  /**
   * Contiene detalles sobre la creación.
   */
  creationDetails?: CreationDetails
  /**
   * Contiene información de contacto para la reserva.
   */
  contactInfo?: ContactInformation
  /**
   * Enumera los viajeros asociados con la reserva.
   */
  /**
   * Contiene información del viajero.
   */
  travelers?: Traveler[]
  /**
   * Contiene información sobre el grupo al que pertenecen los viajeros.
   */
  travelersGroup?: TravelersGroup
  /**
   * Enumera todos los vuelos asociados con la reserva en orden cronológico.
   */
  /**
   * Contiene información de vuelo, identificada por "itemId", para la reserva dada.
   */
  flights?: Flight[]
  /**
   * Enumera todos los viajes asociados con la reserva.
   * Para unidireccional, esta es una lista de un solo elemento.
   * Para ida y vuelta, la lista contiene dos viajes.
   * Para multidestinos, la lista contiene más de dos viajes.
   */
  /**
   * Contiene detalles de los vuelos dentro del viaje.
   */
  journeys?: Journey[]
  /**
   * Muestra la información sobre las reglas de tarifas más restrictivas que se muestra en el momento de la compra. Este servicio aplica datos de Boletos o Cotizaciones de Precios.
   */
  /**
   * Contiene requisitos de elegibilidad y restricciones de viaje para un vuelo.
   */
  fareRules?: FareRule[]
  /**
   * Enumera ofertas auxiliares para vuelos seleccionados identificados por referencias de vuelo "itemId".
   */
  /**
   * Contiene una oferta complementaria para vuelos seleccionados identificados por referencias de vuelo "itemId" y para viajeros seleccionados identificados por índices en la lista de "viajeros".
   */
  fareOffers?: FareOffer[]
  /**
   * Enumera los detalles de las tarifas guardadas. Este servicio aplica datos ya sea de una cotización de precio o de un artículo de pedido.
   */
  fares?: Fare[]
  /**
   * Contiene una lista de comentarios agregados al PNR.
   */
  /**
   * Contiene comentario agregado al PNR.
   */
  remarks?: Remark[]
  /**
   * Enumera todas las reservas de hotel asociadas con la reserva.
   */
  /**
   * Contiene información de reserva de hotel identificada por "itemId" y asociada con una reserva.
   */
  hotels?: Hotel[]
  /**
   * Enumera todos los alquileres de automóviles asociados con la reserva.
   */
  /**
   * Contiene información de alquiler de automóviles, identificada por "itemId", para la reserva dada.
   */
  cars?: Car[]
  /**
   * Enumera todos los trenes asociados con la reserva.
   */
  /**
   * Contiene información de reserva de tren, identificada por "itemId", para la reserva dada.
   */
  trains?: Train[]
  /**
   * Enumera todos los cruceros asociados con la reserva.
   */
  /**
   * Contiene información de reserva de crucero, identificada por "itemId", para la reserva dada.
   */
  cruises?: Cruise[]
  /**
   * Enumera todos los segmentos de la reserva que se superponen con elementos de reserva contextuales, como vuelos, hoteles, automóviles, trenes, etc. Esta lista también contiene segmentos no relacionados con productos que existen en un sistema de reservas subyacente.
   */
  /**
   * Indica información esencial sobre el segmento de reserva, común para todos los tipos posibles de segmentos de reserva.
   */
  allSegments?: SegmentBasics[]
  /**
   * Enumera todos los billetes de avión electrónicos emitidos para los viajeros.
   */
  /**
   * Contiene información del billete de avión electrónico para el viajero.
   */
  flightTickets?: FlightTicket[]
  /**
   * Contiene todos los montos totales de pago en vuelos, hoteles, automóviles y otros.
   */
  payments?: TotalPayments
  /**
   * Enumera otra información de servicio (OSI) hacia/desde un proveedor específico.
   */
  otherServices?: OtherServiceInformation[]
  /**
   * Contiene un acuerdo detallado de entradas para una fecha futura.
   */
  futureTicketingPolicy?: FutureTicketingPolicy
  /**
   * Enumera todos los servicios especiales asociados con un viajero.
   */
  specialServices?: SpecialService[]
  /**
   * Lists accounting items from the booking.
   * 
   * description: Contains accounting data correlated with a fulfilled document. Supported for ATPCO content only.
   */
  accountingItems?: AccountingItem[]
}