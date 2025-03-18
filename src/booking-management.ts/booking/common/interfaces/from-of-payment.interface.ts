import { Address } from "./address.interface"
import { GenericAddress } from "./generic-address.interface"
import { Value } from "./value.interface"
/**
 * Identifica el tipo de método de pago. 
 * El método de pago "VARIOS" debe activarse a nivel de agencia y 
 * requiere un código de crédito de pago específico. 
 * `PAGOS A CUOTAS` se utiliza únicamente para clientes de BSP Brasil y 
 * se refiere al pago mediante cuotas con tarjeta comúnmente denominadas "parcelado". 
 * `VIRTUAL_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE`, `COMPANY_NAME` se utilizan para reservas de hotel. 
 * `VOUCHER` se utiliza para reservas de vehículos.
 *
 * example: CHECK
 */
const FROM_OF_PAYMENT_TYPE = {
  PAYMENTCARD: "PAYMENTCARD",
  CASH: "CASH",
  CHECK: "CHECK",
  MISCELLANEOUS: "MISCELLANEOUS",
  INSTALLMENTS: "INSTALLMENTS",
  VIRTUAL_CARD: "VIRTUAL_CARD",
  AGENCY_NAME: "AGENCY_NAME",
  AGENCY_IATA: "AGENCY_IATA",
  CORPORATE: "CORPORATE",
  COMPANY_NAME: "COMPANY_NAME",
  VOUCHER: "VOUCHER",
} as const

type FormOfPaymentTypeEnum = keyof typeof FROM_OF_PAYMENT_TYPE
/**
 * Contiene detalles de una forma de pago.
 */
