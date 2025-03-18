/**
 * Identifica la política para el manejo de errores dentro del servicio Cancelar Reserva.
 *
 * example: HALT_ON_ERROR
 * default: HALT_ON_ERROR
 * xml: {'name': 'ErrorHandlingPolicy', 'attribute': True}
 */
const CANCEL_ERROR_POLICY = {
  HALT_ON_ERROR: 'HALT_ON_ERROR',
  ALLOW_PARTIAL_CANCEL: 'ALLOW_PARTIAL_CANCEL'
}
export type CancelErrorPolicyEnum = keyof typeof CANCEL_ERROR_POLICY