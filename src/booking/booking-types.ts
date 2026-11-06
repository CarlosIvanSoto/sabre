// Tipos de `Booking` (Get Booking, Create Booking), generados una vez desde la spec Swagger 2.0 de
// la Booking Management API v1.33 (sabre-wiki/raw/sources/booking-management-api-openapi-v1.md,
// #158). Los nombres del spec llevan el prefijo `Booking`. Las enumeraciones quedan abiertas
// (`| (string & {})`): Sabre puede mandar valores nuevos. No se validan en runtime (ADR-014).
//
// Notas a mano, de la documentación de Q-091 (wiki/entities/booking-management-api.md): ver
// `BookingFlight` y `BookingFare`.

/** Contains booking information. */
export interface Booking {
  /**
   * The booking reference ID as shown in the source supplier/vendor system. For `SABRE`, this is
   * the PNR Locator or NDC `orderId` value, depending on content type. Ej.: `1SXXX1A2B3C4D`.
   */
  bookingId?: string;
  /**
   * The start date of the booking in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.: `2024-07-09`.
   */
  startDate?: string;
  /**
   * The end date of the booking in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.: `2024-07-19`.
   */
  endDate?: string;
  /**
   * If `true`, the booking is cancelable in full or in segments. Refer to the `refundPenalties`
   * array for more information.
   */
  isCancelable?: boolean;
  /** If true, at least one ticket was issued for the booking. */
  isTicketed?: boolean;
  /**
   * The customer identifier used by their travel agency, also known as the customer number or the
   * DK number. Can be a six, seven, or 10-character string. Ej.: `1234567`.
   */
  agencyCustomerNumber?: string;
  /**
   * Contains details about the creation. El plazo de compra (`TAW`) suele venir en
   * `fares[].creationDetails`, no aquí (CERT, 2026-11-05).
   */
  creationDetails?: BookingCreationDetails;
  /** Contains contact information for the booking. */
  contactInfo?: BookingContactInformation;
  /** Lists the traveler(s) associated with the booking. */
  travelers?: BookingTraveler[];
  /** Contains information about the group the travelers belong to. */
  travelersGroup?: BookingTravelersGroup;
  /** Lists all flights associated with the booking in chronological order. */
  flights?: BookingFlight[];
  /**
   * Lists all the journeys associated with the booking. * For one-way, this is a single element
   * list. * For round-trip, the list contains two journeys. * For multi-destinations, the list
   * contains more than two journeys.
   */
  journeys?: BookingJourney[];
  /**
   * Lists most restrictive fare rule information displayed at the time of purchase. This service
   * applies data from either Tickets or Price Quotes.
   */
  fareRules?: BookingFareRule[];
  /** Lists ancillary offers for selected flights identified by `itemId` flight references. */
  fareOffers?: BookingFareOffer[];
  /**
   * Lists the details for saved fares. This service applies data either from a Price Quote or an
   * Order Item.
   */
  fares?: BookingFare[];
  /** Contains list of remarks added to the PNR. */
  remarks?: BookingRemark[];
  /** Lists all hotel reservations associated with the booking. */
  hotels?: BookingHotel[];
  /** Lists all car rentals associated with the booking. */
  cars?: BookingCar[];
  /** Lists all trains associated with the booking. */
  trains?: BookingTrain[];
  /** Lists all cruises associated with the booking. */
  cruises?: BookingCruise[];
  /**
   * Lists all segments of the booking which overlaps with contextual booking elements such as
   * flights, hotels, cars, trains and so on. This list also contains non-product related segments
   * which exist in an underlying booking system.
   */
  allSegments?: BookingSegmentBasics[];
  /** Lists all electronic flight tickets issued for the travelers. */
  flightTickets?: BookingFlightTicket[];
  /** Contains all total payment amounts across flights, hotels, cars and others. */
  payments?: BookingTotalPayments;
  /** Lists Other Service Information (OSI) sent to or retrieved from a specific vendor. */
  otherServices?: BookingOtherServiceInformation[];
  /** Contains a detailed ticket arrangement for a future date. */
  futureTicketingPolicy?: BookingFutureTicketingPolicy;
  /** Lists all special services associated with a traveler. */
  specialServices?: BookingSpecialService[];
  /**
   * The retention date of the booking. Used optionally to keep the booking active past the date of
   * the last itinerary item (flight, hotel, car, etc.). After this date, the booking is set for
   * purging. Ej.: `2024-01-30`.
   */
  retentionEndDate?: string;
  /** The label associated with the retention date. Ej.: `RETENTION DATE`. */
  retentionLabel?: string;
  /** Lists accounting items from the booking. */
  accountingItems?: BookingAccountingItem[];
  /** Lists nonelectronic tickets from the booking. */
  nonElectronicTickets?: BookingNonElectronicTicket[];
  /** Lists details of the travelers' employers. */
  travelersEmployers?: BookingTravelersEmployer[];
  /** Lists profiles used in the booking. */
  profiles?: BookingProfile[];
  /** Campos que Sabre agregue después de la v1.33. */
  [field: string]: unknown;
}

/** Contains details about the creation. */
export interface BookingCreationDetails {
  /**
   * The sine of the Employee Profile Record that created the booking. Not supported for NDC
   * bookings. Ej.: `A12`.
   */
  creationUserSine?: string;
  /** The date in `YYYY-MM-DD` format when the booking was created. Ej.: `2024-01-09`. */
  creationDate?: string;
  /**
   * The time in `HH:MM` format when the booking was created. Not supported for NDC bookings. Ej.:
   * `15:00`.
   */
  creationTime?: string;
  /**
   * The date in the `YYYY-MM-DD` format by which the price is guaranteed by the airline. Applies
   * to NDC content only. Ej.: `2024-01-09`.
   */
  purchaseDeadlineDate?: string;
  /**
   * The time in the `HH:MM` format by which the price is guaranteed by the airline. Applies to NDC
   * content only. Ej.: `15:00`.
   */
  purchaseDeadlineTime?: string;
  /**
   * A unique identifier accredited by the International Air Transport Association (IATA). Ej.:
   * `99119911`.
   */
  agencyIataNumber?: string;
  /** The pseudo city code where the booking was created. Ej.: `AB12`. */
  userWorkPcc?: string;
  /** The pseudo city code of the agent who created the booking. Ej.: `CD34`. */
  userHomePcc?: string;
  /**
   * The identification code for the prime host (global distribution system) associated with the
   * reservation. Ej.: `1S`.
   */
  primeHostId?: string;
  /** The date in `YYYY-MM-DD` format when the booking was last updated. Ej.: `2026-01-09`. */
  lastUpdateDate?: string;
  /**
   * The time in `HH:MM` format when the booking was last updated. Not supported for NDC bookings.
   * Ej.: `15:00`.
   */
  lastUpdateTime?: string;
  /** The number of all booking updates committed. Ej.: `4`. */
  numberOfUpdates?: number;
}

/** Contains contact information for the booking. */
export interface BookingContactInformation {
  /** Lists email addresses of travelers or vendors. */
  emails?: string[];
  /** Lists formatted phone numbers of travelers or vendors. */
  phones?: string[];
  /** Lists formatted fax numbers of travelers or vendors. */
  faxes?: string[];
  /** Lists formatted phone numbers to use as vendor emergency contacts. */
  emergencyPhones?: string[];
}

/** Contains traveler information. */
export interface BookingTraveler {
  /** The traveler's first name. Ej.: `John`. */
  givenName: string;
  /**
   * The middle name or the initial of the middle name of the traveler. Currently not supported in
   * the Create Booking endpoint. Ej.: `W`.
   */
  middleName?: string;
  /** The traveler's last name. Ej.: `Smith`. */
  surname: string;
  /** The date of birth of the traveler in `YYYY-MM-DD` format. Ej.: `2024-01-23`. */
  birthDate?: string;
  /** Identifies the gender of the traveler. Applies to NDC content only. */
  gender?: BookingGenderEnum;
  /** Identifies the type of the traveler. */
  type?: BookingTravelerTypeEnum;
  /**
   * The ATPCO code of the passenger type used for pricing, ticketing or fare rules of booked
   * flights. Ej.: `ADT`.
   */
  passengerCode?: string;
  /**
   * The ID associated with the traveler. Used for reference purposes after a booking PNR divide
   * operation or traveler name change have been performed. Ej.: `3`.
   */
  nameAssociationId?: string;
  /**
   * An additional code associated with the traveler (the so-called MAN number or statement
   * information) used for accounting or identification purposes. Ej.: `C05`.
   */
  nameReferenceCode?: string;
  /** If `true`, the traveler is associated with a group booking. */
  isGrouped?: boolean;
  /** Lists all email addresses of the traveler. */
  emails?: string[];
  /** Lists all phone numbers associated with the traveler. */
  phones?: BookingPhoneResponse[];
  /** Lists all remarks associated with the traveler. */
  remarks?: BookingRemark[];
  /** The address of the traveler. */
  address?: BookingGenericAddress;
  /** Lists the identity documents applicable for a traveler. */
  identityDocuments?: BookingIdentityDocument[];
  /** Lists the loyalty programs applicable for a traveler. */
  loyaltyPrograms?: BookingLoyaltyProgram[];
  /** Lists the details of ancillary services. */
  ancillaries?: BookingAncillary[];
  /** Lists the indices of forms of payment associated with the traveler. */
  formOfPaymentIndices?: number[];
  /**
   * The ID of an item from the `travelersEmployers` array. Indicates the employer associated with
   * the traveler. Ej.: `1`.
   */
  employerIndex?: number;
}

/** Contains information about the group the travelers belong to. */
export interface BookingTravelersGroup {
  /** Contains the ID of the group. Ej.: `3`. */
  itemId?: string;
  /** The name of the group. Ej.: `GROUP ONE`. */
  name?: string;
  /**
   * The total number of travelers within the group. Lap infants are not taken into consideration.
   * Ej.: `1`.
   */
  numberOfTravelers?: number;
  /**
   * The number of remaining travelers within the group whose names are not provided. Lap infants
   * are not taken into consideration. Ej.: `1`.
   */
  numberOfTravelersRemaining?: number;
}

/** Contains flight information, identified by `itemId`, for the given booking. */
export type BookingFlight = BookingFlightReference & BookingFlightItem;

/** Contains details of the flights within the journey. */
export interface BookingJourney {
  /** The three-letter IATA airport code of the first flight in the journey. Ej.: `DFW`. */
  firstAirportCode: string;
  /**
   * The scheduled departure date in `YYYY-MM-DD` format in the airport's time zone. Ej.:
   * `2024-07-09`.
   */
  departureDate: string;
  /** The scheduled time of departure in `HH:MM` format. Ej.: `09:15`. */
  departureTime: string;
  /** The three-letter IATA airport code of the last flight in the journey. Ej.: `HNL`. */
  lastAirportCode: string;
  /** The total number of flights in the journey. Ej.: `1`. */
  numberOfFlights: number;
}

/** Contains eligibility requirements and travel restrictions for a flight. */
export interface BookingFareRule {
  /** The three-letter IATA airport code of the origin airport. Ej.: `DFW`. */
  originAirportCode?: string;
  /** The three-letter IATA airport code of the destination airport. Ej.: `ATL`. */
  destinationAirportCode?: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the airline that owns the fare rule. Ej.: `AA`.
   */
  owningAirlineCode: string;
  /**
   * The ATPCO code of the passenger type. Applicable travelers are identified by the passenger
   * type code. Ej.: `ADT`.
   */
  passengerCode?: string;
  /**
   * If `true`, the fare can be refunded in total or in segments. Refer to the `refundPenalties`
   * array for more information.
   */
  isRefundable?: boolean;
  /**
   * Lists estimated penalty details associated with a refund. Estimates assume the highest
   * possible refund penalty is applied.
   */
  refundPenalties?: BookingFareRulePenalty[];
  /**
   * If `true`, the fare can be exchanged with or without additional cost. Refer to the
   * `exchangePenalties` array for more information.
   */
  isChangeable?: boolean;
  /**
   * Lists estimated penalty details associated with a fare exchange. Estimates assume that all
   * fare components are changed and the highest applicable penalty is applied.
   */
  exchangePenalties?: BookingFareRulePenalty[];
  /**
   * If `true`, the order can be cancelled with or without additional cost. Refer to the
   * `cancelPenalties` array for more information.
   */
  isCancelable?: boolean;
  /** Lists conditions and payments associated with order cancellation. */
  cancelPenalties?: BookingFareRulePenalty[];
}

/**
 * Contains ancillary offer for selected flights identified by `itemId` flight references and for
 * selected travelers identified by indices in `travelers` list.
 */
export interface BookingFareOffer {
  /**
   * Indicates to which travelers from the `travelers` list the ancillary offer belongs to. If the
   * offer is valid for all travelers, this list is not provided.
   */
  travelerIndices?: number[];
  /**
   * Lists flights referenced by flight `itemId`. If the offer is valid for all flights, this list
   * is not provided.
   */
  flights?: BookingFlightReference[];
  /** Indicates allowed cabin baggage (carry-on) included in the ticket price. */
  cabinBaggageAllowance?: BookingBaggageAllowance;
  /** Indicates allowed checked baggage included in the ticket price. */
  checkedBaggageAllowance?: BookingBaggageAllowance;
  /** Lists cabin baggage (carry-on) policies and service fees. */
  cabinBaggageCharges?: BookingBaggagePolicy[];
  /** Lists checked baggage policies and service fees. */
  checkedBaggageCharges?: BookingBaggagePolicy[];
}

