/**
 * Contiene información básica de dirección.
 */
export interface Address {
  /**
   * El nombre de la calle y el número de la casa acompañados del número de apartamentos/unidad/suite, si corresponde.
   *
   * example: 1230 Ellen Ave, apt 10
   */
  street?: string
  /**
   * El nombre de la ciudad.
   *
   * example: Dallas
   */
  city?: string
  /**
   * El nombre o código del estado o provincia.
   *
   * example: TX
   */
  stateProvince?: string
  /**
   * El código postal o zip.
   *
   * example: 75063
   */
  postalCode?: string
  /**
   * El código de país de dos letras [ISO 3166](https://www.iso.org/iso-3166-country-codes.html).
   *
   * pattern: ^[A-Z]{2}$
   * example: US
   */
  countryCode?: string
}
