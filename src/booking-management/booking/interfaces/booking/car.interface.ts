import { TotalValues } from "../../../common/interfaces";
import { Address, CarReference, CarRentalSite, ContactInformation, DateRangeRefundPenalty, GenericAddress, StatusNameEnum } from "../../common/interfaces";
/**
 * Identifica el nombre del tipo de automóvil según el segundo carácter del código [ACRISS](https://www.acriss.org/car-codes/).
 *
 * example: Two/Three Door
 */
enum VehicleTypeNameEnum {
  'Two/Three Door',
  'Two/Four Door',
  'Four/Five Door',
  'Wagon/Estate',
  'Passenger Van',
  'Limousine/Sedan',
  Sport,
  Convertible,
  SUV,
  'Open Air All Terrain',
  Special,
  'Pick up single/extended cab 2 door',
  'Pick up double cab 4 door',
  'Special Offer Car',
  Coupe,
  Monospace,
  'Recreational Vehicle',
  'Motor Home',
  'Two Wheel Vehicle',
  Roadster,
  Crossover,
  'Commercial Van/Truck'
}
/**
 * Contiene información de alquiler de automóviles, identificada por "itemId", para la reserva dada.
 */
export interface Car extends CarReference, CarItem {}
/**
 * Contiene información de alquiler de automóviles para la reserva dada.
 */
interface CarItem {
  /**
   * El número de reserva de alquiler de coches.
   *
   * pattern: ^[A-Z0-9-]{6,}$
   * example: 843296421
   */
  confirmationId?: string
  /**
   * Especifica el viajero de la lista de viajeros con quien está asociada la reserva del automóvil.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  travelerIndex?: number
  /**
   * El nombre completo del proveedor de alquiler de vehículos.
   *
   * example: National
   */
  vendorName: string
  /**
   * El código de dos letras del proveedor de alquiler de vehículos.
   *
   * pattern: ^[A-Z]{2}$
   * example: ZE
   */
  vendorCode: string
  /**
   * El código del lugar de recogida.
   *
   * pattern: ^[A-Z0-9]+$
   * example: DFW
   */
  pickUpLocationCode?: string
  /**
   * Lugar de recogida del coche.
   */
  pickUpAddress: GenericAddress
  /**
   * La fecha de recogida del coche de alquiler en formato "AAAA-MM-DD" en la zona horaria local del lugar de recogida.
   *
   * format: date
   * example: 2019-07-09
   */
  pickUpDate: string
  /**
   * La hora de recogida del coche de alquiler en formato `HH:MM` en la hora local del lugar de recogida.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 13:00
   */
  pickUpTime: string
  /**
   * Contiene información de contacto para el lugar de recogida.
   */
  pickUpContactInfo?: ContactInformation
  /**
   * El código del lugar de entrega.
   *
   * pattern: ^[A-Z0-9]+$
   * example: DEN
   */
  dropOffLocationCode?: string
  /**
   * Lugar de entrega del vehículo.
   */
  dropOffAddress?: GenericAddress
  /**
   * La fecha de entrega del auto de alquiler en formato "AAAA-MM-DD" en la zona horaria local del lugar de entrega.
   *
   * format: date
   * example: 2019-07-19
   */
  dropOffDate: string
  /**
   * La hora de entrega del coche de alquiler en formato "HH:MM" en la hora local del lugar de entrega.
   *
   * pattern: ^[0-9]{2}:[0-9]{2}$
   * example: 12:00
   */
  dropOffTime: string
  /**
   * Contiene la información de contacto del lugar de entrega.
   */
  dropOffContactInfo?: ContactInformation
  /**
   * Contiene la dirección de recogida personalizada del coche reservado.
   */
  collectionAddress?: Address
  /**
   * Contiene los detalles del lugar de recogida personalizado del coche reservado.
   */
  collectionSite?: CarRentalSite
  /**
   * Contiene la dirección de entrega personalizada del coche reservado.
   */
  deliveryAddress?: Address
  /**
   * Contiene detalles del lugar de entrega personalizado para el automóvil reservado.
   */
  deliverySite?: CarRentalSite
  /**
   * Si es "verdadero", el alquiler del coche se podrá reembolsar en su totalidad o por tramos. Consulte la matriz `refundPenalties` para obtener más información.
   *
   * default: True
   * example: False
   */
  isRefundable: boolean
  /**
   * Enumera las condiciones y pagos por cancelación de un alquiler de auto.
   */
  /**
   * Contiene el rango de fechas hasta el cual se aplica una multa, incluido el costo total de la multa.
   */
  refundPenalties?: DateRangeRefundPenalty[]
  /**
   * El código de estado de una o dos letras utilizado por los proveedores. Indica el estado de reserva del coche.
   *
   * pattern: ^[A-Z]{1,2}$
   * example: HK
   */
  carStatusCode?: string
  /**
   * El valor significativo que describe el estado de la reserva del automóvil.
   */
  carStatusName?: StatusNameEnum
  /**
   * El código de 4 caracteres [ACRISS](https://www.acriss.org/car-codes/) del automóvil.
   *
   * example: MBMR
   */
  vehicleTypeCode?: string
  /**
   * Identifica el nombre del tipo de automóvil según el segundo carácter del código [ACRISS](https://www.acriss.org/car-codes/).
   */
  vehicleTypeName?: VehicleTypeNameEnum
  /**
   * El número de coches solicitados.
   *
   * format: int32
   * minimum: 1
   * example: 1
   */
  numberOfVehicles?: number
  /**
   * El ID único de una oferta de un proveedor determinado.
   *
   * example: RCUD1
   */
  rateCode?: string
  /**
   * La distancia incluida en la reserva del alquiler del coche.
   *
   * example: UNL
   */
  distanceAllowance?: string
  /**
   * La información de pago proporcionada al proveedor para garantizar la reserva. Se devuelve cuando los datos estructurados no están disponibles.
   *
   * example: GVI4XXXXXXXXXXX0008EXP 03 22-TEST CAR
   */
  guaranteePaymentNote?: string
  /**
   * La información especial proporcionada al proveedor.
   *
   * example: NON-SMOKING CAR PLEASE
   */
  specialInstructions?: string
  /**
   * Contiene información de pago del servicio.
   */
  payment?: TotalValues
}