/** Contains construction details of a specific fare. */
export interface BookingFare {
  /**
   * Contains details about the fare creation. Aquí llega el plazo de compra (`TAW`):
   * `purchaseDeadlineDate/Time`. En CERT llegó solo aquí y no en `Booking.creationDetails`, aunque
   * el spec lo define en los dos (2026-11-05).
   */
  creationDetails?: BookingFareCreationDetails;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the airline that validated the fare. Ej.: `AA`.
   */
  airlineCode?: string;
  /**
   * Coded fare construction information. Ej.: `BUE AA DFW Q430.00 5740.00NUC6170.00END ROE1.00
   * XT175.50TQ175.50QO315.90US96.50YC122.90XY69.50XA`.
   */
  fareCalculationLine?: string;
  /** The tour code applied to price the fare. Ej.: `123456789ABCDE`. */
  tourCode?: string;
  /**
   * If `true`, the fare used for pricing is negotiated. If `false`, the fare used for pricing is
   * public.
   */
  isNegotiatedFare?: boolean;
  /**
   * Indicates to which travelers from the `travelers` list the fare belongs to. If the fare is
   * applicable for all travelers, this list is not provided.
   */
  travelerIndices?: number[];
  /** Contains commission details applicable to the fare. */
  commission?: BookingCommission;
  /** Lists the components used to construct the fare. */
  fareConstruction?: BookingFareComponent[];
  /** Lists the taxes applied to the fare. */
  taxBreakdown?: BookingTaxComponent[];
  /** Contains payment information for the service. */
  totals?: BookingTotalValues;
  /** Lists services and fees that are bundled with the selected fare. */
  bundledServicesAndFees?: BookingFareService[];
  /** Contains base fare amount in an original currency. */
  originalTotalValues?: BookingOriginalTotalValues;
  /**
   * The one-letter type code used by the Sabre system that indicates how the fare was priced. Not
   * applicable for NDC.
   */
  pricingTypeCode?: BookingPricingTypeCodeEnum;
  /** The meaningful value describing how the fare was priced. */
  pricingTypeName?: BookingPricingTypeNameEnum;
  /**
   * The one-letter type code used by the Sabre system that indicates the status of the fare. Not
   * applicable for NDC.
   */
  pricingStatusCode?: BookingPricingStatusCodeEnum;
  /** The meaningful value describing the status of a fare. */
  pricingStatusName?: BookingPricingStatusNameEnum;
  /**
   * If `true`, the fare pricing is valid for the agency. If `false`, the agency's local date
   * exceeds the purchase date. **`false` quiere decir que el plazo de compra (`TAW`) ya pasó**, no
   * que el precio sea inválido: sale de `PriceQuote/Indicators/@isExpired` (Q-091). El `TAW` viene
   * en `creationDetails.purchaseDeadlineDate/Time` de esta tarifa.
   */
  hasValidPricing?: boolean;
  /**
   * Contains details of the initially offered fare. To obtain this data, the Employee Profile
   * Record (EPR) needs to include the ORGFQD keyword.
   */
  initialSellingFare?: BookingInitialSellingFare;
  /** The type code of the traveler requested when pricing the fare. Ej.: `C08`. */
  requestedTravelerType?: string;
  /**
   * The type code of the traveler returned in the pricing response and stored in the price quote.
   * Ej.: `C08`.
   */
  pricedTravelerType?: string;
  /** The code describing the source of the fare. Ej.: `PQ`. */
  recordTypeCode?: string;
  /** The name describing the source of the fare. Ej.: `Price Quote`. */
  recordTypeName?: string;
  /** The ID of the fare source. Ej.: `12`. */
  recordId?: string;
}

/** Contains remark details stored within the booking. */
export interface BookingRemark {
  /** Identifies the type of remark. */
  type?: BookingRemarkTypeEnum;
  /** The character coding used for the `ALPHA_CODED` remark type. Ej.: `T`. */
  alphaCode?: string;
  /** The original text of the remark. Ej.: `XXATW/`. */
  text?: string;
}

/** Contains hotel reservation information identified by `itemId` and associated with a booking. */
export type BookingHotel = BookingHotelReference & BookingHotelItem;

/** Contains car rental information, identified by `itemId`, for the given booking. */
export type BookingCar = BookingCarReference & BookingCarItem;

/** Contains train reservation information, identified by `itemId`, for the given booking. */
export type BookingTrain = BookingTrainReference & BookingTrainItem;

/** Contains cruise reservation information, identified by `itemId`, for the given booking. */
export type BookingCruise = BookingCruiseReference & BookingCruiseItem;

/** Contains essential information which is common for all possible types of booking segments. */
export type BookingSegmentBasics = BookingSegmentReference & BookingSegmentBasicAttributes;

/** Contains information about an electronic flight ticket or EMD issued for a traveler. */
export interface BookingFlightTicket {
  /** The electronic flight ticket number. Ej.: `0167489825830`. */
  number: string;
  /** The date the electronic flight ticket was issued in `YYYY-MM-DD` format. Ej.: `2024-07-01`. */
  date: string;
  /** The unique identifier of an IATA-accredited agency that issued the ticket. Ej.: `12344321`. */
  agencyIataNumber?: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the issuing airline. Ej.: `AA`.
   */
  airlineCode: string;
  /**
   * Specifies the traveler from the `travelers` array whose name is associated with the ticket.
   * Ej.: `1`.
   */
  travelerIndex: number;
  /** Lists all coupons of booked and ticketed flights referenced by the flight `itemId`. */
  flightCoupons: BookingFlightReferenceCoupon[];
  /**
   * Lists all coupons of booked and ticketed flights. The corresponding flight `itemId` is
   * provided if available. If a coupon cannot be associated with any flight present in the booking
   * (e.g. due to schedule change), the `itemId` is hidden, however the coupon status details are
   * still returned.
   */
  allCoupons?: BookingTicketCoupon[];
  /** Contains payment amounts for ticketed flights. */
  payment: BookingTotalValues;
  /**
   * If `true`, the ticket is part of a larger travel package (e.g., Inclusive Tour) or group
   * booking (e.g., Bulk Ticket), often offered at a discounted rate. Therefore, ticket payment
   * details obtained from the airline database may contain "0.0".
   */
  isBundledTicket?: boolean;
  /** Identifies the current status of the ticket, e.g. `Issued`. */
  ticketStatusName?: BookingTicketStatusEnum;
  /** The code of the ticket status. Ej.: `TE`. */
  ticketStatusCode?: string;
  /** The pseudo city code of the agency which issued the ticket or EMD. Ej.: `G7HE`. */
  ticketingPcc?: string;
  /** Contains commission applied during ticketing. */
  commission?: BookingCommission;
}

/** Contains all total payment amounts across flights, hotels, car reservations and others. */
export interface BookingTotalPayments {
  /**
   * Lists all flight payments, per each currency used. For ticketed bookings it sums all payments
   * irrespective of the document status. For non-ticketed bookings it sums payments from all price
   * quotes stored in the booking.
   */
  flightTotals?: BookingTotalValues[];
  /**
   * Lists all flight payments, per each currency used, and is applicable only for ticketed
   * bookings. It sums up all payments with the exclusion of Refunded/Voided tickets, obtained
   * directly from the ticket data.
   */
  flightCurrentTotals?: BookingTotalValues[];
  /** Lists all hotel payments, per each currency used. */
  hotelTotals?: BookingTotalValues[];
  /** Lists all car rental payments, per each currency used. */
  carTotals?: BookingTotalValues[];
  /** Lists all train payments, per each currency used. */
  trainTotals?: BookingTotalValues[];
  /** Lists all the payment methods that are stored in the booking. */
  formsOfPayment?: BookingFormOfPaymentResponse[];
  /**
   * Lists all ancillary payments made in a single currency. For fulfilled ancillaries, it sums all
   * payments for items marked with the appropriate ancillary status code. For non-fulfilled
   * ancillaries, it sums pending payments for all ancillary items stored in the booking.
   */
  ancillaryTotals?: BookingGenericTotalValues[];
}

/** Contains Other Service Information (OSI) sent to or retrieved from a specific vendor. */
export type BookingOtherServiceInformation = BookingCommonOtherServiceInformation & {
  /** The two-character code of the hotel chain. Ej.: `BY`. */
  chainCode?: string;
  /** The two-letter code of the car rental vendor. Ej.: `ZE`. */
  vendorCode?: string;
};

/** Contains a detailed ticket arrangement for a future date. */
export interface BookingFutureTicketingPolicy {
  /** Used to specify a pseudocity code. Ej.: `G7RE`. */
  ticketingPcc?: string;
  /** Used to specify a queue number. Ej.: `55`. */
  queueNumber?: string;
  /** The ticketing date. Ej.: `2024-07-09`. */
  ticketingDate?: string;
  /** The ticketing time in `HH:MM` format. Ej.: `11:00`. */
  ticketingTime?: string;
  /** Free text comment. Ej.: `TICKET BEFORE TUES`. */
  comment?: string;
}

/** Contains special service information (SSR) for a specific traveler. */
export interface BookingSpecialService {
  /**
   * Lists the travelers within the travelers list the special service belongs to. This list is not
   * provided for special services without explicit traveler assignation.
   */
  travelerIndices?: number[];
  /**
   * Lists flights referenced by flight `itemId`. Multiple flight IDs can be returned for a single
   * special service.
   */
  flights?: BookingFlightReference[];
  /**
   * Defines the category of the special service request sent to the airline. Visit the official
   * IATA website for the list of currently supported SSR code references. Some airline-specific
   * codes may be missing within these IATA resources. Ej.: `WCHR`.
   */
  code?: string;
  /**
   * The name of the special service request. This property is not returned when the name is
   * unknown. Ej.: `Wheelchair/Passenger can walk up stairs`.
   */
  name?: string;
  /**
   * Miscellaneous free text information used in teletype messages sent to or from the airline. May
   * contain additional special service details which are mandatory to distinguish product
   * characteristics on the airline's side. Ej.: `/PREPAID`.
   */
  message?: string;
  /**
   * The two-letter status code used by vendors. It indicates the special service status. Ej.:
   * `HK`.
   */
  statusCode?: string;
  /** The meaningful value describing special service status. */
  statusName?: BookingStatusNameEnum;
}

/** Contains accounting data correlated with a fulfilled document. Supported for ATPCO content only. */
export interface BookingAccountingItem {
  /**
   * Identifies the association type of the accounting item, which indicates to whom the fare is
   * applied.
   */
  fareApplicationType?: BookingFareApplicationTypeEnum;
  /** Identifies the payment method of the accounting item. */
  formOfPaymentType?: BookingAccountingFormOfPaymentTypeEnum;
  /** Identifies the ticket operation which triggered automatic accounting item creation. */
  creationType?: BookingAccountingItemCreationTypeEnum;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the marketing airline. Ej.: `AA`.
   */
  airlineCode?: string;
  /** The number of the electronic document. Ej.: `2200011234567`. */
  ticketNumber?: string;
  /** Contains commission details applicable to the fare. */
  commission?: BookingCommission;
  /** The monetary amount of the fare paid for the ticket. Ej.: `520.00`. */
  fareAmount?: string;
  /** The monetary amount of the tax applied to the fare. Ej.: `123.00`. */
  taxAmount?: string;
  /**
   * Lists the indices of travelers in the `travelers` array to whom the particular accounting item
   * is assigned. Returned only if `fareApplication` is set to `Single Traveler`.
   */
  travelerIndices?: number[];
  /** Indicates the type of tariff basis. */
  tariffBasisType?: BookingTariffBasisTypeEnum;
  /** The number of a credit or debit card. Ej.: `4537156488578956`. */
  cardNumber?: string;
  /** The vendor code of a credit or debit card. Ej.: `VI`. */
  cardTypeCode?: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
  /** Contains details of Goods and Services Tax (GST). */
  goodsAndServicesTax?: BookingGoodsAndServicesTax;
  /**
   * Contains order invoice number. Supported for NDC only. This field is deprecated and will be
   * removed in future versions. Use invoiceNumbers instead. Ej.: `0266839`.
   */
  invoiceNumber?: string;
  /** Lists order invoice numbers. Supported for NDC only. */
  invoiceNumbers?: string[];
  /**
   * The original text of the ATPCO accounting line. Ej.: `LH$5519872356/ 0.00/ 3059.00/
   * 624.63/ONE/CA 1.1DOE JOHN/1/F/E/`.
   */
  text?: string;
  /**
   * The manual approval code of a credit or debit card. Created during fulfillment step. Ej.:
   * `265599`.
   */
  approvalCode?: string;
}

/** Contains a nonelectronic ticket. Supported for ATPCO content only. */
export interface BookingNonElectronicTicket {
  /** Identifies the status of a nonelectronic ticket. */
  ticketStatus?: BookingNonElectronicTicketStatusEnum;
  /** The number of the nonelectronic ticket. Ej.: `0011234567899`. */
  ticketNumber?: string;
  /** The index of the traveler to whom the ticket is assigned. Ej.: `1`. */
  travelerIndex?: number;
  /** The code of the user that issued the ticket. Not supported for NDC bookings. Ej.: `A12`. */
  ticketingUserCode?: string;
  /** The pseudo city code of the agency which issued the ticket. Ej.: `G7HE`. */
  ticketingPcc?: string;
  /**
   * The date the nonelectronic ticket was issued, provided in `YYYY-MM-DD` format in the issuing
   * agency's time zone. Ej.: `2024-07-01`.
   */
  date?: string;
  /**
   * The time the nonelectronic ticket was issued, provided in `HH:MM` format in the issuing
   * agency's time zone. Ej.: `09:15`.
   */
  time?: string;
}

