import { Address, AncillarySourceEnum, DocumentTypeEnum, GenderEnum, LoyaltyProgram, Phone, ReasonForIssuanceEnum } from "../../common/interfaces"
/**
 * Identifica el tipo de Documento Misceláneo Electrónico (EMD) u otro documento que debe emitirse para el subcódigo seleccionado.
 *
 * example: FLIGHT_COUPON_ASSOCIATED
 */
const ELECTRONIC_MISCELLANEOUS_DOCUMENT_TYPE = {
  STANDALONE: "STANDALONE",
  FLIGHT_COUPON_ASSOCIATED: "FLIGHT_COUPON_ASSOCIATED",
  STANDALONE_TICKET_ASSOCIATED: "STANDALONE_TICKET_ASSOCIATED",
  OTHER_THAN_EMD: "OTHER_THAN_EMD",
  ETICKET: "ETICKET",
} as const
type ElectronicMiscellaneousDocumentTypeEnum = keyof typeof ELECTRONIC_MISCELLANEOUS_DOCUMENT_TYPE
/**
 * Contiene información del viajero. Se admiten varios viajeros cuando reserva pasando los detalles del vuelo.
 */
export interface BookTraveler {
  /**
   * Identificación del viajero del precio según lo devuelto por el precio de oferta.
   *
   * example: dx369rfr7jt8dnd2i0-1-1-1
   */
  id?: string
  /**
   * El nombre del viajero.
   *
   * example: John
   * pattern: ^[^\s]+(\s[^\s]+)*$
   */
  givenName?: string
  /**
   * El apellido del viajero.
   *
   * example: Smith
   * pattern: ^([^\s]+(\s[^\s]{1,})*){2,}$
   */
  surname?: string
  /**
   * Cumpleaños del viajero en formato `AAAA-MM-DD`. Si realiza una reserva que incluye pasajeros bebés, debe proporcionar su fecha de nacimiento, ya que se utiliza para enviar la notificación de bebés a la aerolínea (INFT SSR).
   *
   * format: date
   * example: 1970-01-23
   */
  birthDate?: string
  /**
   * La edad del viajero/huésped. Aplica sólo para reservas de hotel. Es obligatorio superar la edad de los niños viajeros/huéspedes al reservar una habitación de hotel.
   *
   * format: int32
   * minimum: 1
   * maximum: 120
   * example: 20
   */
  age?: number
  /**
   * Identifica el tipo (edad) del viajero. Para reservar un vuelo que incluya pasajeros infantiles, pase `INF`. Pase "INY" para indicar un bebé sin asiento asignado, o pase "INS" para indicar un bebé con asiento. Se utiliza para reservas de vuelos y hoteles respectivamente.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: ADT
   */
  passengerCode?: string
  /**
   * Contiene detalles de documentos de identidad (como pasaporte o SFPD).
   */
  identityDocuments?: BookIdentityDocument[]
  /**
   * Contiene detalles del programa de fidelización del pasajero, como una tarjeta de viajero frecuente.
   */
  loyaltyPrograms?: LoyaltyProgram[]
  /**
   * Enumera todas las direcciones de correo electrónico asociadas con el viajero.
   */
  /**
   * La dirección de correo electrónico del viajero.
   *
   * format: email
   * example: john@smith.family.priv
   */
  emails?: string[]
  /**
   * Enumera todos los números de teléfono asociados con el viajero.
   */
  phones?: Phone[]
  /**
   * Contiene mensajes de solicitud de servicio especial (SSR) enviados a una aerolínea. Los mensajes pueden contener preferencias del viajero o información obligatoria/opcional dirigida a la aerolínea.
   */
  specialServices?: BookSpecialService[]
  /**
   * Enumera los detalles de los servicios auxiliares que se reservarán.
   */
  ancillaries?: BookAncillary[]
}
/**
 * Contiene detalles de documentos de identidad (como pasaporte o SFPD).
 */
interface BookIdentityDocument {
  /**
   * El identificador único del documento.
   *
   * pattern: ^[a-zA-Z0-9]+$
   * example: 0123456789
   */
  documentNumber?: string
  /**
   * Identifica el tipo de documento de pasajero.
   */
  documentType: DocumentTypeEnum
  /**
   * La fecha de vencimiento del documento de identidad en formato `AAAA-MM-DD`.
   *
   * format: date
   * example: 2024-07-09
   */
  expiryDate?: string
  /**
   * El país que expide el documento de pasajero proporciona un código ISO 3166 de dos o tres letras. No aplicable al tipo de documento 'VISA'.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  issuingCountryCode?: string
  /**
   * El país en el que reside el pasajero o su país de nacionalidad se proporciona como un código ISO 3166 de dos o tres letras. Para reservas NDC, solo se permiten códigos de dos letras.
   *
   * example: US
   */
  residenceCountryCode?: string
  /**
   * El código ISO 3166 del país en el que se emitió el documento "VISA". Se utiliza con el tipo de documento "VISA".
   *
   * pattern: ^[A-Z]{2,3}$
   * example: FR
   */
  placeOfIssue?: string
  /**
   * El lugar de nacimiento del pasajero. Se utiliza principalmente con el tipo de documento `VISA`.
   *
   * maxLength: 35
   * example: LYON FR
   */
  placeOfBirth?: string
  /**
   * El código de país ISO 3166 donde el documento es válido. Se utiliza con el tipo de documento 'VISA'.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  hostCountryCode?: string
  /**
   * La fecha de emisión del documento de identidad en formato `AAAA-MM-DD`. Esto se utiliza principalmente para el tipo de documento "visa".
   *
   * format: date
   * example: 2019-07-09
   */
  issueDate?: string
  /**
   * El nombre del viajero.
   *
   * example: John
   */
  givenName?: string
  /**
   * El segundo nombre del viajero (no se admite NDC).
   *
   * example: Jack
   */
  middleName?: string
  /**
   * El apellido del viajero.
   *
   * example: Smith
   */
  surname?: string
  /**
   * La fecha de nacimiento del viajero en formato `AAAA-MM-DD`.
   *
   * format: date
   * example: 1980-12-02
   */
  birthDate?: string
  /**
   * Identifica el género del viajero.
   */
  gender?: GenderEnum
  /**
   * Si es "verdadero", indica el titular principal del pasaporte de un documento emitido para varios viajeros.
   *
   * example: True
   */
  isPrimaryDocumentHolder?: boolean
  /**
   * Si es "verdadero", el documento de identidad se aplica a un niño de regazo. Solo se puede combinar con los siguientes tipos de documentos: `VISA`, `KNOWN_TRAVELER_NUMBER`, `REDRESS_NUMBER`, `RESIDENCE_ADDRESS` y `DESTINATION_ADDRESS`.
   *
   * example: True
   */
  isLapChildDocument?: boolean
  /**
   * La dirección de residencia o destino del viajero.
   */
  residenceOrDestinationAddress?: Address
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
}
/**
 * Contiene el mensaje de solicitud de servicio especial (SSR) enviado a una aerolínea. El mensaje puede contener preferencias del viajero o información obligatoria/opcional dirigida a la aerolínea.
 */
