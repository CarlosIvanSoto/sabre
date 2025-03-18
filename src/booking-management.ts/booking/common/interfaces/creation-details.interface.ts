/**
 * Contiene detalles sobre la creación.
 */
export interface CreationDetails {
  /**
   * El seno del registro del perfil del empleado que creó la reserva. No compatible con reservas NDC.
   *
   * example: A12
   */
  creationUserSine?: string
  /**
   * La fecha en formato `AAAA-MM-DD` cuando se creó la reserva.
   *
   * format: date
   * example: 2021-01-09
   */
  creationDate?: string
  /**
   * La hora en formato `HH:MM` cuando se creó la reserva. No compatible con reservas NDC.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 15:00
   */
  creationTime?: string
  /**
   * La fecha en formato `AAAA-MM-DD` antes de la cual se debe emitir el billete de la tarifa almacenada.
   *
   * format: date
   * example: 2023-01-09
   */
  purchaseDeadlineDate?: string
  /**
   * La hora en formato `HH:MM` antes de la cual se debe emitir el billete de la tarifa almacenada.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 15:00
   */
  purchaseDeadlineTime?: string
  /**
   * Un identificador único acreditado por la Asociación de Transporte Aéreo Internacional (IATA).
   *
   * pattern: ^[0-9]{7,8}$
   * example: 99119911
   */
  agencyIataNumber?: string
  /**
   * El pseudocódigo de ciudad donde se creó la reserva.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: AB12
   */
  userWorkPcc?: string
  /**
   * El pseudocódigo de ciudad del agente que creó la reserva.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: CD34
   */
  userHomePcc?: string
  /**
   * El código de identificación del anfitrión principal (sistema de distribución global) asociado con la reserva.
   *
   * example: 1S
   */
  primeHostId?: string
}