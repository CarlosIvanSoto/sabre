import { Sabre } from "../../sabre"
import { CancelBookingOptions, CancelBookingResponseSuccess, CreateBookingOptions, CreateBookingResponseSuccess, GetBookingOptions, GetBookingResponseSuccess, ModifyBookingOptions, ModifyBookingResponseSuccess } from "./interfaces"

export class Booking {
  /**
   * Booking
   * 
   * La API de reservas está diseñada para proporcionar una vista normalizada de una reserva de Sabre combinando el PNR de Sabre y el pedido de Sabre.
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}
  /**
   * Crea una lista de elementos de reserva que deben cancelarse.
   * 
   * @param pnr El ID de referencia de la reserva como se muestra en el sistema de proveedor/vendedor de origen. Para "SABRE", este es el valor del localizador de PNR.
   * @returns Booking 
   */
  async getBookingByPnr(pnr: string) {
    return this.getBooking({
      confirmationId: pnr,
      returnOnly: [],
      unmaskPaymentCardNumbers: true
    })
    // .then((res: GetBookingResponse) => {
    //   // SAVE FOR LOGS REQUEST ERRORs
    //   const {timestamp, bookingSignature, request, errors} = res
    //   const crashErrors = ['BOOKING_NOT_FOUND', 'INVALID_VALUE']
    //   if (errors?.some(e => crashErrors.includes(e.type))) throw new Error(errors[0].description)
    //   return res
    // })
  }
  /**
   * Crea una solicitud que contiene un "Id. de confirmación" para obtener información de la reserva.
   * 
   * @param pnr El ID de referencia de la reserva como se muestra en el sistema de proveedor/vendedor de origen. Para "SABRE", este es el valor del localizador de PNR.
   * @returns CancelBookingResponse
   */
  async cancelBookingByPnr(pnr: string) {
    return this.cancelBooking({ 
      confirmationId: pnr,
      retrieveBooking: false,
      cancelAll: true,
      errorHandlingPolicy: "ALLOW_PARTIAL_CANCEL"
    })
  }
  /**
   * Crea una lista de elementos de reserva que deben cancelarse.
   * 
   * payload - Contiene elementos obligatorios y opcionales para cancelar la totalidad o partes de una reserva.
   * @param payload CancelBookingOptions
   * @returns CancelBookingRequest
   */
  async cancelBooking(payload: CancelBookingOptions) {
    const path = '/v1/trip/orders/cancelBooking'
    return this.sabre.post<CancelBookingResponseSuccess>(path, payload)
  }
  /**
   * Crea una solicitud que contiene un "Id. de confirmación" y un "apellido" del viajero para obtener información de la reserva.
   * 
   * payload - Contiene elementos tanto obligatorios como opcionales para realizar una solicitud de reserva.
   * @param payload GetBookingOptions
   * @returns GetBookingResponse
   */
  async getBooking(payload: GetBookingOptions){
    const path = '/v1/trip/orders/getBooking'
    return this.sabre.post<GetBookingResponseSuccess>(path, payload)
  }
  /**
   * Crea una reserva aérea (NDC/ATPCO/LCC).
   * 
   * payload - Contiene elementos obligatorios y opcionales para realizar una solicitud de reserva.
   * @param payload CreateBookingOptions
   * @returns CreateBookingResponse
   */
  async createBooking(payload: CreateBookingOptions) {
    const path = '/v1/trip/orders/createBooking'
    return this.sabre.post<CreateBookingResponseSuccess>(path, payload)
  }
  /**
   * Crea una lista de elementos de reserva que deben modificarse.
   * 
   * payload - Contiene elementos obligatorios y opcionales para modificar datos no relacionados con el itinerario en la reserva existente. 
   * @param payload ModifyBookingOptions 
   * @returns ModifyBookingResponse
   */
  async modifyBooking(payload: ModifyBookingOptions) {
    const path = '/v1/trip/orders/modifyBooking'
    return this.sabre.post<ModifyBookingResponseSuccess>(path, payload)
  }

}