/** Contains details of the traveler's employer. */
export interface BookingTravelersEmployer {
  /** Identifies the type of employer ID. */
  idType?: BookingEmployerIdTypeEnum;
  /** The unique identifier of the employer. Ej.: `22AAAAA0000A1Z5`. */
  employerId?: string;
  /** The name of the employer. Ej.: `Sabre`. */
  employerName?: string;
  /** Lists all phone numbers associated with the employer. */
  phones?: BookingPhone[];
  /** Lists all email addresses of the employer. */
  emails?: string[];
  /**
   * The street name and house number accompanied with the number of apartment, unit, or suite, if
   * applicable. Ej.: `1230 Ellen Ave, apt 10`.
   */
  street?: string;
  /** The name of the city. Ej.: `Dallas`. */
  city?: string;
  /** The name or code of the state or province. Ej.: `TX`. */
  stateProvince?: string;
  /** The zip or postal code. Ej.: `75063`. */
  postalCode?: string;
  /** The two- or three-letter ISO 3166-1 country code. Ej.: `US`. */
  countryCode?: string;
}

/** Contains parameters needed to retrieve profile information. */
export interface BookingProfile {
  /** A unique profile type code. Ej.: `TVL`. */
  profileTypeCode?: string;
  /** The unique profile ID number. Ej.: `720320171`. */
  uniqueId?: string;
  /** The traveler index that is associated with the TVL profile. Ej.: `1`. */
  travelerIndex?: number;
}

/** Identifies the gender of the traveler. */
export type BookingGenderEnum = 'FEMALE' | 'MALE' | 'INFANT_FEMALE' | 'INFANT_MALE' | 'UNDISCLOSED' | 'UNDEFINED' | (string & {});

/** Identifies the type of the traveler. */
export type BookingTravelerTypeEnum = 'ADULT' | 'AGENT' | 'AIRLINE' | 'CHILD' | 'EDUCATION' | 'GOVERNMENT' | 'GROUP' | 'INFANT' | 'MILITARY' | 'SENIOR' | 'SPECIAL' | 'YOUTH' | (string & {});

/** Contains phone details. */
export interface BookingPhoneResponse {
  /** The formatted phone number of the traveler. Ej.: `+1-555-123-4567`. */
  number: string;
  /**
   * The type of the phone number. Available phone type codes are `H` - home, `B` - business, `C` -
   * cell and `M` - mobile. Ej.: `M`.
   */
  label?: string;
}

/** Contains address information. */
export type BookingGenericAddress = BookingAddress & {
  /** The name of the person or the company/organization. Ej.: `John Smith`. */
  name?: string;
  /**
   * The full address provided as free text. Use this alternative address representation when a
   * structured address is not available. Ej.: `John Smith 1230 Ellen Ave, Apt 10 Dallas, TX 75063
   * US `.
   */
  freeText?: string;
};

/** Contains details of an identity document. */
export interface BookingIdentityDocument {
  /** The unique identifier of the document. Ej.: `0123456789`. */
  documentNumber?: string;
  /** Identifies the type of passenger document. */
  documentType: BookingDocumentTypeEnum;
  /** Identifies the subtype of passenger document (for DocumentType FISCAL_ID). */
  documentSubType?: BookingDocumentSubTypeEnum;
  /**
   * Identifies the type of the passenger’s passport document. Applies to identity documents with
   * the `documentType` parameter set to `PASSPORT`. If the passport document type cannot be
   * determined, it is displayed as `Unknown`.
   */
  passportType?: BookingPassportTypeResponseEnum;
  /**
   * Identifies the type of the passenger’s visa document. Applies to identity documents with the
   * `documentType` parameter set to `VISA`. If the visa document type cannot be determined, it is
   * displayed as `Unknown`.
   */
  visaType?: BookingVisaTypeResponseEnum;
  /** The expiration date of the identity document in the `YYYY-MM-DD` format. Ej.: `2024-07-09`. */
  expiryDate?: string;
  /**
   * The country issuing the passenger document provided as a two- or three-letter ISO 3166 code.
   * Ej.: `US`.
   */
  issuingCountryCode?: string;
  /**
   * The country the passenger resides in or their nationality country provided as a two- or
   * three-letter ISO 3166 code. Ej.: `US`.
   */
  residenceCountryCode?: string;
  /** The name of the place where the document was issued. Ej.: `ROME`. */
  placeOfIssue?: string;
  /**
   * The passenger's place of birth, fully spelled out. This is mainly used for the `VISA` document
   * type. Ej.: `KOSZALIN`.
   */
  placeOfBirth?: string;
  /**
   * The two- or three-letter ISO 3166 country code where the document is valid. This is mainly
   * used for the `VISA` document type. Ej.: `US`.
   */
  hostCountryCode?: string;
  /**
   * The date the identity document was issued in `YYYY-MM-DD` format. This is mainly used for the
   * `visa` document type. Ej.: `2024-07-09`.
   */
  issueDate?: string;
  /** The traveler's first name. Ej.: `John`. */
  givenName?: string;
  /** The traveler's middle name. (NDC not supported). Ej.: `Jack`. */
  middleName?: string;
  /** The traveler's last name. Ej.: `Smith`. */
  surname?: string;
  /** The traveler's date of birth in the `YYYY-MM-DD` format. Ej.: `2024-12-02`. */
  birthDate?: string;
  /** Identifies the gender of the traveler. */
  gender?: BookingGenderEnum;
  /** If `true`, indicates the primary passport holder of a document issued for multiple travelers. */
  isPrimaryDocumentHolder?: boolean;
  /** If `true`, the identity document applies to a lap child. */
  isLapChildDocument?: boolean;
  /** Residence or destination address of the traveler. */
  residenceDestinationAddress?: BookingAddress;
  /**
   * Lists the indices of flights within a booking. This property will be deprecated in the future
   * major version of this API. If you wish to list documents associated with the flight, use the
   * `identityDocuments` property within the `Flight` object.
   */
  flightIndices?: number[];
  /**
   * The unique identifier of the document. Ej.:
   * `76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f`.
   */
  itemId?: string;
  /**
   * The traveler's citizenship country provided as a two- or three-letter ISO 3166 code. Ej.:
   * `US`.
   */
  citizenshipCountryCode?: string;
}

/** Contains details of the passenger's loyalty program, such as a frequent flyer card. */
export interface BookingLoyaltyProgram {
  /** The two-letter code that issued the number such as the IATA airline code. Ej.: `AA`. */
  supplierCode?: string;
  /** Contains loyalty program type codes. */
  programType?: BookingProgramTypeEnum;
  /**
   * The traveler membership number for loyalty program such as the frequent flyer number. Ej.:
   * `987654321`.
   */
  programNumber: string;
  /** The level reached by the traveler in the loyalty program. Ej.: `3`. */
  tierLevel?: number;
  /** The two-letter receiver code, such as IATA airline code. Ej.: `UA`. */
  receiverCode?: string;
}

/** Contains the details for an ancillary. */
export interface BookingAncillary {
  /** The ID of an ancillary item. Ej.: `12`. */
  itemId?: string;
  /** The commercial name of the ancillary. Ej.: `UPTO33LB 15KG BAGGAGE`. */
  commercialName?: string;
  /** Quantity of ancillary items. Ej.: `1`. */
  numberOfItems?: number;
  /** The IATA-defined reason for issuance code (RFIC). Ej.: `C`. */
  reasonForIssuanceCode?: string;
  /**
   * Specifies the IATA-defined reason for the issuance code (RFIC) applicable to the Electronic
   * Miscellaneous Document (EMD) that will be issued for the subcode identified in this record.
   * The UNKNOWN option is used for the read-only purpose by getBooking API.
   */
  reasonForIssuanceName?: BookingReasonForIssuanceEnum;
  /**
   * The issuance subcode (`RFISC`) is an industry-defined or airline-defined code identifying a
   * specific type of service. Industry-defined subcodes are available for all airlines to use,
   * have standard definitions, and are maintained by
   * [ATPCO](https://www.atpco.net/sites/atpco-public/files/all_pdfs/Opt_Scvs_Industry_Sub_Codes_Online_C.pdf).
   * Airline-defined subcodes are available for specific airlines only, and are defined and
   * maintained by the airline utilizing the code. Ej.: `05Z`.
   */
  subcode?: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the airline that owns the service. Ej.: `EY`.
   */
  airlineCode?: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the airline providing the service. Mutually exclusive with the `source`
   * property. Ej.: `EY`.
   */
  vendorCode?: string;
  /**
   * The application source providing ancillary service. Mutually exclusive with the `vendorCode`
   * property.
   */
  source?: BookingAncillarySourceEnum;
  /** The electronic document number. Ej.: `6074333222111`. */
  electronicMiscellaneousDocumentNumber?: string;
  /** If true, the ancilliary is refundable. */
  isRefundable?: boolean;
  /** If true, the ancilliary has a Commission included. */
  isCommissionable?: boolean;
  /**
   * Identifies the applicability of the ancillary item to the flights in the booking. Can be
   * `Single` (an ancillary item applies to a single flight/sector of the booking), `Multiple` (an
   * ancillary item applies to the portion of flights in the booking), or `Unknown` (applicability
   * of the ancillary cannot be determined). This information is required when
   * `electronicMiscellaneousDocumentType` has the value `OTHER_THAN_EMD`.
   */
  flightApplicabilityType?: BookingFlightApplicabilityTypeEnum;
  /**
   * Lists flights referenced by flight `itemId`. Multiple flight IDs can be returned for a single
   * ancillary item.
   */
  flights?: BookingFlightReference[];
  /** The two-letter status code used by vendors. It indicates the booking status. Ej.: `HD`. */
  statusCode?: string;
  /** The meaningful value describing the booking status. */
  statusName?: BookingAncillaryStatusNameEnum;
  /** Contains payment information for the service. */
  totals?: BookingTotalValues;
  /** Lists tax information associated with the ancillary. */
  taxes?: BookingTax[];
  /**
   * The category of the special service associated with the selected ancillary service. Ej.:
   * `ABAG`.
   */
  specialServiceCode?: string;
}

/** Contains flight object reference by `itemId`. */
export interface BookingFlightReference {
  /** The ID of a flight. Ej.: `12`. */
  itemId: string;
}

