import { Sabre } from "../sabre"
import {
  CheckTicketsOptions,
  CheckTicketsResponseSuccess,
  FulfillTicketsOptions,
  FulfillTicketsResponseSuccess,
  RefundTicketsOptions,
  RefundTicketsResponseSuccess,
  VoidTicketsOptions,
  VoidTicketsResponseSuccess,
} from "./interfaces"

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
   * @returns {Promise<VoidTicketsResponseSuccess>}
   */
  async void(payload: VoidTicketsOptions): Promise<VoidTicketsResponseSuccess> {
    const path = '/v1/trip/orders/voidFlightTickets'
    return this.sabre.post<VoidTicketsResponseSuccess>(path, payload)
  }

  /**
   * Procesa los boletos proporcionando una solicitud que contiene una lista de números de boletos que deben reembolsarse. 
   * Actualmente, los EMD no son compatibles.
   * 
   * payload - Contiene elementos obligatorios y opcionales para el reembolso de los billetes.
   * @param payload RefundTicketsOptions
   * @returns {Promise<RefundTicketsResponseSuccess>}
   */
  async refund(payload: RefundTicketsOptions): Promise<RefundTicketsResponseSuccess> {
    const path = '/v1/trip/orders/refundFlightTickets'
    return this.sabre.post<RefundTicketsResponseSuccess>(path, payload)
  }
  
  /**
   * Procesa tickets proporcionando una solicitud que contiene una lista de números de ticket que se verificarán. 
   * Actualmente, los EMD no son compatibles.
   * 
   * payload - Contiene elementos obligatorios y opcionales para consultar los tickets.
   * @param payload CheckTicketsOptions
   * @returns {Promise<CheckTicketsResponseSuccess>} CheckTicketsResponse
   */
  async check(payload: CheckTicketsOptions): Promise<CheckTicketsResponseSuccess> {
    const path = '/v1/trip/orders/checkFlightTickets'
    return this.sabre.post<CheckTicketsResponseSuccess>(path, payload)
  }

  /**
   * Procesa la emisión de billetes y documentos varios electrónicos (EMD).
   * Actualmente, los EMD no son compatibles.
   * 
   * payload - Contiene elementos obligatorios y opcionales para la emisión de billetes.
   * @param payload FulfillTicketsOptions
   * @returns {Promise<FulfillTicketsResponseSuccess>}
   */
  async fulfill(payload: FulfillTicketsOptions): Promise<FulfillTicketsResponseSuccess> {
    const path = '/v1/trip/orders/fulfillFlightTickets'
    return this.sabre.post<FulfillTicketsResponseSuccess>(path, payload)
  }
}