interface BookSpecialService {
  /**
   * Define la categoría de la solicitud de servicio especial enviada a la aerolínea. Visite el sitio web oficial de IATA para obtener la lista de referencias de códigos SSR actualmente admitidos. Es posible que falten algunos códigos específicos de aerolíneas en estos recursos de IATA.
   *
   * pattern: ^[A-Z]{4}$
   * example: XBAG
   */
  code: string
  /**
   * El texto del servicio especial. Algunos de los tipos de servicios especiales requieren una descripción adicional, que es obligatoria para distinguir las características del producto por parte de la aerolínea.
   *
   * example: PREPAID
   */
  message?: string
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
}
/**
 * Contiene detalles de un servicio auxiliar particular que se reservará.
 */
interface BookAncillary {
  /**
   * El nombre comercial del servicio auxiliar.
   *
   * example: 1ST ADDITIONAL BAG
   */
  commercialName?: string
  /**
   * Especifica el motivo de la emisión que se corresponde con el código definido por IATA (RFIC) aplicable al Documento misceláneo electrónico (EMD) que se emitirá para el subcódigo identificado en este registro.
   */
  reasonForIssuance?: ReasonForIssuanceEnum
  /**
   * El subcódigo de emisión ("RFISC") es un código definido por la industria o por la aerolínea que identifica un tipo específico de servicio. Los subcódigos definidos por la industria están disponibles para que los utilicen todas las aerolíneas, tienen definiciones estándar y son mantenidos por [ATPCO](https://www.atpco.net/sites/atpco-public/files/all_pdfs/Opt_Scvs_Industry_Sub_Codes_Online_C.pdf). Los subcódigos definidos por aerolíneas están disponibles solo para aerolíneas específicas y los define y mantiene la aerolínea que utiliza el código.
   *
   * pattern: ^[A-Z0-9]{3}$
   * example: 05Z
   */
  subcode: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea que brinda el servicio.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode: string
  /**
   * El proveedor que proporciona el servicio auxiliar.
   */
  source?: AncillarySourceEnum
  /**
   * Identifica el tipo de Documento Misceláneo Electrónico (EMD) u otro documento que debe emitirse para el subcódigo seleccionado.
   */
  electronicMiscellaneousDocumentType: ElectronicMiscellaneousDocumentTypeEnum
  /**
   * Contiene el precio total del servicio auxiliar después de impuestos.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 150.00
   */
  totalPrice?: string
  /**
   * Contiene el costo base del servicio auxiliar.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  basePrice: string
  /**
   * El código de moneda ISO-4217 de tres letras.
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode: string
  /**
   * La cantidad de artículos auxiliares a reservar.
   *
   * format: int32
   * minimum: 1
   * default: 1
   * example: 1
   */
  numberOfItems?: number
  /**
   * La primera fecha de viaje en el formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) aplicable para el auxiliar seleccionado, obtenido de ATPCO. Junto con la última fecha de viaje, esto determina el período de solicitud de viaje.
   *
   * format: date
   * example: 1980-01-01
   */
  firstTravelDate?: string
  /**
   * La última fecha de viaje en el formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) permitido para el auxiliar seleccionado, obtenida de ATPCO. Junto con la fecha del primer viaje, esto determina el período de aplicación del viaje.
   *
   * format: date
   * example: 9999-12-31
   */
  lastTravelDate?: string
  /**
   * La última fecha en el formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html) antes de la cual se puede comprar el auxiliar seleccionado.
   *
   * format: date-time
   * example: 2020-07-07T16:00:00Z
   */
  purchaseDateTime?: string
  /**
   * El tipo de servicio auxiliar de dos letras según el estándar IATA. Consulte los recursos de [ATPCO](https://www.atpco.net/sites/atpco-public/files/all_pdfs/Opt_Scvs_Industry_Sub_Codes_Online_C.pdf) para obtener información sobre los códigos de grupo definidos por la industria disponibles.
   *
   * pattern: ^[A-Z]{2}$
   * example: BG
   */
  groupCode: string
  /**
   * Enumera los índices de vuelos dentro de una reserva.
   *
   * minItems: 1
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices: number[]
}