/**
 * Contiene información sobre la impresora o el perfil de la impresora.
 */
export interface PrinterAddress {
  /**
   * El número de perfil de impresora que se designará.
   *
   * format: int32
   * example: 1
   */
  profileNumber?: number
  /**
   * Los detalles de la impresora impresa que se designarán.
   */
  hardcopy?: HardcopyPrinter
  /**
   * Los datos de la impresora de facturas e itinerarios que se designarán.
   *
   * pattern: ^[A-Z0-9]{6}$
   * example: AB12CD
   */
  invoiceItinerary?: string
  /**
   * Los datos del impresor de billetes a designar.
   */
  ticket?: TicketPrinter
}
/**
 * Contiene información sobre la impresora de copias impresas.
 */
interface HardcopyPrinter {
  /**
   * La imprenta LNIATA que se designe.
   *
   * pattern: ^[A-Z0-9]{6}$
   * example: EF34GH
   */
  address?: string
  /**
   * El espaciado de la impresora impresa que se aplicará.
   *
   * pattern: ^[1-2]{1}$
   * example: 1
   */
  spacing?: string
}
/**
 * Contiene información sobre la impresora de tickets.
 */
interface TicketPrinter {
  /**
   * La impresora de billetes LNIATA que se designe.
   *
   * pattern: ^[A-Z0-9]{6}$
   * example: EF34GH
   */
  address?: string
  /**
   * El código del país del stock de billetes que se aplicará.
   *
   * pattern: ^[A-Z1][A-Z1]$
   * example: RU
   */
  countryCode?: string
}