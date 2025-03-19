/**
 * Contiene información de contacto para la reserva.
 */
export interface ContactInformation {
  /**
   * Enumera las direcciones de correo electrónico de los viajeros o proveedores.
   */
  /**
   * Las direcciones de correo electrónico de los viajeros.
   *
   * format: email
   * example: travel@sabre.com
   */
  emails?: string[]
  /**
   * Enumera los números de teléfono formateados de los viajeros o proveedores.
   */
  /**
   * Los números de teléfono formateados de los viajeros.
   *
   * pattern: ^[0-9+-]+$
   * example: +1-555-123-4567
   */
  phones?: string[]
  /**
   * Enumera los números de fax formateados de los viajeros o proveedores.
   */
  faxes?: string[]
  /**
   * Los números de teléfono formateados de los contactos de emergencia de los proveedores.
   */
  /**
   * Los números de teléfono formateados de los contactos.
   *
   * pattern: ^[0-9+-]+$
   * example: +1-555-123-4567
   */
  emergencyPhones?: string[]
}