/** Contains flight information for the given booking. */
export interface BookingFlightItem {
  /**
   * The booking reference ID in the carrier's system. For example, this value would reflect the
   * PNR Locator for American Airlines. Ej.: `NIEBNY`.
   */
  confirmationId?: string;
  /** Identifies applicable type of the source of booking flight. */
  sourceType?: BookingFlightSourceEnum;
  /** The flight number associated with the marketing carrier. Ej.: `123`. */
  flightNumber: number;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the marketing airline. Ej.: `AA`.
   */
  airlineCode: string;
  /** The name of the marketing airline. Ej.: `AMERICAN AIRLINES`. */
  airlineName?: string;
  /** The flight number associated with the operating carrier. Ej.: `321`. */
  operatingFlightNumber?: number;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the operating airline. Ej.: `UA`.
   */
  operatingAirlineCode?: string;
  /** The name of the operating airline. Ej.: `UNITED AIRLINES`. */
  operatingAirlineName?: string;
  /** The three-letter IATA airport code of the origin airport. Ej.: `DFW`. */
  fromAirportCode: string;
  /** The three-letter IATA airport code of the destination airport. Ej.: `HNL`. */
  toAirportCode: string;
  /**
   * The scheduled departure date in `YYYY-MM-DD` format in the airport's time zone. Ej.:
   * `2024-07-09`.
   */
  departureDate: string;
  /** The scheduled time of departure in `HH:MM` format. Ej.: `09:15`. */
  departureTime: string;
  /**
   * The estimated (before departure) or actual departure date in `YYYY-MM-DD` format in the
   * airport's time zone. Ej.: `2024-07-09`. **Es una demora operativa, no un cambio de horario del
   * itinerario** (Q-091). El cambio de horario se ve en `flightStatusCode` (`UN`, `TK`, `SC`,
   * `WK`).
   */
  updatedDepartureDate?: string;
  /**
   * The estimated (before departure) or actual departure time in `HH:MM` format. Ej.: `09:25`.
   * Demora operativa, no cambio de horario (ver `updatedDepartureDate`).
   */
  updatedDepartureTime?: string;
  /** The departure terminal name. Ej.: `Terminal D`. */
  departureTerminalName?: string;
  /** The departure gate number. Ej.: `D`. */
  departureGate?: string;
  /**
   * The scheduled arrival date in `YYYY-MM-DD` format in the airport's time zone. Ej.:
   * `2024-07-09`.
   */
  arrivalDate: string;
  /** The scheduled time of arrival in `HH:MM` format. Ej.: `12:28`. */
  arrivalTime: string;
  /**
   * The estimated (before arrival) or actual arrival date in `YYYY-MM-DD` format in the airport's
   * time zone. Ej.: `2024-07-09`. Demora operativa, no cambio de horario (ver
   * `updatedDepartureDate`).
   */
  updatedArrivalDate?: string;
  /**
   * The estimated (before arrival) or actual arrival time in `HH:MM` format. Ej.: `12:38`. Demora
   * operativa, no cambio de horario (ver `updatedDepartureDate`).
   */
  updatedArrivalTime?: string;
  /** The arrival terminal name. Ej.: `Terminal 1`. */
  arrivalTerminalName?: string;
  /** The arrival gate's number. Ej.: `1`. */
  arrivalGate?: string;
  /**
   * Lists seats assigned to the travelers. The first seat in the `seats` array corresponds to the
   * first traveler in the `travelers` array, the second seat to the second traveler, and so on. An
   * empty Seat object or a null value indicates that no seat is assigned to the corresponding
   * traveler. In the case of a change of gauge or funnel flight, this array lists seats for the
   * first aircraft.
   */
  seats?: BookingSeat[];
  /**
   * Lists seats assigned to the travelers on the departing aircraft on a change of gauge or funnel
   * flight. The first seat in the `seats` array corresponds to the first traveler in the
   * `travelers` array, the second seat to the second traveler, and so on. A null value instead of
   * a `Seat` object indicates that there is no seat assigned to the corresponding traveler.
   */
  changeOfGaugeSeats?: BookingSeat[];
  /**
   * The quantity of seats occupied by the travelers. Specific seat details, if applicable, are
   * listed in the 'seats' array. Ej.: `1`.
   */
  numberOfSeats?: number;
  /**
   * The type of aircraft cabin. The name used is specific to the airline carrier's naming
   * convention. Ej.: `Coach`.
   */
  cabinTypeName?: string;
  /** The cabin type code. Ej.: `C`. */
  cabinTypeCode?: string;
  /** The IATA code of the aircraft. Ej.: `E90`. */
  aircraftTypeCode?: string;
  /** The name of the aircraft model. Ej.: `EMBRAER EMB E90`. */
  aircraftTypeName?: string;
  /** The booking inventory code of the marketing airline. Ej.: `Y`. */
  bookingClass?: string;
  /** Lists the meal options provided on the flight. */
  meals?: BookingMeal[];
  /** The two-letter status code used by vendors. It indicates the booking status. Ej.: `AF`. */
  flightStatusCode?: string;
  /** The meaningful value describing the booking status. */
  flightStatusName?: BookingStatusNameEnum;
  /** Flight duration in minutes. Ej.: `590`. */
  durationInMinutes?: number;
  /** The flight distance in miles. Ej.: `5143`. */
  distanceInMiles?: number;
  /**
   * The IATA code of the aircraft. This property is not returned when the aircraft type is
   * unchanged. This property will be deprecated in the future major version of this API. If you
   * wish to check hidden stop information, use the `hiddenStops` list instead. Ej.: `E90`.
   */
  hiddenStopAircraftTypeCode?: string;
  /**
   * The name of the aircraft model. This property is not returned when the aircraft type is
   * unchanged. This property will be deprecated in the future major version of this API. If you
   * wish to check hidden stop information, use the `hiddenStops` list instead. Ej.: `EMBRAER EMB
   * E90`.
   */
  hiddenStopAircraftTypeName?: string;
  /**
   * The three-letter IATA airport code of the hidden stop airport. This property is not returned
   * when the aircraft type is unchanged. This property will be deprecated in the future major
   * version of this API. If you wish to check hidden stop information, use the `hiddenStops` list
   * instead. Ej.: `HAV`.
   */
  hiddenStopAirportCode?: string;
  /**
   * The arrival date to the hidden stop airport in the `YYYY-MM-DD` format in the airport's time
   * zone. This property is not returned when the aircraft type is unchanged. This property will be
   * deprecated in the future major version of this API. If you wish to check hidden stop
   * information, use the `hiddenStops` list instead. Ej.: `2024-07-09`.
   */
  hiddenStopArrivalDate?: string;
  /**
   * The time of arrival to the hidden stop airport in the `HH:MM` format. This property is not
   * returned when the aircraft type is unchanged. This property will be deprecated in the future
   * major version of this API. If you wish to check hidden stop information, use the `hiddenStops`
   * list instead. Ej.: `09:15`.
   */
  hiddenStopArrivalTime?: string;
  /**
   * The departure date from the hidden stop airport in the `YYYY-MM-DD` format in the airport's
   * time zone. This property is not returned when the aircraft type is unchanged. This property
   * will be deprecated in the future major version of this API. If you wish to check hidden stop
   * information, use the `hiddenStops` list instead. Ej.: `2024-07-09`.
   */
  hiddenStopDepartureDate?: string;
  /**
   * The time of departure from the hidden stop airport in the `HH:MM` format. This property is not
   * returned when the aircraft type is unchanged. This property will be deprecated in the future
   * major version of this API. If you wish to check hidden stop information, use the `hiddenStops`
   * list instead. Ej.: `09:15`.
   */
  hiddenStopDepartureTime?: string;
  /** Lists details of hidden stops that are part of the flight. */
  hiddenStops?: BookingHiddenStop[];
  /**
   * Lists the travelers within the `travelers` list. Indicates which travelers are associated with
   * a particular flight.
   */
  travelerIndices?: number[];
  /** Lists assigned identity documents with statuses for each flight. */
  identityDocuments?: BookingIdentityDocumentReference[];
  /** If true, the current flight is past-dated. */
  isPast?: boolean;
  /**
   * The date in `YYYY-MM-DD` format when the flight was booked and stored in the booking. Not
   * applicable for NDC. Ej.: `2021-01-09`.
   */
  creationDate?: string;
  /**
   * The time in `HH:MM` format when the flight was booked and stored in the booking. Not
   * applicable for NDC. Ej.: `15:00`.
   */
  creationTime?: string;
}

/** Contains penalty information applied to specific fare rules. */
export interface BookingFareRulePenalty {
  /** Identifies whether a penalty is applicable before or after departure. */
  applicability: BookingFareRulePenaltyApplicabilityEnum;
  /** If `true`, additional restrictions apply. */
  conditionsApply?: boolean;
  /** Contains the total cost of the penalty. */
  penalty: BookingValue;
  /** If `true`, the traveler is charged in case they do not show up for the flight. */
  hasNoShowCost?: boolean;
  /** Contains the total cost of the penalty in case of a no-show. */
  noShowPenalty?: BookingValue;
}

/** Contains the allowed baggage number which is included in the ticket price. */
export interface BookingBaggageAllowance {
  /**
   * The maximum number of baggage pieces allowed across all baggage policies. A value of 0
   * indicates that no baggage pieces are permitted. Ej.: `1`.
   */
  maximumPieces?: number;
  /** Maximum summary weight of all allowed baggage measured in pounds [lb]. Ej.: `50`. */
  totalWeightInPounds?: number;
  /** Maximum summary weight of all allowed baggage measured in kilograms [kg]. Ej.: `23`. */
  totalWeightInKilograms?: number;
  /** Lists baggage allowance policies for each type of baggage. */
  baggagePieces?: BookingBaggagePolicy[];
}

/** Contains restrictions applied on number of baggage pieces and optional fee applicable. */
export interface BookingBaggagePolicy {
  /**
   * Maximum allowed size of the baggage piece measured in inches [in]. If null, no size limit is
   * specified for this type of baggage. Ej.: `46`.
   */
  maximumSizeInInches?: number;
  /**
   * Maximum allowed size of the baggage piece measured in centimeters [cm]. If null, no size limit
   * is specified for this type of baggage. Ej.: `118`.
   */
  maximumSizeInCentimeters?: number;
  /**
   * Maximum allowed weight of the baggage piece measured in pounds [lb]. If null, no weight limit
   * is specified for this type of baggage. Ej.: `50`.
   */
  maximumWeightInPounds?: number;
  /**
   * Maximum allowed weight of the baggage piece measured in kilograms [kg]. If null, no weight
   * limit is specified for this type of baggage. Ej.: `23`.
   */
  maximumWeightInKilograms?: number;
  /** The number of pieces allowed within the baggage policy. Ej.: `1`. */
  numberOfPieces: number;
  /**
   * The description of the special baggage items allowed, if the baggage policy provides
   * information about special baggage items such as musical instruments, fishing or sporting
   * equipment, mobility device, etc. Ej.: `SKI EQUIPMENT UP TO 50LB`.
   */
  specialItemDescription?: string;
  /**
   * If `true`, the baggage restrictions are for informational purposes only. Baggage is available
   * for purchase during check-in at the airport.
   */
  isCheckInOnly?: boolean;
  /**
   * Fee applicable for each item of the baggage. If null, no payment is required for this type of
   * baggage.
   */
  fee?: BookingValue;
}

/** Contains details about the fare creation. */
export interface BookingFareCreationDetails {
  /**
   * The sine of the Employee Profile Record that created the booking. Not supported for NDC
   * bookings. Ej.: `A12`.
   */
  creationUserSine?: string;
  /** The date in `YYYY-MM-DD` format when the booking was created. Ej.: `2024-01-09`. */
  creationDate?: string;
  /**
   * The time in `HH:MM` format when the booking was created. Not supported for NDC bookings. Ej.:
   * `15:00`.
   */
  creationTime?: string;
  /**
   * The date in the `YYYY-MM-DD` format by which the stored fare must be ticketed. Ej.:
   * `2024-01-09`.
   */
  purchaseDeadlineDate?: string;
  /** The time in the `HH:MM` format by which the stored fare must be ticketed. Ej.: `15:00`. */
  purchaseDeadlineTime?: string;
  /**
   * A unique identifier accredited by the International Air Transport Association (IATA). Ej.:
   * `99119911`.
   */
  agencyIataNumber?: string;
  /** The pseudo city code where the booking was created. Ej.: `AB12`. */
  userWorkPcc?: string;
  /** The pseudo city code of the agent who created the booking. Ej.: `CD34`. */
  userHomePcc?: string;
  /**
   * The identification code for the prime host (global distribution system) associated with the
   * reservation. Ej.: `1S`.
   */
  primeHostId?: string;
}

/** Contains the commission amount applicable to the fare or ticket. */
export interface BookingCommission {
  /** The commission amount included in the fare or applied during ticketing. Ej.: `25.00`. */
  commissionAmount?: string;
  /**
   * The three letters [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html) currency code.
   * Ej.: `USD`.
   */
  currencyCode?: string;
  /** The commission percentage included in the fare or applied during ticketing. Ej.: `5.00`. */
  commissionPercentage?: string;
}

/** Contains details of a specific fare component. */
export interface BookingFareComponent {
  /**
   * Lists flights referenced by flight `itemId`. Multiple flight IDs can be returned for a single
   * fare component. If the fare component is associated with all flights or a different flight
   * itinerary was used to create this fare component (verify `isCurrentItinerary` property), this
   * list is not provided.
   */
  flights?: BookingFlightReference[];
  /**
   * Lists the indices of flights within the current itinerary. If the fare component is associated
   * with all flights, this list is not provided. This property will be deprecated in the future
   * major version of this API. If you wish to check flight association, use the `flights` property
   * within the `FareComponent` object.
   */
  flightIndices?: number[];
  /** The fare basis code used for fare construction. Ej.: `ABCDE10`. */
  fareBasisCode?: string;
  /** Contains the base fare amount. */
  baseRate?: BookingValue;
  /** The code of the Branded Fare. Ej.: `ECOFLEX`. */
  brandFareCode?: string;
  /** The name of the Branded Fare. Ej.: `ECO FLEX`. */
  brandFareName?: string;
  /** The code of the program the Branded Fare belongs to. Ej.: `CFFLH`. */
  brandProgramCode?: string;
  /** The name of the program the Branded Fare belongs to. Ej.: `LH BRANDED FARES INTERCONT`. */
  brandProgramName?: string;
  /** Lists Branded Fare (Price Class) attributes from NDC offers. */
  brandAttributes?: BookingBrandAttribute[];
  /**
   * If `true`, the fare component was created for a flight present in the current itinerary. If
   * `false`, the fare component is related to a flight which is no longer a part of the current
   * itinerary. This may be the case, for example, after a schedule change.
   */
  isCurrentItinerary?: boolean;
  /** Indicates the allowed checked baggage included in the fare. */
  checkedBaggageAllowance?: BookingBaggageAllowance;
  /** The accountCode used for fare construction. Ej.: `SME23`. */
  accountCode?: string;
}

/** Contains details for a single tax. */
export interface BookingTaxComponent {
  /** The desired tax code. Must be combined with `taxAmount`. Ej.: `XY`. */
  taxCode?: string;
  /** Contains the tax amount. */
  taxAmount?: BookingValue;
  /** If `true`, the tax was already paid during ticket issuance. */
  isPaid?: boolean;
}

/**
 * Contains details of the payment amount - the total amount to pay, the amount before tax, the
 * amount of fees, and the amount of tax.
 */
export type BookingTotalValues = BookingGenericTotalValues & {
  /** The amount of all applicable fees. Ej.: `20.00`. */
  fees?: string;
  /**
   * The net remit amount. The EPR keyword "NETFQD" is required to return `netRemit`. Net remit is
   * used to arrange the payment of an additional commission above the standard commission amount.
   * This extra commission is payable by the validating carrier through the BSP settlement cycle.
   * Ej.: `110.00`.
   */
  netRemit?: string;
};

/** Contains a service or fee that is bundled with the fare. */
export interface BookingFareService {
  /** The type of the fare service or fee. Ej.: `FEE`. */
  type?: string;
  /** The category of the fare service or fee. Ej.: `SEAT`. */
  code?: string;
  /** The applicable unit count for the service or fee. Ej.: `1`. */
  quantity?: number;
  /** The monetary amount of fare fee. Ej.: `100.00`. */
  amount?: string;
  /** The three-letter ISO 4217 code of the `amount` currency. Ej.: `USD`. */
  currencyCode?: string;
  /** Textual information about the service or fee. Ej.: `Qantas Points`. */
  description?: string;
}

/**
 * Contains details of the payment amount in original currency of the base fare - the total amount
 * to pay, the amount before tax, and the amount of tax.
 */
export interface BookingOriginalTotalValues {
  /**
   * The total amount in original currency; the sum of the `subtotal`, `taxes`, and `fees`. Ej.:
   * `128.00`.
   */
  total?: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
}

/** Identifies pricing type code of a fare. */
export type BookingPricingTypeCodeEnum = 'S' | 'A' | 'M' | (string & {});

/** Identifies the pricing type of a fare. */
export type BookingPricingTypeNameEnum = 'System' | 'Amended' | 'Manual' | 'Unknown' | (string & {});

/** Identifies the status code of a fare. */
export type BookingPricingStatusCodeEnum = 'A' | 'H' | (string & {});

/** Identifies the status name of a fare. */
export type BookingPricingStatusNameEnum = 'Active' | 'History' | (string & {});

/**
 * Contains details of the initially offered fare. To obtain this data, the Employee Profile Record
 * (EPR) needs to include the ORGFQD keyword.
 */
