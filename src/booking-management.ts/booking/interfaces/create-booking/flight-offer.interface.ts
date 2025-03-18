/**
 * Contiene campos obligatorios y opcionales necesarios para realizar una reserva aérea NDC.
 */
export interface FlightOffer {
  /**
   * El identificador único de la Oferta seleccionada (ya sea una Oferta estándar o una Oferta a la carta) devuelto en una respuesta de compra.
   *
   * minLength: 2
   * maxLength: 49
   * example: dx369rfr7jt8dnd2i0-1
   */
  offerId: string
  /**
   * La lista `offerItem` seleccionada por un viajero específico.
   *
   * minItems: 1
   * maxItems: 9
   */
  /**
   * El `offerItem` seleccionado por un viajero específico.
   *
   * example: dx369rfr7jt8dnd2i0-1-1
   */
  selectedOfferItems: string[]
}