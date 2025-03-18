import { Address } from "./address.interface"

/**
 * Contiene información de dirección.
 */
export interface GenericAddress extends Address {
  /**
   * El nombre de la persona o de la empresa/organización.
   *
   * example: John Smith
   */
  name?: string
  /**
   * La dirección completa proporcionada como texto libre. Utilice esta representación de dirección alternativa cuando una dirección estructurada no esté disponible.
   *
   * example: John Smith
   * 1230 Ellen Ave, Apt 10
   * Dallas, TX 75063
   * US
   */
  freeText?: string
}
