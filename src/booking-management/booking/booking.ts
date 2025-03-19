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
   * Crea una solicitud que contiene un "Id. de confirmación" y un "apellido" del viajero para obtener información de la reserva.
   * 
   * payload - Contiene elementos tanto obligatorios como opcionales para realizar una solicitud de reserva.
   * @param payload GetBookingOptions
   * @returns GetBookingResponse
   */
  async get(payload: GetBookingOptions){
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
  async create(payload: CreateBookingOptions) {
    const path = '/v1/trip/orders/createBooking'
    return this.sabre.post<CreateBookingResponseSuccess>(path, payload)
  }
  /**
   * Crea una lista de elementos de reserva que deben cancelarse.
   * 
   * payload - Contiene elementos obligatorios y opcionales para cancelar la totalidad o partes de una reserva.
   * @param payload CancelBookingOptions
   * @returns CancelBookingRequest
   */
  async cancel(payload: CancelBookingOptions) {
    const path = '/v1/trip/orders/cancelBooking'
    return this.sabre.post<CancelBookingResponseSuccess>(path, payload)
  }
  /**
   * Crea una lista de elementos de reserva que deben modificarse.
   * 
   * payload - Contiene elementos obligatorios y opcionales para modificar datos no relacionados con el itinerario en la reserva existente. 
   * @param payload ModifyBookingOptions 
   * @returns ModifyBookingResponse
   */
  async modify(payload: ModifyBookingOptions) {
    const path = '/v1/trip/orders/modifyBooking'
    return this.sabre.post<ModifyBookingResponseSuccess>(path, payload)
  }

}