export interface BookingInitialSellingFare {
  /**
   * Contains details of the payment amount - the total amount to pay, the amount before tax, and
   * the amount of tax.
   */
  totals?: BookingGenericTotalValues;
  /**
   * Contains a breakdown of the fare difference between the initially offered fare totals and the
   * final fare totals.
   */
  fareDifferenceBreakdown?: BookingFareDifferenceBreakdown;
}

/** Identifies the type associated with the particular remark. */
export type BookingRemarkTypeEnum = 'GENERAL' | 'HISTORICAL' | 'CLIENT_ADDRESS' | 'ALPHA_CODED' | 'DELIVERY_ADDRESS' | 'ITINERARY' | 'INVOICE' | 'HIDDEN' | 'CORPORATE' | 'FORM_OF_PAYMENT' | 'PRINT_ON_TICKET' | 'FILLER_STRIP' | 'INTERFACE' | 'QUEUE_PLACE' | (string & {});

/** Contains hotel object reference by `itemId`. */
export interface BookingHotelReference {
  /** The ID of a hotel reservation. Ej.: `12`. */
  itemId: string;
}

/** Contains hotel information for the given booking. */
export interface BookingHotelItem {
  /** The hotel supplier reservation number. Ej.: `23428937429074`. */
  confirmationId?: string;
  /** The full name of the hotel. Ej.: `Ilia Hotel and Luxury Suites`. */
  hotelName: string;
  /** The exact location of the hotel. */
  address: BookingHotelAddress;
  /** The check-in date in `YYYY-MM-DD` format in the hotel's local time zone. Ej.: `2024-07-09`. */
  checkInDate: string;
  /** The check-in time in `HH:MM` format in the hotel's local time. Ej.: `15:00`. */
  checkInTime: string;
  /** The checkout date in `YYYY-MM-DD` format in the hotel's local time zone. Ej.: `2024-07-19`. */
  checkOutDate: string;
  /** The checkout time in `HH:MM` format in the hotel's local time. Ej.: `11:00`. */
  checkOutTime: string;
  /**
   * A discount code that a company may provide to an agency. Usually tied to a negotiated rate
   * code. Ej.: `6878700`.
   */
  corporateDiscountCode?: number;
  /**
   * Specifies the lead traveler from the travelers list with whom the hotel booking is associated.
   * Ej.: `1`.
   */
  leadTravelerIndex?: number;
  /** The number of rooms in the hotel reservation. */
  room?: BookingRoom;
  /**
   * If `true`, the hotel reservation can be refunded in total or in segments. Refer to the
   * `refundPenalties` array for more information.
   */
  isRefundable: boolean;
  /** Lists conditions and payments for hotel room reservation cancellations. */
  refundPenalties?: BookingHotelDateRangeRefundPenalty[];
  /**
   * The penalty code for a cancellation within the context of legacy GDS hotel content. Ej.:
   * `01D`.
   */
  refundPenaltyPolicyCode?: string;
  /**
   * The one or two-letter status code used by vendors. It indicates the hotel booking status. Ej.:
   * `HK`.
   */
  hotelStatusCode?: string;
  /** The meaningful value describing hotel booking status. */
  hotelStatusName?: BookingStatusNameEnum;
  /** The two character code of the chain. Ej.: `BY`. */
  chainCode?: string;
  /** The name of the chain. Ej.: `Banyan Tree Hotels and Resorts`. */
  chainName?: string;
  /** The unique ID of the property agreed between vendors. Ej.: `100144834`. */
  propertyId?: string;
  /**
   * The code that uniquely identifies a single hotel property. This is a legacy concept, to be
   * sunset in the future major version. Ej.: `7678`.
   */
  sabrePropertyId?: string;
  /** Contains contact information for the hotel. */
  contactInfo?: BookingContactInformation;
  /**
   * Additional special requests put in by the traveler with regards to the hotel reservation. Ej.:
   * `Need a wi-fi in the room.`.
   */
  specialInstructions?: string;
  /**
   * The Open Travel Alliance [Payment Type
   * Code](https://opentravel.org/download-the-opentravel-specification). Applicable OTA codes can
   * be one of the following - 5, 18, 19, 29, 30, or 43. Ej.: `5`.
   */
  guaranteeTypeCode?: number;
  /** The name associated with the Open Travel Alliance Payment Type Code. */
  guaranteeTypeName?: BookingGuaranteeTypeNameEnum;
  /**
   * Provides information regarding the guarantee provided for the legacy GDS hotel content. Ej.:
   * `GVI4XXXXXXXXXXX1111EXP 01 25-HOTEL`.
   */
  guaranteePaymentNote?: string;
  /** Identifies the hotel payment policy. */
  paymentPolicy?: BookingHotelPaymentPolicyEnum;
  /** Contains payment information for the service. */
  payment?: BookingTotalValues;
  /** The number of guests. Ej.: `1`. */
  numberOfGuests?: number;
  /** Contains flight arrival and departure information used mainly for hotel bookings. */
  associatedFlightDetails?: BookingAssociatedFlightDetails;
  /** A specific numeric code indicating the source of the hotel booking. Ej.: `100`. */
  sourceTypeCode?: number;
  /** Identifies the source of the hotel booking. */
  sourceTypeName?: BookingHotelSourceEnum;
  /**
   * Identifier of the hotel reservation as provided by Booking.com. This field is populated only
   * for reservations sourced from Booking.com and is not applicable to other lodging providers.
   * Ej.: `0890`.
   */
  pinCode?: string;
  /** Indicates whether force update was applied to the booking. */
  forceUpdate?: BookingForceHotelUpdateDetails;
}

/** Contains car object reference by `itemId`. */
export interface BookingCarReference {
  /** The id of the given car reservation. Ej.: `12`. */
  itemId: string;
}

/** Contains car rental information for the given booking. */
export interface BookingCarItem {
  /** The car rental reservation number. Ej.: `843296421`. */
  confirmationId?: string;
  /**
   * Specifies the traveler from the travelers list with whom the car booking is associated. Ej.:
   * `1`.
   */
  travelerIndex?: number;
  /** The full name of the car rental vendor. Ej.: `National`. */
  vendorName: string;
  /** The two-letter code of the car rental vendor. Ej.: `ZE`. */
  vendorCode: string;
  /** The code of the pick-up location. Ej.: `DFW`. */
  pickUpLocationCode?: string;
  /** Car pick up location. */
  pickUpAddress: BookingGenericAddress;
  /**
   * The pick up date of the rental car in `YYYY-MM-DD` format in the pick up location local time
   * zone. Ej.: `2024-07-09`.
   */
  pickUpDate: string;
  /**
   * The time of the rental car pick up in `HH:MM` format in the pick up location local time. Ej.:
   * `13:00`.
   */
  pickUpTime: string;
  /** Contains contact information for the pickup location. */
  pickUpContactInfo?: BookingContactInformation;
  /** The code of the drop-off location. Ej.: `DEN`. */
  dropOffLocationCode?: string;
  /** Car drop off location. */
  dropOffAddress?: BookingGenericAddress;
  /**
   * The drop off date of the rental car in `YYYY-MM-DD` format in the drop off location local time
   * zone. Ej.: `2024-07-19`.
   */
  dropOffDate: string;
  /**
   * The time of the rental car drop off in `HH:MM` format in the drop off location local time.
   * Ej.: `12:00`.
   */
  dropOffTime: string;
  /** Contains the contact information for the drop-off location. */
  dropOffContactInfo?: BookingContactInformation;
  /** Contains the custom collection address of the booked car. */
  collectionAddress?: BookingAddress;
  /** Contains the details of the custom collection location for the booked car. */
  collectionSite?: BookingCarRentalSite;
  /** Contains the custom delivery address for the booked car. */
  deliveryAddress?: BookingAddress;
  /** Contains details of the custom delivery location for the booked car. */
  deliverySite?: BookingCarRentalSite;
  /**
   * If `true`, the car rental can be refunded in total or in segments. Refer to the
   * `refundPenalties` array for more information.
   */
  isRefundable: boolean;
  /** Lists the conditions and payments for a car rental cancellation. */
  refundPenalties?: BookingDateRangeRefundPenalty[];
  /**
   * The one or two-letter status code used by vendors. It indicates the car's booking status. Ej.:
   * `HK`.
   */
  carStatusCode?: string;
  /** The meaningful value describing car booking status. */
  carStatusName?: BookingStatusNameEnum;
  /** The 4 character [ACRISS](https://www.acriss.org/car-codes/) code of the car. Ej.: `MBMR`. */
  vehicleTypeCode?: string;
  /**
   * Identifies the name of the car type based on the second character of the
   * [ACRISS](https://www.acriss.org/car-codes/) code.
   */
  vehicleTypeName?: BookingVehicleTypeNameEnum;
  /** The number of requested cars. Ej.: `1`. */
  numberOfVehicles?: number;
  /** The unique ID for an offer at a given vendor. Ej.: `RCUD1`. */
  rateCode?: string;
  /** The included distance in the car rental booking. Ej.: `UNL`. */
  distanceAllowance?: string;
  /**
   * The payment information provided to the vendor to guarantee the booking. Ej.:
   * `GVI4XXXXXXXXXXX0008EXP 03 22-TEST CAR`.
   */
  guaranteePaymentNote?: string;
  /** The special information provided to the vendor. Ej.: `NON-SMOKING CAR PLEASE`. */
  specialInstructions?: string;
  /** Contains payment information for the service. */
  payment?: BookingTotalValues;
  /** Identifies the payment information type provided to the vendor to guarantee the booking. */
  guaranteePaymentType?: BookingGuaranteePaymentTypeEnum;
}

/** Contains train object reference by `itemId`. */
export interface BookingTrainReference {
  /** The id of the given train reservation. Ej.: `12`. */
  itemId: string;
}

/** Contains train information for the given booking. */
export interface BookingTrainItem {
  /** The train reservation number. Ej.: `76E220`. */
  confirmationId?: string;
  /** The train number associated with the marketing railroad company. Ej.: `822`. */
  trainNumber: string;
  /** The train name associated with the marketing railroad company. Ej.: `Heartland Flyer`. */
  trainName?: string;
  /** The two-letter IATA designator code of the marketing railroad company. Ej.: `2V`. */
  vendorCode: string;
  /** The name of the marketing railroad company. Ej.: `Amtrak`. */
  vendorName?: string;
  /** The two-letter IATA designator code of the operating railroad company. Ej.: `2V`. */
  operatingVendorCode?: string;
  /** The name of the operating railroad company. Ej.: `Amtrak`. */
  operatingVendorName?: string;
  /**
   * The origin train station code of the marketing railroad company station coding system. Ej.:
   * `FTW`.
   */
  fromStationCode: string;
  /** The train station name of the origin station. Ej.: `Central Station`. */
  fromStationName?: string;
  /**
   * The destination train station code of the marketing railroad company station coding system.
   * Ej.: `ATL`.
   */
  toStationCode: string;
  /** The train station name of the destination station. Ej.: `Peachtree Station`. */
  toStationName?: string;
  /**
   * The scheduled departure date in `YYYY-MM-DD` format in the train station's timezone. Ej.:
   * `2024-07-10`.
   */
  departureDate: string;
  /** The scheduled time of departure in `HH:MM` format. Ej.: `19:15`. */
  departureTime: string;
  /**
   * The scheduled arrival date in `YYYY-MM-DD` format in the train station's timezone. Ej.:
   * `2024-07-10`.
   */
  arrivalDate: string;
  /** The scheduled time of arrival in `HH:MM` format. Ej.: `23:10`. */
  arrivalTime: string;
  /** If true, the train reservation can be refunded in total. */
  isRefundable?: boolean;
  /**
   * The one or two-letter status code used by vendors. It indicates the train's booking status.
   * Ej.: `HK`.
   */
  trainStatusCode?: string;
  /** The meaningful value describing train's booking status. */
  trainStatusName?: BookingStatusNameEnum;
  /** Contains payment information for the service. */
  payment?: BookingTotalValues;
}

/** Contains cruise object reference by `itemId`. */
export interface BookingCruiseReference {
  /** The id of the given cruise reservation. Ej.: `12`. */
  itemId: string;
}

/** Contains cruise information for the given booking. */
export interface BookingCruiseItem {
  /** The cruise booking reference ID in the cruise line's system. Ej.: `XPCD8Q`. */
  confirmationId?: string;
  /** The cruise vendor code. Ej.: `PC`. */
  vendorCode: string;
  /** The ship code in the cruise line system. Ej.: `RP`. */
  shipCode?: string;
  /** The ship name in the cruise line system. Ej.: `Royal Princess`. */
  shipName?: string;
  /** The origin port code. Ej.: `ANC`. */
  fromPortCode: string;
  /**
   * The destination port code for cruises where destination port is different than the origin
   * port. Ej.: `YVR`.
   */
  toPortCode?: string;
  /** The departure date in `YYYY-MM-DD` format in the origin port's timezone. Ej.: `2024-07-12`. */
  departureDate: string;
  /** The time of departure in `HH:MM` format. Ej.: `16:00`. */
  departureTime?: string;
  /** The arrival date in `YYYY-MM-DD` format in the port's timezone. Ej.: `2024-07-15`. */
  arrivalDate: string;
  /** The time of arrival in `HH:MM` format. Ej.: `09:00`. */
  arrivalTime?: string;
  /** The number of guests. Ej.: `2`. */
  numberOfGuests?: number;
  /** The number of the reserved cabin on the ship. Ej.: `C101`. */
  cabinNumber?: string;
  /**
   * The one or two-letter status code used by vendors. It indicates the cruise's booking status.
   * Ej.: `GK`.
   */
  cruiseStatusCode?: string;
  /** The meaningful value describing the cruise's booking status. */
  cruiseStatusName?: BookingStatusNameEnum;
}

