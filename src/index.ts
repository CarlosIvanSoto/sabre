export const VERSION = '0.6.0';

export { Sabre } from './sabre.js';
export { SabreLegacy } from './sabre-legacy.js';
export { buildCredentials } from './auth/credentials.js';
export type {
  BuildCredentialsOptions,
  BuildCredentialsOptionsV2,
  BuildCredentialsOptionsV3,
  BuiltCredentialsV2,
  BuiltCredentialsV3,
} from './auth/credentials.js';
export type { OpenSessionOptions, SabreSession } from './session/session.js';
export type { SabreCommandOptions, SabreCommandResponse } from './session/command.js';
export type {
  QueueManagement,
  QueueProcessAction,
  QueueProcessRequest,
  QueueProcessResult,
  QueueState,
} from './queue/queue-management.js';
export type {
  QueueAccessOptions,
  QueueAccessRequest,
  QueueEndReason,
  QueueItem,
  QueueMessage,
  QueueNavigationOptions,
  QueueRemoveRequest,
  QueueRemoveTarget,
  QueueSelection,
  QueueStep,
} from './queue/queue-access.js';
export type {
  QueuePlacement,
  QueuePlaceOptions,
  QueuePlaceRequest,
  QueuePlaceResponse,
  QueuePlaceResult,
  QueuePlaceTarget,
} from './queue/queue-place.js';
export type { QueueListEntry, QueueListOptions, QueueListRequest, QueueListResponse } from './queue/queue-list.js';
export { isMessageQueue, MESSAGE_QUEUE } from './queue/queue-ref.js';
export type { QueueRange, QueueRef } from './queue/queue-ref.js';
export type { QueueAdditionalInfo, QueueCount, QueueCountOptions, QueueCountRequest, QueueCountResponse } from './queue/queue-count.js';
export type { SessionReservation } from './reservation/session-reservation.js';
export type { SessionReporting } from './reporting/session-reporting.js';
export type {
  DailySalesDocumentType,
  DailySalesPaymentDetail,
  DailySalesPayments,
  DailySalesSettlementType,
  DailySalesSummaryOptions,
  DailySalesSummaryRequest,
  DailySalesSummaryResult,
  DailySalesTotal,
  DailySalesTransaction,
} from './reporting/daily-sales-summary.js';
export type {
  ReservationHistoryAccounting,
  ReservationHistoryFlightSegment,
  ReservationHistoryOptions,
  ReservationHistoryResponse,
  ReservationHistoryText,
  ReservationHistoryTransaction,
} from './reservation/reservation-history.js';
export type {
  QueueActivity,
  QueueActivityCounters,
  QueueActivityOptions,
  QueueActivityRequest,
  QueueActivityResponse,
} from './queue/queue-activity.js';
export { resolveHostDate } from './queue/host-date.js';
export type { HostDateDirection, ResolveHostDateOptions } from './queue/host-date.js';
export { parseQueueParagraph } from './queue/queue-paragraph.js';
export { parseQueuePlaceRemark } from './queue/queue-place-remark.js';
export type { QueuePlaceRemark } from './queue/queue-place-remark.js';
export type {
  QueueParagraph,
  QueueParagraphAirSegment,
  QueueParagraphMessage,
  QueueParagraphOptions,
  QueueParagraphOtherSegment,
  QueueParagraphPassenger,
  QueueParagraphReceivedFrom,
  QueueParagraphSegment,
  QueueParagraphTicketing,
  QueueParagraphTicketingEntry,
} from './queue/queue-paragraph.js';
export type { Air } from './air/air.js';
export type {
  BargainFinderMaxRequest,
  BargainFinderMaxResponse,
  RequestOptions,
} from './air/bargain-finder-max.js';
export type {
  GetSeatsRequest,
  GetSeatsResponse,
  RawSeatAvailabilityRs,
  Seat,
  SeatAvailabilityByPayloadRq,
  SeatAvailabilityByPnrLocatorRq,
  SeatAvailabilityIssue,
  SeatAvailabilityResponse,
  SeatCabinCompartment,
  SeatCabinFacility,
  SeatCabinAisle,
  SeatCabinLayout,
  SeatCabinRowPosition,
  SeatCharacteristic,
  SeatDisplayOnlyItem,
  SeatFareComponent,
  SeatFareDetail,
  SeatFareSegmentAssociation,
  SeatFlightLeg,
  SeatKeyValuePair,
  SeatLoyaltyProgramAccount,
  SeatMap,
  SeatOfferItem,
  SeatOfferItemDetails,
  SeatPassenger,
  SeatPassengerPayloadRq,
  SeatPassengerRs,
  SeatPriceBreakdown,
  SeatPriceDefinition,
  SeatRow,
  SeatSegment,
  SeatSegmentPayloadRq,
  SeatSegmentRs,
  SeatServiceDefinition,
  SeatSpecialServiceRequest,
  SeatTax,
} from './air/get-seats.js';
export { buildSeatAvailabilityRequest } from './air/seat-availability-request.js';
export type { SeatAvailabilityRequestSource } from './air/seat-availability-request.js';
export { buildRevalidateItineraryRequest } from './air/revalidate-itinerary.js';
export type {
  RevalidateItineraryRequest,
  RevalidateItineraryRequestSource,
  RevalidateItineraryResponse,
} from './air/revalidate-itinerary.js';
export type {
  LowFareSearchFlight,
  LowFareSearchLocation,
  LowFareSearchOriginDestination,
  LowFareSearchPassengerTypeQuantity,
  LowFareSearchRequestorId,
  LowFareSearchSource,
  LowFareSearchTpaExtensions,
  LowFareSearchTravelerInfoSummary,
  LowFareSearchTravelPreferences,
  OtaAirLowFareSearchRq,
} from './air/low-fare-search-request.js';
export type { SabreTokenStore, StoredToken } from './auth/token-store.js';
export type { BookingManagement } from './booking/booking-management.js';
export type { TicketsManagement } from './tickets/tickets-management.js';
export type {
  FulfilledTicket,
  FulfillErrorPolicy,
  FulfillFormOfPayment,
  FulfillFormOfPaymentType,
  FulfillmentDetails,
  FulfillPayment,
  FulfillPrinterAddress,
  FulfillTicketingQualifiers,
  FulfillTicketsOptions,
  FulfillTicketsRequest,
  FulfillTicketsResponse,
  PriceQuoteHandlingMethod,
  RawFulfillTicketsResponse,
} from './tickets/fulfill-tickets.js';
export type { VerifiedTicket, VerifyTicketsOptions, VerifyTicketsRequest, VerifyTicketsResponse } from './tickets/verify-tickets.js';
export type {
  Booking,
  CreateBookingOptions,
  CreateBookingResponse,
  CreateBookingResponseError,
} from './booking/create-booking.js';
export type {
  BookContactInformation,
  BookGenericSeat,
  BookingAgency,
  BookSeat,
  BookTraveler,
  BrandedFare,
  CreateBookingErrorPolicy,
  CreateBookingRequest,
  FlightDetails,
  FlightStatusCode,
  FlightToBook,
  PassengerPricing,
  PaymentMethod,
  PriceComparison,
  PriceComparisonType,
  PricingDetails,
  PricingQualifiers,
  SeatAreaPreference,
  SpecificFare,
  TicketingPolicy,
  TravelerPhone,
  TravelerTitle,
} from './booking/create-booking-request.js';
export type {
  BookingSource,
  GetBookingExtraFeatures,
  GetBookingOptions,
  GetBookingRequest,
  GetBookingResponse,
  GetBookingReturnOnly,
} from './booking/get-booking.js';
export type {
  BookingItemReference,
  CancelBookingErrorPolicy,
  CancelBookingNotification,
  CancelBookingOptions,
  CancelBookingRequest,
  CancelBookingResponse,
  CancelSegmentReference,
  FlightTicketOperation,
  RefundDocumentsType,
} from './booking/cancel-booking.js';
export type { BookingResponseError } from './booking/booking-errors.js';
export { buildBookingFlightDetails } from './booking/flight-details.js';
export type { BookingFlightDetailsSource, BookingSeatSelection, PricedSeat } from './booking/flight-details.js';
export type {
  SabreAuthVersion,
  SabreConfig,
  SabreConfigV2,
  SabreConfigFromCredentials,
  SabreConfigV2FromCredentials,
  SabreConfigV3,
  SabreCredentials,
  SabreCredentialsAnyVersion,
  SabreCredentialsV2,
  SabreEnvironment,
} from './config.js';
export type { RetryOptions } from './http/retry.js';
export type { SabreRawRequest, SabreRawRequestCallback } from './http/raw-request.js';
export type { SabreRawResponse, SabreRawResponseCallback } from './http/raw-response.js';
export * from './errors/index.js';
export * from './logging/index.js';
export type {
  BaggageAllowanceDesc,
  BaggageInformation,
  CurrencyConversion,
  Fare,
  FareComponent,
  FareComponentDesc,
  FareComponentDescSegment,
  FareComponentSegment,
  FareComponentSegmentDetail,
  FareMessage,
  GroupedItineraryResponse,
  Itinerary,
  ItineraryGroup,
  ItineraryMessage,
  Leg,
  LegDesc,
  LegSchedule,
  LegScheduleRef,
  LegDescription,
  ObFeeDesc,
  PassengerInfo,
  PassengerTotalFare,
  PricingInformation,
  Ref,
  ScheduleCarrier,
  ScheduleDesc,
  ScheduleEndpoint,
  ScheduleEquipment,
  TaxDesc,
  TaxSummaryDesc,
  TotalFare,
  ValidatingCarrierDesc,
} from './air/grouped-itinerary.js';
// Tipos completos de `Booking` (spec v1.33, #158).
export type * from './booking/booking-types.js';
