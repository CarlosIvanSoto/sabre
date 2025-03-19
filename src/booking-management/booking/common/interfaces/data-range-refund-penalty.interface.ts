import { Value } from "./value.interface"
/**
 * Contiene el rango de fechas hasta el cual se aplica una multa, incluido el costo total de la multa.
 */
export interface DateRangeRefundPenalty {
  /**
   * La fecha a partir de la cual la sanción comienza a ser aplicable, en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html).
   *
   * format: date-time
   * example: 2019-07-07T16:00:00Z
   */
  applicableFromDate?: string
  /**
   * La fecha en que finaliza la aplicabilidad de la sanción, en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html).
   *
   * format: date-time
   * example: 2019-07-09T16:00:00Z
   */
  applicableToDate?: string
  /**
   * Coste total de la sanción.
   */
  penalty: Value
}
