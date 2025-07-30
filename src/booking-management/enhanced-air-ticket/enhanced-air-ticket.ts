import { Sabre } from "../../sabre"
import { EnhancedAirTicketOptions, EnhancedAirTicketResponse } from "./interfaces"

export class EnhancedAirTicket {
  /**
   * Enhanced Air Ticket
   * 
   * The Enhanced Air Ticket API is used to issue one or multiple air tickets and/or 
   * EMDs (Electronic Miscellaneous Documents) within a single API call. 
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}
  /**
   * Procesa tickets proporcionando una solicitud que contiene una lista de números de ticket que se verificarán. 
   * 
   * payload - Contiene elementos obligatorios y opcionales para emitir los tickets.
   * @param payload EnhancedAirTicketOptions
   * @returns EnhancedAirTicketResponse 
   */
  async enhancedAirTicket(payload: EnhancedAirTicketOptions) {
    const path = '/v1.3.0/air/ticket'
    return this.sabre.post<EnhancedAirTicketResponse>(path, payload)
  }
}