/**
 * Contiene campos obligatorios y opcionales necesarios para recuperar la información del perfil necesaria para completar una reserva.
 */
export interface Profile {
  /**
   * Contiene un nombre de perfil único. Se utiliza para mover el perfil a ciegas al AAA. No se puede combinar con domainId. Es necesario utilizar `profileName` o `domainId` para recuperar un perfil.
   *
   * example: TESTPROFILE
   */
  profileName?: string
  /**
   * Contiene un código de tipo de perfil único.
   *
   * example: TVL
   * maxLength: 3
   */
  profileTypeCode: string
  /**
   * El número de identificación de perfil único. Se utiliza para cegar el perfil de movimiento en AAA. No se puede combinar con `profileName`. Es necesario utilizar `profileName o `domainId` para recuperar un perfil.
   *
   * example: ABC123
   */
  uniqueId?: string
  /**
   * Generalmente este es el PCC del usuario. También podría ser un código de cliente específico.
   *
   * example: G7HE
   */
  domainId: string
  /**
   * Contiene un filtro de perfil único que permite recuperar un subconjunto predefinido de los datos del perfil.
   *
   * example: 112676753
   */
  filterId?: string
}