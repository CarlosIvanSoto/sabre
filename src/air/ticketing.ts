import { Sabre } from "../sabre"
import { EnhancedAirTicketOptions, EnhancedAirTicketResponseSuccess } from "./interfaces";

export class Ticketing {
  /**
   * Enhanced Air Ticket v1.3.0
   * 
   * La API de boletos aéreos mejorados se utiliza para emitir uno o varios boletos aéreos 
   * y/o EMD (documentos electrónicos varios) dentro de una sola llamada API.
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}

  /**
   * La API de boletos aéreos mejorados (AirTicketRQ) 
   * se utiliza para emitir boletos aéreos y documentos electrónicos varios (EMD) en una sola solicitud.
   * 
   * payload - Solicitud de API de boletos aéreos orquestada.
   * @param payload EnhancedAirTicketOptions 
   * @returns {Promise<EnhancedAirTicketResponseSuccess>}
   */
  async issue(payload: EnhancedAirTicketOptions): Promise<EnhancedAirTicketResponseSuccess> {
    const path = "/v1.3.0/air/ticket";
    return this.sabre.post<EnhancedAirTicketResponseSuccess>(path, payload)
  }
}