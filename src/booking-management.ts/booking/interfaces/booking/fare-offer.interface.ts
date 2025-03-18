import { BaggageAllowance, BaggagePolicy, FlightReference } from "../../common/interfaces"

/**
 * Contiene una oferta complementaria para vuelos seleccionados identificados por referencias de vuelo "itemId" y para viajeros seleccionados identificados por índices en la lista de "viajeros".
 */
export interface FareOffer {
  /**
   * Indica a qué viajeros de la lista de `viajeros` pertenece la oferta complementaria. Si la oferta es válida para todos los viajeros, no se proporciona esta lista.
   */
  /**
   * El índice del viajero en la matriz "viajeros".
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndices?: number[]
  /**
   * Enumera los vuelos a los que hace referencia el vuelo "itemId". Si la oferta es válida para todos los vuelos, no se proporciona esta lista.
   */
  /**
   * Contiene la referencia del objeto de vuelo por "itemId".
   */
  flights?: FlightReference[]
  /**
   * Indica equipaje de mano permitido (de mano) incluido en el precio del billete.
   */
  cabinBaggageAllowance?: BaggageAllowance
  /**
   * Indica equipaje facturado permitido incluido en el precio del billete.
   */
  checkedBaggageAllowance?: BaggageAllowance
  /**
   * Enumera las políticas de equipaje de mano (de mano) y las tarifas de servicio.
   */
  /**
   * Contiene restricciones aplicadas sobre la cantidad de piezas de equipaje y tarifa opcional aplicable.
   */
  cabinBaggageCharges?: BaggagePolicy[]
  /**
   * Enumera las políticas de equipaje facturado y las tarifas de servicio.
   */
  /**
   * Contiene restricciones aplicadas sobre la cantidad de piezas de equipaje y tarifa opcional aplicable.
   */
  checkedBaggageCharges?: BaggagePolicy[]
}