/** Contains the unique ID of the segment. */
export interface BookingSegmentReference {
  /**
   * The unique ID of the segment which may correspond to the itemId of a booking element, such as
   * flight, hotel, car, etc. Ej.: `12`.
   */
  id: string;
}

/**
 * Contains basic attributes common for all possible types of booking segments. Provided attributes
 * are only relevant to the segment type.
 */
export interface BookingSegmentBasicAttributes {
  /** The type of the booking segment. Ej.: `FLIGHT`. */
  type: string;
  /**
   * The name or description of the segment, such as flight number for the segment representing a
   * flight. Ej.: `123`.
   */
  text?: string;
  /**
   * The corresponding vendor code, such as carrier code for a `FLIGHT` type segment, or hotel
   * vendor code for a `HOTEL` type segment. Ej.: `AA`.
   */
  vendorCode?: string;
  /**
   * The date of the event represented by the segment in `YYYY-MM-DD` format and in the event's
   * local time zone. Not returned for events that span multiple days. Ej.: `2024-07-09`.
   */
  date?: string;
  /** The time of the event represented by the segment in `HH:MM` format. Ej.: `09:15`. */
  time?: string;
  /**
   * The code of the location of the event represented by the segment. This attribute does not
   * exist for an event with start and end locations. Ej.: `ATL`.
   */
  locationCode?: string;
  /**
   * The address of the event represented by the segment, such as hotel address for a `HOTEL` type
   * segment. This attribute does not exist for an event with start and end addresses.
   */
  address?: BookingGenericAddress;
  /**
   * The start date of the event represented by the segment, provided in `YYYY-MM-DD` format and in
   * the event's local timezone. Not populated for a single-day event. Ej.: `2024-07-09`.
   */
  startDate?: string;
  /** The start time of the event represented by the segment in `HH:MM` format. Ej.: `09:15`. */
  startTime?: string;
  /**
   * The code of the start location of the event represented by the segment, such as origin airport
   * code for a `FLIGHT` type segment. This attribute does not exist for a single location event,
   * such as cruise trip. Ej.: `DFW`.
   */
  startLocationCode?: string;
  /**
   * The event beginning address for the segment representing a transport type event, such as a car
   * reservation pick up address. This attribute does not exist for a stational event, such as
   * hotel reservation.
   */
  startAddress?: BookingGenericAddress;
  /**
   * The end date of the event represented by the segment, provided in `YYYY-MM-DD` format and in
   * the event's local timezone. Not populated for a single-day event, such as a one-day tour. Ej.:
   * `2024-07-09`.
   */
  endDate?: string;
  /** The end time of the event represented by the segment in `HH:MM` format. Ej.: `12:28`. */
  endTime?: string;
  /**
   * The code of the ending location of the event represented by the segment, such as destination
   * airport code for a `FLIGHT` type segment. This attribute does not exist for a single location
   * type event such as hotel or cruise reservation. Ej.: `HNL`.
   */
  endLocationCode?: string;
  /**
   * The event ending address for the segment representing transport type event with two addresses,
   * such as drop off address of a car reservation when there is different drop off address than
   * for pick up.
   */
  endAddress?: BookingGenericAddress;
}

/**
 * Contains coupon information of the corresponding flight, identified by `itemId`, for the given
 * booking.
 */
export type BookingFlightReferenceCoupon = BookingFlightReference & BookingCouponStatus;

/** Contains coupon status details. */
export type BookingTicketCoupon = BookingCouponStatus & {
  /** The identifier of the flight associated with the coupon and stored in the booking. Ej.: `12`. */
  itemId?: string;
};

/** Identifies the current status of the ticket. */
export type BookingTicketStatusEnum = 'Issued' | 'Voided' | 'Refunded/Exchanged' | (string & {});

/** Contains details of a form of payment. */
export type BookingFormOfPaymentResponse = BookingGenericFormOfPayment & {
  /**
   * Identifies the type of payment method. The `MISCELLANEOUS` payment method must be activated on
   * the agency level and requires a specific payment credit code. `INSTALLMENTS` is used for BSP
   * Brazil customers only and refers to payment by means of card installments commonly referred to
   * as "parcelado". `VIRTUAL_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE`, `COMPANY_NAME` are
   * used for hotel bookings. `VOUCHER` is used for vehicle booking.
   */
  type: BookingFormOfPaymentTypeResponseEnum;
  /**
   * Free‑form code used to represent agency‑specific or non‑standard payment indicators, such as
   * on‑account codes or CA/NOREF. Ej.: `CA/NOREF`.
   */
  customPaymentCode?: string;
  /**
   * The ID of the form of payment item stored in the booking. It can be used for reference
   * purposes during the fulfillment operation. Ej.: `12`.
   */
  itemId?: string;
};

/**
 * Contains details of the payment amount - the total amount to pay, the amount before tax, and the
 * amount of tax.
 */
export interface BookingGenericTotalValues {
  /** The subtotal before applying taxes and fees. Ej.: `100.00`. */
  subtotal?: string;
  /** The amount of all taxes. Ej.: `8.00`. */
  taxes?: string;
  /** The total amount; the sum of the `subtotal`, `taxes`, and `fees`. Ej.: `128.00`. */
  total: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode: string;
}

/** Contains Other Service Information (OSI) sent to or retrieved from a specific vendor. */
export interface BookingCommonOtherServiceInformation {
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the issuing airline. Ej.: `AA`.
   */
  airlineCode?: string;
  /**
   * Specifies the traveler from the `travelers` array whose name is associated with the ticket.
   * Ej.: `1`.
   */
  travelerIndex?: number;
  /** The text of the service information. Ej.: `/CX-J674A0957C0`. */
  serviceMessage?: string;
}

/** Identifies the booking status of the item. */
export type BookingStatusNameEnum = 'Confirmed' | 'Waitlisted' | 'On Request' | 'Pending' | 'Cancelled' | 'Infant/No Seat' | 'Priority Waitlist' | 'Quote' | 'Space Available' | 'Unconfirmed' | 'Pending Quote' | 'No Seat' | 'Standby' | 'Unknown' | (string & {});

/**
 * Identifies the association type of the accounting item, which indicates to whom the fare is
 * applied. Can be `Single Traveler` (fare amount applied to a singular passenger whose details are
 * provided in `FormOfPayment`), `All Travelers` (fare amount applied to all passengers together as
 * a group), or `Each Traveler` (fare amount applied to individual passengers).
 */
export type BookingFareApplicationTypeEnum = 'Single Traveler' | 'All Travelers' | 'Each Traveler' | (string & {});

/** Identifies the payment method of the accounting item. */
export type BookingAccountingFormOfPaymentTypeEnum = 'Cash' | 'Check' | 'Check or Cash' | 'Payment Card' | 'Masked Payment Card' | 'Unknown' | (string & {});

/** Identifies the ticket operation which triggered automatic accounting item creation. */
export type BookingAccountingItemCreationTypeEnum = 'First Issuance' | 'Exchange' | 'Refund' | 'Low Cost Carrier' | 'Ancillary Fee' | 'Credit Card Fee' | 'Booking Fee' | (string & {});

/** Indicates the type of tariff basis. */
export type BookingTariffBasisTypeEnum = 'Domestic' | 'Foreign' | 'International' | (string & {});

/** Contains details of Goods and Services Tax (GST). */
export interface BookingGoodsAndServicesTax {
  /** The tax code. Must be combined with `amount`. Ej.: `D`. */
  code?: string;
  /** The GST tax amount. Mutually exclusive with `percentage`. Ej.: `5.00`. */
  amount?: string;
  /** The GST tax percentage. Mutually exclusive with `amount`. Ej.: `5.00`. */
  percentage?: string;
}

/** Identifies the status of a nonelectronic ticket. */
export type BookingNonElectronicTicketStatusEnum = 'Active' | 'Inactive' | 'Unknown' | (string & {});

/**
 * Identifies the type of employer ID. Can be `GST` (Indian Goods and Services Tax information) or
 * `Unknown`.
 */
export type BookingEmployerIdTypeEnum = 'GST' | 'Unknown' | (string & {});

/** Contains phone details. */
export interface BookingPhone {
  /** The formatted phone number of the traveler. Ej.: `+1-555-123-4567`. */
  number: string;
  /**
   * The type of the phone number. Available phone type codes are `H` - home, `B` - business, `C` -
   * cell and `M` - mobile. Ej.: `M`.
   */
  label?: string;
}

/** Contains basic address information. */
export interface BookingAddress {
  /**
   * The street name and house number accompanied with the number of apartment, unit, or suite, if
   * applicable. Ej.: `1230 Ellen Ave, apt 10`.
   */
  street?: string;
  /** The name of the city. Ej.: `Dallas`. */
  city?: string;
  /** The name or code of the state or province. Ej.: `TX`. */
  stateProvince?: string;
  /** The zip or postal code. Ej.: `75063`. */
  postalCode?: string;
  /**
   * The two-letter [ISO 3166](https://www.iso.org/iso-3166-country-codes.html) country code. Ej.:
   * `US`.
   */
  countryCode?: string;
}

/** Identifies the type of passenger document. */
export type BookingDocumentTypeEnum = 'PASSPORT' | 'VISA' | 'SECURE_FLIGHT_PASSENGER_DATA' | 'RESIDENCE_ADDRESS' | 'DESTINATION_ADDRESS' | 'KNOWN_TRAVELER_NUMBER' | 'REDRESS_NUMBER' | 'ALIEN_RESIDENT' | 'PERMANENT_RESIDENT' | 'FACILITATION_DOCUMENT' | 'NATIONAL_ID_CARD' | 'NEXUS_CARD' | 'MILITARY' | 'NATURALIZATION_CERTIFICATE' | 'REFUGEE_REENTRY_PERMIT' | 'BORDER_CROSSING_CARD' | 'FISCAL_ID' | (string & {});

/**
 * Identifies the passenger document subtype for `documentType` set to `FISCAL_ID`. Can be `RUC`
 * (Taxpayer's Unique Registry in Ecuador), `CUIT/CUIL` (Argentina Unique Tax Identification Key),
 * or `NIT` (Tax Identification Number in Bolivia).
 */
export type BookingDocumentSubTypeEnum = 'RUC' | 'CUIT/CUIL' | 'NIT' | (string & {});

/**
 * Identifies the type of the passenger's passport document. Applies to identity documents with the
 * `documentType` parameter set to `PASSPORT`.
 */
export type BookingPassportTypeResponseEnum = 'National Passport' | 'Emergency Passport' | 'Diplomatic Passport' | 'Official/Service Passport' | 'Refugee Passport' | 'Alien Passport' | 'Stateless/Special Passport' | 'Laissez-passer Passport' | 'Mission/Service Passport' | 'Single Sheet Emergency Passport' | 'Passport' | 'Unknown' | (string & {});

/**
 * Identifies the type of the passenger’s visa document. Applies to identity documents with the
 * `documentType` parameter set to `VISA`. If the visa document type cannot be determined, it is
 * displayed as `Unknown`.
 */
export type BookingVisaTypeResponseEnum = 'U.S. Non Immigrant Visa' | 'U.S. Immigrant Visa' | 'Visa' | 'Unknown' | (string & {});

/** Identifies the type of the loyalty program. */
export type BookingProgramTypeEnum = 'FREQUENT_FLYER' | 'FREQUENT_RENTER' | 'LOYALTY_ID' | 'CORPORATE_LOYALTY_ID' | (string & {});

/**
 * Specifies the IATA-defined reason for the issuance code (RFIC) applicable to the Electronic
 * Miscellaneous Document (EMD) that will be issued for the subcode identified in this record. The
 * UNKNOWN option is used for the read-only purpose by getBooking API.
 */
export type BookingReasonForIssuanceEnum = 'AIR_TRANSPORTATION' | 'SURFACE_TRANSPORTATION_NON_AIR_SERVICES' | 'BAGGAGE' | 'FINANCIAL_IMPACT' | 'AIRPORT_SERVICES' | 'MERCHANDISE' | 'INFLIGHT_SERVICES' | 'INDIVIDUAL_AIRLINE_USE' | 'UNKNOWN' | (string & {});

/** The application source that provides the ancillary service. */
export type BookingAncillarySourceEnum = 'ATPCO' | 'MERCHANDISING_MANAGER' | (string & {});

/**
 * Identifies the applicability of the ancillary item to the flights in the booking. Can be
 * `Single` (an ancillary item applies to a single flight/sector of the booking), `Multiple` (an
 * ancillary item applies to the portion of flights in the booking), or `Unknown` (applicability of
 * the ancillary cannot be determined). This information is required when
 * `electronicMiscellaneousDocumentType` has the value `OTHER_THAN_EMD`.
 */
export type BookingFlightApplicabilityTypeEnum = 'Single' | 'Multiple' | 'Unknown' | (string & {});

/** Identifies the meaningful value describing the ancillary status. */
export type BookingAncillaryStatusNameEnum = 'Confirmed' | 'Confirmed with EMD issued' | 'On Request' | 'Pending' | 'Cancelled' | 'Unconfirmed' | 'Confirmed with pending payment' | 'Schedule change' | (string & {});

/** Contains desired tax codes and their associated amounts. */
export interface BookingTax {
  /** The desired tax code. Must be combined with `amount`. Ej.: `XY`. */
  taxCode: string;
  /** The monetary amount. Ej.: `100.00`. */
  amount: string;
}

/** Identifies source type of the flight. */
export type BookingFlightSourceEnum = 'ATPCO' | 'LCC' | 'NDC' | (string & {});

/** Contains detailed information about the seat. */
export interface BookingSeat {
  /** The traveler's assigned seat number. Ej.: `13A`. */
  number: string;
  /**
   * Lists all IATA-defined characteristic codes associated with the seat. For the list of all
   * codes refer to the following resource - IATA PADIS codeset element 9825.
   */
  characteristics?: string[];
  /** The two-letter status code used by vendors. It indicates the seat status. Ej.: `AF`. */
  statusCode?: string;
  /** The meaningful value describing the seat status. */
  statusName?: BookingStatusNameEnum;
}

