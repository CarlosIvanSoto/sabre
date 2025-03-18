/**
 * Contiene información sobre el grupo al que pertenecen los viajeros.
 */
export interface TravelersGroup {
  /**
   * Contiene el ID del grupo.
   *
   * pattern: ^[A-Z0-9]+$
   * example: 3
   */
  itemId?: string
  /**
   * El nombre del grupo.
   *
   * example: GROUP ONE
   */
  name?: string
  /**
   * El número total de viajeros dentro del grupo. Los bebés de regazo no se tienen en cuenta.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  numberOfTravelers?: number
  /**
   * El número de viajeros restantes dentro del grupo cuyos nombres no se proporcionan. Los bebés de regazo no se tienen en cuenta.
   *
   * format: int32
   * minimum: 0
   * example: 1
   */
  numberOfTravelersRemaining?: number
}