import { TotalValues } from "../../../common/interfaces";
import type { Remark, GenericAddress, Address, FlightReference, DocumentTypeEnum, GenderEnum, LoyaltyProgram, Phone, ReasonForIssuanceEnum, AncillarySourceEnum } from '../../common/interfaces'
/**
 * Identifica el tipo de viajero.
 *
 * example: ADULT
 */
const TRAVELER_TYPE = {
  ADULT: 'ADULT',
  AGENT: 'AGENT',
  AIRLINE: 'AIRLINE',
  CHILD: 'CHILD',
  EDUCATION: 'EDUCATION',
  GOVERNMENT: 'GOVERNMENT',
  GROUP: 'GROUP',
  INFANT: 'INFANT',
  MILITARY: 'MILITARY',
  SENIOR: 'SENIOR',
  SPECIAL: 'SPECIAL',
  YOUTH: 'YOUTH',
} as const

type TravelerTypeEnum = keyof typeof TRAVELER_TYPE;
/**
 * Contiene información del viajero.
 */
export interface Traveler {
  /**
   * El nombre del viajero.
   *
   * example: John
   */
  givenName: string
  /**
   * El segundo nombre o la inicial del segundo nombre del viajero.
   *
   * example: W
   */
  middleName?: string
  /**
   * El apellido del viajero.
   *
   * example: Smith
   */
  surname: string
  /**
   * La fecha de nacimiento del viajero en formato `AAAA-MM-DD`.
   *
   * format: date
   * example: 1970-01-23
   */
  birthDate?: string
  /**
   * Identifica el tipo de viajero.
   */
  type?: TravelerTypeEnum
  /**
   * El código ATPCO del tipo de pasajero utilizado para fijar precios, emisión de billetes o reglas de tarifas de vuelos reservados.
   *
   * pattern: ^[A-Z][A-Z0-9]{2}$
   * example: ADT
   */
  passengerCode?: string
  /**
   * Si es 'verdadero', el viajero está asociado a una reserva de grupo.
   *
   * example: True
   */
  isGrouped?: boolean
  /**
   * Enumera todas las direcciones de correo electrónico del viajero.
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
   * Enumera todos los comentarios asociados con el viajero.
   */
  remarks?: Remark[]
  /**
   * La dirección del viajero.
   */
  address?: GenericAddress
  /**
   * Enumera los documentos de identidad aplicables a un viajero.
   */
  /**
   * Contiene detalles de un documento de identidad.
   */
  identityDocuments?: IdentityDocument[]
  /**
   * Enumera los programas de fidelización aplicables a un viajero.
   */
  /**
   * Contiene detalles del programa de finalización del pasajero, como una tarjeta de viajero frecuente.
   */
  loyaltyPrograms?: LoyaltyProgram[]
  /**
   * Enumera los detalles de los servicios auxiliares.
   */
  ancillaries?: Ancillary[]
}
/**
 * Contiene detalles de un documento de identidad.
 */
interface IdentityDocument {
  /**
   * El identificador único del documento.
   *
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
   * El país que expide el documento de pasajero proporciona un código ISO 3166 de dos o tres letras.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  issuingCountryCode?: string
  /**
   * El país en el que reside el pasajero o su país de nacionalidad se proporciona como un código ISO 3166 de dos o tres letras.
   *
   * pattern: ^[A-Z]{2,3}$
   * example: US
   */
  residenceCountryCode?: string
  /**
   * El nombre del lugar donde se emitió el documento.
   *
   * example: ROME
   */
  placeOfIssue?: string
  /**
   * Lugar de nacimiento del pasajero, totalmente detallado. Esto se utiliza principalmente para el tipo de documento "VISA".
   *
   * example: KOSZALIN
   */
  placeOfBirth?: string
  /**
   * El código de país ISO 3166 de dos o tres letras donde el documento es válido. Esto se utiliza principalmente para el tipo de documento "VISA".
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
   * El segundo nombre del viajero. (NDC no compatible).
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
   * Si es "verdadero", el documento de identidad se aplica a un niño de regazo.
   *
   * example: True
   */
  isLapChildDocument?: boolean
  /**
   * Dirección de residencia o destino del viajero.
   */
  residenceDestinationAddress?: Address
  /**
   * Enumera los índices de vuelos dentro de una reserva. Esta propiedad quedará obsoleta en la futura versión principal de esta API. Si desea enumerar los documentos asociados con el vuelo, utilice la propiedad "identityDocuments" dentro del objeto "Vuelo".
   */
  /**
   * Número de índice del vuelo.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  flightIndices?: number[]
  /**
   * El identificador único del documento.
   *
   * example: 76c2817b178cc264fa44cf85df1da5fb9e1b963006b2339aa5edc09129415bba5fcf5bf91a5f3031
   */
  itemId?: string
}
/**
 * Identifica el tipo de restricción de tarifa.
 *
 * example: Single
 */
