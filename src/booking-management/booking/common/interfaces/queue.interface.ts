/**
 * Contiene detalles de una cola.
 */
export interface Queue {
  /**
   * El número de cola.
   *
   * format: int32
   * minimum: 0
   * maximum: 999
   * example: 400
   */
  queueNumber?: number
  /**
   * El nombre de la cola.
   *
   * example: HENRY
   */
  queueName?: string
  /**
   * El pseudocódigo de ciudad.
   *
   * pattern: ^[A-Z0-9]{3,4}$
   * example: G7RE
   */
  pcc?: string
  /**
   * Los códigos de instrucción preliminar (PIC) de agencia programables que son exclusivos de su agencia. Un PIC hace que se muestre un mensaje en la parte superior de la reserva cuando un agente lo muestra en la cola. Este mensaje proporciona al agente información que explica por qué la reserva está en la cola o qué acción debe completarse según el número PIC que utilice.
   *
   * format: int32
   * minimum: 0
   * maximum: 191
   * example: 11
   */
  prefatoryInstructionCode: number
  /**
   * La fecha futura de colocación de la cola en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html). Solo se puede usar al pasar el tipo de comentario `QUEUE_PLACE` desde `RemarkTypeEnum`.
   *
   * format: date
   * example: 2019-07-09
   */
  futureQueuePlacementDate?: string
}