export interface FormOfPayment {
  /**
   * Define el tipo de método de pago. 
   * El método de pago "VARIOS" debe activarse a nivel de agencia y 
   * requiere un código de crédito de pago específico. 
   * `PAGOS A CUOTAS` se utiliza únicamente para clientes de BSP Brasil y 
   * se refiere al pago mediante cuotas con tarjeta comúnmente denominadas "parcelado". 
   * `VIRTUAL_CARD`, `AGENCY_NAME`, `AGENCY_IATA`, `CORPORATE` y `COMPANY_NAME` se utilizan para la reserva de hotel. 
   * `VOUCHER` se utiliza para la reserva de vehículos.
   */
  type: FormOfPaymentTypeEnum
  /**
   * El código de proveedor de la tarjeta de crédito/débito. 
   * Úselo con `PAYMENTCARD`.
   *
   * pattern: ^[A-Z]{2}$
   * example: VI
   */
  cardTypeCode?: string
  /**
   * El número de tarjeta de crédito/débito. 
   * Úselo con `PAYMENTCARD`.
   *
   * pattern: ^[0-9]{12,19}$
   * example: 4537156488578956
   */
  cardNumber?: string
  /**
   * El código de seguridad de la tarjeta de crédito/débito. 
   * Úselo con `PAYMENTCARD`. 
   * Se utiliza principalmente para reservas de hotel.
   *
   * pattern: ^[0-9]{3,4}$
   * example: 123
   */
  cardSecurityCode?: string
  /**
   * La fecha de vencimiento de la tarjeta de crédito/débito. 
   * Úselo con `PAYMENTCARD`.
   *
   * pattern: ^(20)\d\d-(0[1-9]|1[012])$
   * example: 2024-07
   */
  expiryDate?: string
  /**
   * Contiene información del titular de `PAYMENTCARD`. 
   * Se utiliza principalmente para reservas de hoteles y vehículos.
   */
  cardHolder?: CardHolder
  /**
   * Contiene detalles de aprobación manual de la forma de pago. 
   * Úselo con `PAYMENTCARD`.
   */
  manualApproval?: ManualApproval
  /**
   * Enumera todos los detalles de autenticación segura del cliente para la tarjeta de pago. 
   * Para usar con `PAYMENTCARD`.
   *
   * minItems: 1
   * maxItems: 10
   */
  authentications?: StrongCustomerAuthentication[]
  /**
   * El número de meses por los cuales se puede extender su pago. 
   * Úselo con `PAYMENTCARD` o `VARIOS`.
   *
   * format: int32
   * minimum: 1
   * maximum: 96
   * example: 12
   */
  extendedPayment?: number
  /**
   * El código de crédito varios. Úselo con "VARIOS".
   *
   * example: PL189947
   * minLength: 2
   * maxLength: 18
   */
  miscellaneousCreditCode?: string
  /**
   * El número de cuotas. Úselo con `CUOTAS`.
   *
   * format: int32
   * minimum: 1
   * maximum: 96
   * example: 4
   */
  numberOfInstallments?: number
  /**
   * El código del plan de la aerolínea. Úselo con `CUOTAS`.
   *
   * example: RG065
   */
  airlinePlanCode?: string
  /**
   * El importe de la primera cuota. Úselo con `CUOTAS`. 
   * Tenga en cuenta que el sistema no espera decimales.
   *
   * pattern: ^[0-9]+$
   * example: 100
   */
  installmentAmount?: string
  /**
   * El valor del saldo neto. Úselo con `CUOTAS`.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 300.20
   */
  netBalance?: string
  /**
   * Contiene detalles de la tarjeta virtual. 
   * Se utiliza principalmente para reservas de hotel.
   */
  virtualCard?: VirtualCard
  /**
   * El número IATA de la agencia. Úselo con `AGENCY_IATA`. 
   * Se utiliza principalmente para reservas de hotel.
   *
   * example: 129345738
   * minLength: 1
   * maxLength: 12
   */
  agencyIataNumber?: string
  /**
   * Contiene la dirección de la agencia. Úselo con `AGENCIA_NOMBRE`. 
   * Se utiliza principalmente para reservas de hotel.
   */
  agencyAddress?: GenericAddress
  /**
   * El identificador corporativo. Úselo con "CORPORATIVO". 
   * Se utiliza principalmente para reservas de hotel.
   *
   * example: CC006
   */
  corporateId?: string
  /**
   * Contiene la dirección de la empresa. Úselo con `COMPANY_NAME`. 
   * Se utiliza principalmente para reservas de hotel.
   */
  companyAddress?: GenericAddress
  /**
   * Contiene información del "VOUCHER". 
   * Se utiliza principalmente para reservas de vehículos.
   */
  voucher?: Voucher
}
/**
 * Contiene información del titular de la tarjeta de pago.
 */
interface CardHolder {
  /**
   * El nombre del titular de la tarjeta.
   *
   * example: John
   */
  givenName: string
  /**
   * El apellido del titular de la tarjeta.
   *
   * example: Smith
   */
  surname: string
  /**
   * La dirección de correo electrónico del titular de la tarjeta.
   *
   * format: email
   * example: john@smith.family.priv
   */
  email?: string
  /**
   * Los números de teléfono formateados del titular de la tarjeta.
   *
   * pattern: ^[0-9+-]+$
   * example: +1-555-123-4567
   */
  phone?: string
  /**
   * La dirección del viajero.
   */
  address?: Address
}
/**
 * Contiene detalles de aprobación manual de la forma de pago. Úselo con `TARJETA DE PAGO`.
 */
