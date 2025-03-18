/**
 * Contiene información sobre la ubicación de alquiler de coches.
 */
export interface CarRentalSite {
  /**
   * El ID de la oficina de alquiler de coches. No se puede combinar con otros calificadores relacionados con la dirección.
   *
   * example: ABC123
   */
  id?: string
  /**
   * El nombre de la oficina de alquiler de coches.
   *
   * example: TEST LOCATION
   */
  name?: string
  /**
   * El número de teléfono de la oficina de alquiler de automóviles involucrada en la recogida o entrega del vehículo.
   *
   * pattern: ^[0-9]{1,22}$
   * example: 8175551212
   */
  phone?: string
}