const FLIGHT_APPLICABILITY_TYPE = {
  Single: "Single",
  Multiple: "Multiple",
  Unknown: "Unknown",
} as const

type FlightApplicabilityTypeEnum = keyof typeof FLIGHT_APPLICABILITY_TYPE;
/**
 * Identifica el valor significativo que describe el estado auxiliar.
 *
 * example: Confirmed
 */
enum AncillaryStatusNameEnum {
  Confirmed,
  'Confirmed with EMD issued',
  'On Request',
  Pending,
  Cancelled,
  Unconfirmed,
  'Confirmed with pending payment',
  'Schedule change'
}
/**
 * Contiene los detalles de un auxiliar.
 */
interface Ancillary {
  /**
   * The ID of an ancillary item.
   *
   * example: 12
   */
  itemId?: string
  /**
   * El nombre comercial del auxiliar.
   *
   * example: UPTO33LB 15KG BAGGAGE
   */
  commercialName?: string
  /**
   * Cantidad de artículos auxiliares.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  numberOfItems?: number
  /**
   * El código de motivo de emisión (RFIC) definido por IATA.
   *
   * example: C
   */
  reasonForIssuanceCode?: string
  /**
   * Contiene el código de motivo de emisión (RFIC) definido por IATA aplicable al Documento misceláneo electrónico (EMD) que se emitirá para el subcódigo identificado en este registro.
   */
  reasonForIssuanceName?: ReasonForIssuanceEnum
  /**
   * El subcódigo de emisión ("RFISC") es un código definido por la industria o por la aerolínea que identifica un tipo específico de servicio. Los subcódigos definidos por la industria están disponibles para que los utilicen todas las aerolíneas, tienen definiciones estándar y son mantenidos por [ATPCO](https://www.atpco.net/sites/atpco-public/files/all_pdfs/Opt_Scvs_Industry_Sub_Codes_Online_C.pdf). Los subcódigos definidos por aerolíneas están disponibles solo para aerolíneas específicas y los define y mantiene la aerolínea que utiliza el código.
   *
   * pattern: ^[A-Z0-9]{3}$
   * example: 05Z
   */
  subcode?: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea que brinda el servicio.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: EY
   */
  airlineCode?: string
  /**
   * El proveedor que proporciona el servicio auxiliar.
   */
  source?: AncillarySourceEnum
  /**
   * El número del documento electrónico.
   *
   * pattern: ^[0-9A-Z/-]+$
   * example: 6074333222111
   */
  electronicMiscellaneousDocumentNumber?: string
  /**
   * Si es cierto, el auxiliar es reembolsable.
   *
   * example: True
   */
  isRefundable?: boolean
  /**
   * De ser cierto, el auxiliar tiene una comisión incluida.
   *
   * example: False
   */
  isCommissionable?: boolean
  /**
   * Identifies the applicability of the ancillary item to the flights in the booking. 
   * Can be Single (an ancillary item applies to a single flight/sector of the booking), 
   * Multiple (an ancillary item applies to the portion of flights in the booking), 
   * or Unknown (applicability of the ancillary cannot be determined). 
   * This information is required when electronicMiscellaneousDocumentType has the value OTHER_THAN_EMD.
   * 
   * default: Unknown
   */
  flightApplicabilityType?:	FlightApplicabilityTypeEnum
  /**
   * Enumera los vuelos a los que hace referencia el vuelo "itemId". Se pueden devolver varios ID de vuelo para un solo artículo auxiliar.
   */
  flights?: FlightReference[]
  /**
   * El código de estado de dos letras utilizado por los proveedores. Indica el estado de la reserva.
   *
   * pattern: ^[A-Z]{2}$
   * example: HD
   */
  statusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva.
   */
  statusName?: AncillaryStatusNameEnum
  /**
   * Contiene información de pago del servicio.
   */
  totals?: TotalValues
}