/** Contains the meal options provided on the flight. */
export interface BookingMeal {
  /**
   * The code of the type of meal. Available meal type codes are `P`, `B`, `O`, `C`, `K`, `D`, `F`,
   * `G`, `H`, `L`, `M`, `N`, `R`, `V` and `S`. Ej.: `H`.
   */
  code: string;
  /** The description of the meal corresponding to the meal type code. */
  description: BookingMealDescriptionEnum;
}

/** Contains detailed information about the hidden stop location. */
export interface BookingHiddenStop {
  /** The three-letter IATA airport code of the hidden stop location. Ej.: `DFW`. */
  airportCode?: string;
  /**
   * The scheduled departure date in `YYYY-MM-DD` format in the airport's timezone. Ej.:
   * `2024-07-09`.
   */
  departureDate?: string;
  /** The scheduled time of departure in `HH:MM` format. Ej.: `09:15`. */
  departureTime?: string;
  /**
   * The scheduled arrival date in `YYYY-MM-DD` format in the airport's timezone. Ej.:
   * `2024-07-09`.
   */
  arrivalDate?: string;
  /** The scheduled time of arrival in `HH:MM` format. Ej.: `12:28`. */
  arrivalTime?: string;
  /** The IATA code of the aircraft. Ej.: `E90`. */
  aircraftTypeCode?: string;
  /** The name of the aircraft model. Ej.: `EMBRAER EMB E90`. */
  aircraftTypeName?: string;
  /** Layover duration in minutes. Ej.: `300`. */
  durationInMinutes?: number;
}

export interface BookingIdentityDocumentReference {
  /**
   * The unique identifier of the document. Ej.:
   * `76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f`.
   */
  itemId?: string;
  /** Status of the identity document for the given flight. Not applicable for NDC. */
  status?: BookingStatusNameEnum;
}

/** Identifies the applicability type associated with a particular fare rule penalty. */
export type BookingFareRulePenaltyApplicabilityEnum = 'BEFORE_DEPARTURE' | 'AFTER_DEPARTURE' | (string & {});

/** Contains monetary amount information. */
export interface BookingValue {
  /** The monetary amount. Ej.: `100.00`. */
  amount: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode: string;
}

/** Contains a Branded Fare attribute. */
export interface BookingBrandAttribute {
  /** The ID of a given Branded Fare attribute. Ej.: `SABRE_NDCC_ID_1`. */
  itemId?: string;
  /** Marketing information about the product. Ej.: `Qantas Points`. */
  description?: string;
}

/**
 * Contains a breakdown of the fare difference between the initially offered fare totals and the
 * final fare totals.
 */
export interface BookingFareDifferenceBreakdown {
  /** The monetary amount of the adjusted fare. Ej.: `100.00`. */
  adjustedAmount?: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
  /** Lists Goods and Services Taxes (GST) that adjust the total tax amount. */
  goodsAndServicesTaxes?: BookingGoodsAndServicesTax[];
  /** Lists handling fees. */
  fees?: BookingHandlingFee[];
}

/** Contains hotel address information. */
export type BookingHotelAddress = BookingGenericAddress & {
  /** The three-letter IATA city code of the hotel location. Ej.: `DFW`. */
  cityCode?: string;
};

/** Contains basic information of the rooms in the hotel with the number of rooms booked. */
export interface BookingRoom {
  /** The type of the room provided by the hotel supplier. Ej.: `2 double beds`. */
  roomType: string;
  /** Lists room extra information. */
  roomExtras?: BookingRoomExtraResponse[];
  /** The number of booked rooms of this room type. Ej.: `1`. */
  quantity: number;
  /**
   * The detailed description of the room provided by the hotel supplier. Ej.: `Deluxe Room, 2
   * Double Beds`.
   */
  description?: string;
  /** The unique ID for a room type at a given vendor. Ej.: `100144834`. */
  roomTypeCode?: string;
  /**
   * The inventory block code of the room. An ID returned by GDS suppliers for all unique room+rate
   * combinations. Populated only for GDS products. Ej.: `SM3A00`.
   */
  productCode?: string;
  /** The room rate amount and currency per night. */
  roomRate?: BookingValue;
  /**
   * Lists the travelers within the `travelers` list. Indicates which travelers are considered to
   * be guests associated with a particular room. It is possible that not all travelers are listed
   * as hotel guests in the hotel booking.
   */
  travelerIndices?: number[];
  /** Contains commission details applicable to the hotel rate. */
  agencyCommission?: BookingAgencyCommission;
  /** The client ID code of a negotiated rate specified by `supplierRateCode`. Ej.: `FOF`. */
  clientIdCode?: string;
  /**
   * The supplier-negotiated rate plan code for the client identified by `clientIdCode`. Ej.:
   * `FOS`.
   */
  supplierRateCode?: string;
  /** Lists hotel stay rate divided into interval (mostly per night) rates. */
  rateBreakdown?: BookingRateInterval[];
  /** Lists additional free-text rate information provided by the hotel supplier. */
  supplierRateDescription?: string[];
}

/**
 * Contains the date range up to which a hotel penalty is applicable, including the total cost of
 * the penalty.
 */
export interface BookingHotelDateRangeRefundPenalty {
  /**
   * The date from when the penalty becomes applicable, in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.:
   * `2024-07-07T16:00:00Z`.
   */
  applicableFromDate?: string;
  /**
   * The date when the penalty applicability ends, in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.:
   * `2024-07-09T16:00:00Z`.
   */
  applicableToDate?: string;
  /** Total cost of the penalty. */
  penalty: BookingHotelPenaltyValue;
}

/** Identifies the OTA payment name. */
export type BookingGuaranteeTypeNameEnum = 'Credit card' | 'Travel agency name/address' | 'Travel agency IATA number' | 'Company name/address' | 'Corporate ID/CD number' | 'Virtual card' | (string & {});

/** Identifies the hotel payment policy. */
export type BookingHotelPaymentPolicyEnum = 'DEPOSIT' | 'GUARANTEE' | 'LATE' | (string & {});

/** Contains flight arrival and departure information used mainly for hotel bookings. */
export type BookingAssociatedFlightDetails = BookingAssociatedArrivalFlight & {
  /** The scheduled time of arrival in `HH:MM` format. Ej.: `12:28`. */
  arrivalTime?: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the marketing airline for the departure flight. Ej.: `AA`.
   */
  departureAirlineCode?: string;
  /** The flight number associated with the marketing carrier for the departure flight. Ej.: `123`. */
  departureFlightNumber?: number;
  /** The scheduled time of departure in `HH:MM` format. Ej.: `09:15`. */
  departureTime?: string;
};

/** Identifies the source of the hotel booking. */
export type BookingHotelSourceEnum = 'Legacy' | 'Sabre GDS' | 'Expedia Associate Network' | 'HotelBeds.com' | 'Booking.com' | 'CMNet' | 'Unknown' | (string & {});

/** Information about force update for hotel segment. */
export interface BookingForceHotelUpdateDetails {
  /** If true, force update was applied to retrieve the latest booking state. */
  isUpdated?: boolean;
  /**
   * Provides the exact point in time when the force update request is generated. The
   * updateDateTime is expressed in UTC and presented in the YYYY-MM-DDTHH:MM:SSZ format. Ej.:
   * `2024-10-28T11:11:21Z`.
   */
  updateDateTime?: string;
}

/** Contains information about the car rental location. */
export interface BookingCarRentalSite {
  /**
   * The ID of the car rental location. Cannot be combined with other address-related qualifiers.
   * Ej.: `ABC123`.
   */
  id?: string;
  /** The name of the car rental location. Ej.: `TEST LOCATION`. */
  name?: string;
  /**
   * The phone number of the car rental location involved in vehicle collection or delivery. Ej.:
   * `8175551212`.
   */
  phone?: string;
}

/**
 * Contains the date range up to which a penalty is applicable, including the total cost of the
 * penalty.
 */
export interface BookingDateRangeRefundPenalty {
  /**
   * The date from when the penalty becomes applicable, in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.:
   * `2024-07-07T16:00:00Z`.
   */
  applicableFromDate?: string;
  /**
   * The date when the penalty applicability ends, in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.:
   * `2024-07-09T16:00:00Z`.
   */
  applicableToDate?: string;
  /** Total cost of the penalty. */
  penalty: BookingValue;
}

/**
 * Identifies the name of the car type based on the second character of the
 * [ACRISS](https://www.acriss.org/car-codes/) code.
 */
export type BookingVehicleTypeNameEnum = 'Two/Three Door' | 'Two/Four Door' | 'Four/Five Door' | 'Wagon/Estate' | 'Passenger Van' | 'Limousine/Sedan' | 'Sport' | 'Convertible' | 'SUV' | 'Open Air All Terrain' | 'Special' | 'Pick up single/extended cab 2 door' | 'Pick up double cab 4 door' | 'Special Offer Car' | 'Coupe' | 'Monospace' | 'Recreational Vehicle' | 'Motor Home' | 'Two Wheel Vehicle' | 'Roadster' | 'Crossover' | 'Commercial Van/Truck' | (string & {});

/** Identifies the payment information type provided to the car vendor. */
export type BookingGuaranteePaymentTypeEnum = 'Guarantee' | 'Deposit' | 'Unknown' | (string & {});

/** Contains the ticket's coupon information. */
export interface BookingCouponStatus {
  /** The descriptive current status of the coupon. */
  couponStatus: BookingCouponStatusEnum;
  /** The code of the current status of the ticket coupon based on IATA PADIS Codeset 4405. */
  couponStatusCode: BookingCouponStatusCodeEnum;
}

/** Contains details of a form of payment. */
export type BookingGenericFormOfPayment = BookingBasicFormOfPayment & {
  /** Contains `PAYMENTCARD` holder information. Used primarily for hotel and vehicle bookings. */
  cardHolder?: BookingCardHolder;
  /** Contains manual approval details of a form of payment. Use with `PAYMENTCARD`. */
  manualApproval?: BookingManualApproval;
  /**
   * Lists all strong customer authentication details for the payment card. For use with
   * `PAYMENTCARD`.
   */
  authentications?: BookingStrongCustomerAuthentication[];
  /** Contains virtual card details. Used primarily for the hotel bookings. */
  virtualCard?: BookingVirtualCard;
  /**
   * The agency IATA number. Use with `AGENCY_IATA`. Used primarily for the hotel bookings. Ej.:
   * `129345738`.
   */
  agencyIataNumber?: string;
  /** Contains the agency address. Use with `AGENCY_NAME`. Used primarily for the hotel bookings. */
  agencyAddress?: BookingGenericAddress;
  /** The corporate identifier. Use with `CORPORATE` or `PAYMENTCARD`. Ej.: `CC006`. */
  corporateId?: string;
  /** Contains company address. Use with `COMPANY_NAME`. Used primarily for the hotel bookings. */
  companyAddress?: BookingGenericAddress;
  /** Contains `VOUCHER` information. Used primarily for vehicle bookings. */
  voucher?: BookingVoucher;
  /** The net balance value. Use with `INSTALLMENTS`. Ej.: `300.20`. */
  netBalance?: string;
  /**
   * The prefix of the docket (a free text document) selected as form of payment. Use with
   * `DOCKET`. Ej.: `AGT*V`.
   */
  docketPrefix?: string;
  /**
   * The number of the docket (a free text document) selected as form of payment. Use with
   * `DOCKET`. Ej.: `654456`.
   */
  docketNumber?: string;
  /** The initials of the agent who issues the docket. Use with `DOCKET`. Ej.: `LS`. */
  docketIssuingAgentInitials?: string;
  /**
   * Details of the docket selected as form of payment in free text format. Use with `DOCKET`. Ej.:
   * `DOCKET NUM 0123456`.
   */
  docketDescription?: string;
  /**
   * Details of the Government Travel Request selected as form of payment in free text format. Use
   * with `GOVERNMENT_TRAVEL_REQUEST`. Ej.: `REQ-123456`.
   */
  governmentTravelRequestDescription?: string;
  /**
   * Details of the agency invoice selected as form of payment in free text format. Use with
   * `INVOICE`. Ej.: `AGT INVOICE`.
   */
  invoiceDescription?: string;
  /**
   * Identifies the single use type associated with the form of payment. This property will be
   * deprecated in the future major version of this API. If you wish to check the associated use
   * type, use the `useTypes` array instead.
   */
  useType?: BookingFormOfPaymentUseTypeEnum;
  /**
   * Identifies the single trip type associated with the form of payment. This property will be
   * deprecated in the future major version of this API. If you wish to check the associated trip
   * type, use the `tripTypes` array instead.
   */
  tripType?: BookingFormOfPaymentTripTypeEnum;
  /** Lists use types associated with the form of payment. */
  useTypes?: BookingFormOfPaymentUseTypeEnum[];
  /** Lists trip types associated with the form of payment. */
  tripTypes?: BookingFormOfPaymentTripTypeEnum[];
  /** If `true`, the card selected as form of payment belongs to a travel agency. */
  isAgencyPaymentCard?: boolean;
  /**
   * If `true`, the invoice form of payment free text description is preceded by a substring
   * `INV/`. Use with `INVOICE` and invoice description.
   */
  addInvoiceDescriptionPrefix?: boolean;
};

/**
 * Identifies the type of payment method. The `MISCELLANEOUS` payment method must be activated on
 * the agency level and requires a specific payment credit code. `INSTALLMENTS` is used for BSP
 * Brazil customers only and refers to payment by means of card installments commonly referred to
 * as "parcelado". `VIRTUAL_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE`, `COMPANY_NAME` are
 * used for hotel bookings. `VOUCHER` is used for vehicle booking.
 */