interface ManualApproval {
  /**
   * El código de aprobación manual de la tarjeta de crédito/débito. Úselo con `TARJETA DE PAGO`.
   *
   * example: 12345
   * maxLength: 6
   */
  code: string
  /**
   * La fecha de solicitud de aprobación manual en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html). La hora debe proporcionarse en la zona horaria UTC.
   *
   * format: date-time
   * example: 2019-07-09T09:15:00Z
   */
  requestDateTime: string
  /**
   * La fecha de vencimiento de la aprobación manual en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html). La hora debe proporcionarse en la zona horaria UTC.
   *
   * format: date-time
   * example: 2019-07-09T09:15:00Z
   */
  expiryDateTime: string
  /**
   * El código designador de dos letras [IATA](https://www.iata.org/about/members/Pages/airline-list.aspx?All=true) de la aerolínea con aprobación manual deseada.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AA
   */
  airlineCode: string
  /**
   * El importe monetario en efectivo de la aprobación manual.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 100.00
   */
  amount: string
  /**
   * El código de moneda [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html).
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode: string
}
/**
 * Contiene detalles sólidos de autenticación del cliente para la tarjeta de pago.
 */
interface StrongCustomerAuthentication {
  /**
   * El valor de autenticación 3DS (MasterCard - AAV; Amex - AEVV; Visa - CAVV). Un valor de 20 bytes codificado en Base64, lo que da un resultado de 28 bytes.
   *
   * example: ABC123455533533444455555678
   */
  secureAuthenticationValue?: string
  /**
   * El ID de transacción 3DS devuelto por 3DS Directory Server. Un valor binario sin signo de 20 bytes.
   *
   * example: ABCDEFGHI123456789012!.1234567890123
   */
  secureTransactionId?: string
  /**
   * Indica que se intentó la autenticación para una transacción, pero hubo una interrupción de la autenticación en el flujo de autenticación entre el comerciante, el servidor de puerta de enlace 3-D Secure (3DS) y el servidor de directorio. Esto significa que no fue posible realizar una solicitud de autenticación y no se pudo recibir una respuesta de autenticación. Esta no es una exención formal, sino información que los emisores deben considerar.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: AO
   */
  issueCode?: string
  /**
   * Indica si la autenticación fue exitosa.
   *
   * example: OK
   */
  resultCode?: string
  /**
   * Determina cómo se recopiló el número de tarjeta para la transacción. Puede ser `K`: ingresada para esta transacción, o `S`: tarjeta registrada (credenciales previamente almacenadas).
   *
   * pattern: ^[A-Z0-9]$
   * example: K
   */
  cardNumberCollectionCode?: string
  /**
   * Indica en qué canal se inició la transacción. Puede ser `MO` - Pedido por correo, `TO` - Pedido telefónico, `EC` - ECOM, `FA` - Cara a cara.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: MO
   */
  channelCode?: string
  /**
   * El Indicador de Comercio Electrónico (ECI) son dos códigos alfanuméricos que devuelven los bancos emisores y las redes específicas de tarjetas de crédito.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: 12
   */
  electronicCommerceIndicator?: string
  /**
   * Determina qué exención utilizó el proveedor de servicios de pago (PSP). Puede ser `SC` - Exención corporativa segura, `DA` - Autenticación delegada, `TR` - Exención de análisis de riesgo de transacciones, `TB` - Exención de beneficiario confiable, `LV` - Exención de valor bajo.
   *
   * pattern: ^[A-Z0-9]{2}$
   * example: SC
   */
  exemptionTypeCode?: string
  /**
   * Identifica la fecha y hora de actualización de SCA en formato [ISO 8601](https://www.iso.org/iso-8601-date-and-time-format.html).
   *
   * format: date-time
   * example: 2020-07-07T16:00:00Z
   */
  updatedDateTime?: string
  /**
   * Describe el mandato acordado entre el titular de la tarjeta y el agente/tercero. Puede ser uno de los siguientes valores: `NA` - No hay acuerdo para transacciones futuras, `NS` - Acuerdo para futuras no presentaciones o cargos por cancelación, `AC` - Acuerdo para cualquier pago adeudado después del check in para cubrir los cargos durante la estadía, ` CO` - Cualquier cargo posterior al pago, `BP` - Acuerdo de prepago, depósito o pago del saldo, `FR` - Acuerdo de pago recurrente (fecha fija y monto fijo), `VR` - Acuerdo de pago recurrente (fecha fija y monto variable), `UR` - Acuerdo de pago recurrente (fecha no fija y monto variable). Es posible ingresar más de un valor usando una coma como separador, p.e. NA, NS.
   *
   * pattern: ^(([A-Z0-9]{2})(,[A-Z0-9]{2})*)$
   * example: NA
   */
  mandateTypeCode?: string
  /**
   * El nombre del comerciante que contiene hasta 40 caracteres alfanuméricos.
   *
   * example: TEST CREDIT CARD
   */
  merchantName?: string
  /**
   * El identificador de la solicitud de autorización (ID de seguimiento de autorización/ID de transmisión de autorización) cuando la realiza el agente de reservas. Este valor puede tener hasta 16 caracteres alfanuméricos y especiales y se devuelve desde la respuesta de autorización inicial.
   *
   * example: 1234547839012345
   */
  originalPaymentReference?: string
  /**
   * Indica el monto de la compra.
   *
   * pattern: ^[0-9]+(\.[0-9]{1,3})?$
   * example: 1234.56
   */
  amount?: string
  /**
   * El código de moneda ISO-4217 de tres letras.
   *
   * pattern: ^[A-Z]{3}$
   * example: USD
   */
  currencyCode?: string
  /**
   * El valor de autenticación para tokens (por ejemplo, TAVV). Un valor de 20 bytes codificado en Base64, lo que da un resultado de 28 bytes.
   *
   * example: ABC3434334343556677487312567
   */
  tokenAuthenticationValue?: string
  /**
   * Indica si el titular de la tarjeta está inscrito en 3DS.
   *
   * example: PASS
   */
  verificationResultCode?: string
  /**
   * La versión del protocolo del programa 3DS. Un valor de 3 caracteres alfanuméricos, sin puntos entre ellos.
   *
   * pattern: ^[0-9]{3}$
   * example: 120
   */
  version?: string
}
/**
 * Contiene información de la tarjeta virtual.
 */
interface VirtualCard {
  /**
   * El código de cuenta del cliente de la tarjeta virtual.
   *
   * example: John
   */
  customerAccountCode?: string
  /**
   * La dirección de correo electrónico de la agencia.
   *
   * format: email
   * example: john@smith.family.priv
   */
  agencyEmail?: string
  /**
   * El número de fax del hotel.
   *
   * pattern: ^[0-9+-]+$
   * example: +1-555-123-4567
   */
  hotelFax?: string
  /**
   * El nombre completo del hotel. Pase el valor obtenido de HotelPriceCheckRS/PriceCheckInfo/HotelInfo/@HotelName.
   *
   * example: Ilia Hotel and Luxury Suites
   */
  hotelName?: string
  /**
   * El tipo de habitación proporcionada por el proveedor del hotel. Pase el valor obtenido de HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/Rooms/Room/RoomDescription/@Name.
   *
   * example: 2 double beds
   */
  roomType?: string
  /**
   * La descripción detallada de la habitación proporcionada por el proveedor del hotel. Pase el valor obtenido de HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/Rooms/Room/RoomDescription/Text.
   *
   * example: Deluxe Room, 2 Double Beds
   */
  roomDescription?: string
  /**
   * Importe total de la reserva de hotel. Pase el valor obtenido de HotelPriceCheckRS/PriceCheckInfo/HotelRateInfo/RateInfos/RateInfo/@AmountAfterTax y @CurrencyCode.
   */
  rateAmount?: Value
  /**
   * Enumera todos los cargos adicionales que pueden cubrir la tarjeta virtual. Si la tarjeta se utiliza para cubrir solo habitación, pase el valor "Solo habitación".
   *
   * minItems: 1
   * maxItems: 10
   */
  /**
   * El cargo extra que será cubierto por la tarjeta virtual.
   *
   * example: Breakfast
   */
  virtualCardCharges?: string[]
}
/**
 * Contiene información del bono.
 */
interface Voucher {
  /**
   * El número de facturación asociado al bono.
   *
   * example: 1234567
   */
  billingNumber?: string
  /**
   * Código abreviado que indica el tipo de bono.
   *
   * example: FC
   */
  type?: string
}
