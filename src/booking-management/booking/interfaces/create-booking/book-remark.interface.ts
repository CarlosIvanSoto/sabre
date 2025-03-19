import { Queue, Remark } from "../../common/interfaces"
/**
 * Contiene el comentario que se añadirá a la reserva.
 */
export interface BookRemark extends Remark {
  /**
   * Contiene detalles de la cola para el tipo de comentario `QUEUE_PLACE`.
   */
  queuePlacement?: Queue
}