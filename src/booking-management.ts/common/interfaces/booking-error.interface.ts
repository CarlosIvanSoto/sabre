/**
 * Contiene información de error.
 *
 * xml: {'name': 'error'}
 */
export interface BookingError {
  /**
   * La categoría del error.
   *
   * example: BAD_REQUEST
   */
  category: string
  /**
   * El tipo de error.
   *
   * example: REQUIRED_FIELD_MISSING
   */
  type: string
  /**
   * La descripción detallada del error.
   *
   * example: may not be null
   */
  description?: string
  /**
   * La ruta del campo de la solicitud si el error está relacionado con un campo de solicitud/respuesta específico.
   *
   * example: someObject.someFieldName
   */
  fieldPath?: string
  /**
   * El nombre del campo de la solicitud si el error está relacionado con un campo de solicitud/respuesta específico.
   *
   * example: someName
   */
  fieldName?: string
  /**
   * El valor del campo de la solicitud si el error está relacionado con un campo de solicitud/respuesta específico.
   *
   * example: field value
   */
  fieldValue?: string
}