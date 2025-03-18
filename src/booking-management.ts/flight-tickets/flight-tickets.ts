import { Sabre } from "../../sabre"
import { VoidTicketsOptions, VoidTicketsResponseSuccess } from "./interfaces"
import { CheckTicketsOptions, CheckTicketsResponseSuccess } from "./interfaces/check-tickets.interface"
import { RefundTicketsOptions, RefundTicketsResponseSuccess } from "./interfaces/refund-tickets.interface"

export class FlightTickets {
  /**
   * Flight Tickets
   * 
   * Los endpoint de Flight Tickets son un conjunto de métodos diseñados para obtener detalles de los billetes y 
   * realizar operaciones específicas (anulación/reembolso) sobre ellos.
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}
  /**
   * Procesa tickets proporcionando una solicitud que contiene una lista de números de ticket que se anularán.
   * 
   * payload - Contiene elementos obligatorios y opcionales para anular los billetes.
   * @param payload VoidTicketsOptions
   * @returns VoidTicketsResponse
   */
  async voidTickets(payload: VoidTicketsOptions) {
    const path = '/v1/trip/orders/voidFlightTickets'
    return this.sabre.post<VoidTicketsResponseSuccess>(path, payload)
  }
  /**
   * Procesa los boletos proporcionando una solicitud que contiene una lista de números de boletos que deben reembolsarse. 
   * Actualmente, los EMD no son compatibles.
   * 
   * payload - Contiene elementos obligatorios y opcionales para el reembolso de los billetes.
   * @param payload RefundTicketsOptions
   * @returns RefundTicketsResponse
   */
  async refundTickets(payload: RefundTicketsOptions) {
    const path = '/v1/trip/orders/refundFlightTickets'
    return this.sabre.post<RefundTicketsResponseSuccess>(path, payload)
  }
  /**
   * Procesa tickets proporcionando una solicitud que contiene una lista de números de ticket que se verificarán. 
   * Actualmente, los EMD no son compatibles.
   * 
   * payload - Contiene elementos obligatorios y opcionales para consultar los tickets.
   * @param payload CheckTicketsOptions
   * @returns CheckTicketsResponse
   */
  async checkTickets(payload: CheckTicketsOptions) {
    const path = '/v1/trip/orders/checkFlightTickets'
    return this.sabre.post<CheckTicketsResponseSuccess>(path, payload)
  }
}