export type BookingFormOfPaymentTypeResponseEnum = 'PAYMENTCARD' | 'CASH' | 'CHECK' | 'MISCELLANEOUS' | 'INSTALLMENTS' | 'VIRTUAL_CARD' | 'AGENCY_NAME' | 'AGENCY_IATA' | 'CORPORATE' | 'COMPANY_NAME' | 'VOUCHER' | 'DOCKET' | 'GOVERNMENT_TRAVEL_REQUEST' | 'INVOICE' | 'ON_ACCOUNT' | (string & {});

/** Identifies the meal provided on the flight, matching accordingly to the meal type code. */
export type BookingMealDescriptionEnum = 'Alcoholic beverages for purchase' | 'Breakfast' | 'Cold meal' | 'Complimentary alcoholic beverages' | 'Continental breakfast' | 'Dinner' | 'Food for purchase' | 'Food and beverage for purchase' | 'Hot meal' | 'Lunch' | 'Meal' | 'No meal service' | 'Refreshment' | 'Refreshment for purchase' | 'Snack' | (string & {});

/**
 * Contains detailed information about the handling fee applied to the fare. This fee typically
 * covers administrative or processing costs.
 */
export interface BookingHandlingFee {
  /** The fee code. Ej.: `D`. */
  code?: string;
  /** The fee type. Ej.: `PTK`. */
  type?: string;
  /** The monetary amount of the fee. Ej.: `25.00`. */
  amount?: string;
}

/** Contains room extra information. */
export interface BookingRoomExtraResponse {
  /** Identifies the type of the room extra. Ej.: `196`. */
  typeCode?: number;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
  /** Identifies the name of the room extra. */
  typeName?: BookingRoomExtrasNameEnum;
  /** The number of room extras of this type. Ej.: `2`. */
  quantity?: number;
  /** The total monetary sum for room extras. Ej.: `100.00`. */
  amount?: string;
}

/** Contains commission details applicable to the hotel rate. */
export type BookingAgencyCommission = BookingCommission & {
  /**
   * Text describing commission details, as returned in the supplier’s rate display. Ej.:
   * `COMMISSIONABLE - 10.00 PERCENT`.
   */
  text?: string;
};

/** Hotel rate for a particular time range of the whole reservation. */
export interface BookingRateInterval {
  /** The monetary amount. Ej.: `100.00`. */
  amount?: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
  /**
   * The start date of the rate applicability in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.: `2026-07-09`.
   */
  startDate?: string;
  /**
   * The end date of the rate applicability in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.: `2026-07-19`.
   */
  endDate?: string;
}

/** Contains monetary amount information of hotel penalty. */
export type BookingHotelPenaltyValue = BookingValue & {
  /**
   * The hotel refund penalty expressed as percentage. If present, ignore `amount` returned. Ej.:
   * `5.00`.
   */
  percentage?: string;
  /**
   * Hotel cancellation penalty returned as the number of nights. If present, ignore `amount`
   * returned. Ej.: `2`.
   */
  numberOfNights?: number;
};

/** Contains flight information used for cars bookings. */
export interface BookingAssociatedArrivalFlight {
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the marketing airline for the arrival flight. Ej.: `AA`.
   */
  arrivalAirlineCode?: string;
  /** The flight number associated with the marketing carrier for the arrival flight. Ej.: `123`. */
  arrivalFlightNumber?: number;
}

/** Identifies descriptive status of the corresponding coupon status code. */
export type BookingCouponStatusEnum = 'Airport Control' | 'Lifted' | 'Checked In' | 'Exchanged' | 'Flown' | 'Not Flown' | 'Refunded' | 'Voided' | 'Printed' | 'Okay' | 'Reactivated' | 'Irregular Operations' | 'Print Exchange' | 'Paper Ticket' | 'Suspended' | 'Locked' | (string & {});

/** Identifies the coupon status code based on the IATA PADIS Codeset 4405. */
export type BookingCouponStatusCodeEnum = 'AL' | 'BD' | 'CK' | 'E' | 'B' | 'I' | 'RF' | 'V' | 'PR' | 'IO' | 'P' | 'PE' | 'T' | 'S' | 'XX' | (string & {});

/** Contains a set of basic details related to the form of payment. */
export interface BookingBasicFormOfPayment {
  /** The vendor code of a credit or debit card. Use with `PAYMENTCARD`. Ej.: `VI`. */
  cardTypeCode?: string;
  /** The number of a credit or debit card. Use with `PAYMENTCARD`. Ej.: `4537156488578956`. */
  cardNumber?: string;
  /** The security code of a credit or debit card. Use with `PAYMENTCARD`. Ej.: `123`. */
  cardSecurityCode?: string;
  /** The expiration date of a credit or debit card. Use with `PAYMENTCARD`. Ej.: `2024-07`. */
  expiryDate?: string;
  /**
   * The number of months by which your payment can be extended. Use with `PAYMENTCARD` or
   * `MISCELLANEOUS`. Ej.: `12`.
   */
  extendedPayment?: number;
  /** The miscellaneous credit code. Use with `MISCELLANEOUS`. Ej.: `PL189947`. */
  miscellaneousCreditCode?: string;
  /** The number of installments. Use with `INSTALLMENTS`. Ej.: `4`. */
  numberOfInstallments?: number;
  /** The airline plan code. Use with `INSTALLMENTS`. Ej.: `RG065`. */
  airlinePlanCode?: string;
  /** The amount of the first installment. Use with `INSTALLMENTS`. Ej.: `100`. */
  installmentAmount?: string;
}

/** Contains payment card holder information. */
export interface BookingCardHolder {
  /** The card holder's first name. Ej.: `John`. */
  givenName: string;
  /** The card holder's last name. Ej.: `Smith`. */
  surname: string;
  /** The card holder's email address. Ej.: `john@smith.family.priv`. */
  email?: string;
  /** The formatted phone numbers of the card holder. Ej.: `+1-555-123-4567`. */
  phone?: string;
  /** The address of the traveler. */
  address?: BookingAddress;
}

/** Contains manual approval details of a form of payment. Use with `PAYMENTCARD`. */
export interface BookingManualApproval {
  /** The manual approval code of a credit or debit card. Use with `PAYMENTCARD`. Ej.: `12345`. */
  code: string;
  /**
   * The manual approval request date in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Time should be provided
   * in UTC time zone. Ej.: `2024-07-09T09:15:00Z`.
   */
  requestDateTime: string;
  /**
   * The manual approval expiration date in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Time should be provided
   * in UTC time zone. Ej.: `2024-07-09T09:15:00Z`.
   */
  expiryDateTime: string;
  /**
   * The two-letter [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true)
   * designator code of the desired manual approval airline. Ej.: `AA`.
   */
  airlineCode: string;
  /** The monetary cash amount of the manual approval. Ej.: `100.00`. */
  amount: string;
  /** The [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html) currency code. Ej.: `USD`. */
  currencyCode: string;
}

/** Contains strong customer authentication details for the payment card. */
export interface BookingStrongCustomerAuthentication {
  /**
   * The 3DS authentication value (MasterCard - AAV; Amex - AEVV; Visa - CAVV). A 20-byte value
   * that has been Base64 encoded, giving a 28-byte result. Ej.: `ABC123455533533444455555678`.
   */
  secureAuthenticationValue?: string;
  /**
   * The 3DS transaction ID returned by the 3DS Directory Server. A 20 byte unsigned binary value.
   * Ej.: `ABCDEFGHI123456789012!.1234567890123`.
   */
  secureTransactionId?: string;
  /**
   * Indicates that authentication was attempted for a transaction, but there was an authentication
   * outage in the authentication flow between the merchant, gateway 3-D Secure (3DS) server, and
   * the Directory Server. This means an authentication request was not possible and an
   * authentication response could not be received. This is not a formal exemption, but information
   * for issuers to consider. Ej.: `AO`.
   */
  issueCode?: string;
  /** Indicates whether authentication was successful. Ej.: `OK`. */
  resultCode?: string;
  /**
   * Determines how the card number was collected for the transaction. Can be `K` - keyed in for
   * this transaction, or `S` - card on file (previously stored credentials). Ej.: `K`.
   */
  cardNumberCollectionCode?: string;
  /**
   * Indicates which channel the transaction was initiated in. Can be `MO` - Mail Order, `TO` -
   * Telephone Order, `EC` - ECOM, `FA` - Face to Face. Ej.: `MO`.
   */
  channelCode?: string;
  /**
   * The Electronic Commerce Indicator (ECI) is two alphanumeric code that is returned by the
   * issuing banks and credit card specific networks. Ej.: `12`.
   */
  electronicCommerceIndicator?: string;
  /**
   * Determines which exemption was used by the Payment Service Provider (PSP). Can be `SC` -
   * Secure Corporate Exemption, `DA` - Delegated Authentication, `TR` - Transaction Risk Analysis
   * Exemption, `TB` - Trusted Beneficiary Exemption, `LV` - Low Value Exemption. Ej.: `SC`.
   */
  exemptionTypeCode?: string;
  /**
   * Identifies the SCA update date and time in [ISO
   * 8601](https://www.iso.org/iso-8601-date-and-time-format.html) format. Ej.:
   * `2024-07-07T16:00:00Z`.
   */
  updatedDateTime?: string;
  /**
   * Describes the agreed mandate between the cardholder and the agent/third party. Can be one of
   * the following values: `NA` - No agreement for future transactions, `NS` - Agreement for future
   * no show or cancellation fee, `AC` - Agreement for any payments due after check in to cover
   * charges during stay, `CO` - Any charges post checkout, `BP` - Agreement for pre-payment,
   * deposit or balance payment, `FR` - Agreement for recurring payment (fixed date and fixed
   * amount), `VR` - Agreement for recurring payment (fixed date and variable amount), `UR` -
   * Agreement for recurring payment (non fixed date and variable amount). It is possible to enter
   * more than one value using a comma as a separator e.g. NA, NS. Ej.: `NA`.
   */
  mandateTypeCode?: string;
  /** The name of the merchant containing up to 40 alphanumeric characters. Ej.: `TEST CREDIT CARD`. */
  merchantName?: string;
  /**
   * The identifier of the authorization (Authorization Trace ID/Authorization Trans ID) request
   * when performed by the booking agent. This value can be up to 16 alphanumeric and special
   * characters, and is returned from the initial authorization response. Ej.: `1234547839012345`.
   */
  originalPaymentReference?: string;
  /** Indicates purchase amount. Ej.: `1234.56`. */
  amount?: string;
  /** The three-letter ISO 4217 currency code. Ej.: `USD`. */
  currencyCode?: string;
  /**
   * The authentication value for tokens (e.g. TAVV). A 20-byte value that has been Base64 encoded,
   * giving a 28-byte result. Ej.: `ABC3434334343556677487312567`.
   */
  tokenAuthenticationValue?: string;
  /** Indicates whether the cardholder is enrolled in 3DS. Ej.: `PASS`. */
  verificationResultCode?: string;
  /**
   * The 3DS Program Protocol version. A 3 alphanumeric character value, without dots between. Ej.:
   * `120`.
   */
  version?: string;
}

/** Contains virtual card information. */
export interface BookingVirtualCard {
  /** The customer account code of a virtual card. Use with `VIRTUAL_CARD`. Ej.: `John`. */
  customerAccountCode?: string;
  /** The agency email address. Ej.: `john@smith.family.priv`. */
  agencyEmail?: string;
  /** The hotel's fax number. Ej.: `+1-555-123-4567`. */
  hotelFax?: string;
  /**
   * The full name of the hotel. Pass the value obtained from
   * HotelPriceCheckRS/PriceCheckInfo/HotelInfo/@HotelName. Ej.: `Ilia Hotel and Luxury Suites`.
   */
  hotelName?: string;
  /**
   * The type of the room provided by the hotel supplier. Pass the value obtained from
   * HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/Rooms/Room/RoomDescription/@Name. Ej.: `2
   * double beds`.
   */
  roomType?: string;
  /**
   * The detailed description of the room provided by the hotel supplier. Pass the value obtained
   * from HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/Rooms/Room/RoomDescription/Text. Ej.:
   * `Deluxe Room, 2 Double Beds`.
   */
  roomDescription?: string;
  /**
   * Total amount for the hotel booking. Pass the value obtained from
   * HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/RateInfos/RateInfo/@AmountAfterTax and
   * @CurrencyCode.
   */
  rateAmount?: BookingValue;
  /**
   * Lists all extra charges that can be covered by the virtual card. If the card is used to cover
   * room only please pass "Room Only" value.
   */
  virtualCardCharges?: string[];
}

/** Contains voucher information. */
export interface BookingVoucher {
  /** The billing number associated with the voucher. Ej.: `1234567`. */
  billingNumber?: string;
  /** Abbreviated code that indicates the type of voucher. Ej.: `FC`. */
  type?: string;
}

/** Identifies the use type associated with the selected form of payment. */
export type BookingFormOfPaymentUseTypeEnum = 'All' | 'Ancillary' | 'Airline' | 'Bus/Ground Transportation' | 'Car' | 'Cruise' | 'Hotel' | 'Insurance' | 'Low-Cost Carrier' | 'Other' | 'Rail' | 'Specialty Service' | 'Tour' | 'Interface Record' | 'Unknown' | (string & {});

/** Identifies the trip type associated with the selected form of payment. */
export type BookingFormOfPaymentTripTypeEnum = 'All' | 'Corporate/Business' | 'Leisure' | 'Emergency' | 'Family' | 'Group' | 'Unknown' | (string & {});

/** Identifies the type of the room extra. */
export type BookingRoomExtrasNameEnum = 'Unknown' | 'Crib' | 'Roll-away Bed' | 'Extra Person' | (string & {});
