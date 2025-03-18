import { TotalValues } from "../../../common/interfaces";
import { FormOfPayment } from "../../common/interfaces"

/**
 * Contiene todos los montos totales de pago en vuelos, hoteles, reservas de automóviles y otros.
 */
export interface TotalPayments {
  /**
   * Enumera todos los pagos de vuelos, por cada moneda utilizada. 
   * Para reservas con boleto, suma todos los pagos independientemente del estado del documento. 
   * Para reservas sin boleto, suma los pagos de todas las cotizaciones de precios almacenadas en la reserva.
   */
  /**
   * Contiene montos totales de pagos monetarios, montos antes de impuestos y montos de tarifas.
   */
  flightTotals?: TotalValues[]
  /**
   * Enumera todos los pagos de vuelos, por cada moneda utilizada, y se aplica solo a reservas con boletos. 
   * Resume todos los pagos con exclusión de los billetes intercambiados/reembolsados/anulados.
   */
  flightCurrentTotals?: TotalValues[]
  /**
   * Enumera todos los pagos de hotel, por cada moneda utilizada.
   */
  /**
   * Contiene montos totales de pagos monetarios, montos antes de impuestos y montos de tarifas.
   */
  hotelTotals?: TotalValues[]
  /**
   * Enumera todos los pagos de alquiler de automóviles, por cada moneda utilizada.
   */
  /**
   * Contiene montos totales de pagos monetarios, montos antes de impuestos y montos de tarifas.
   */
  carTotals?: TotalValues[]
  /**
   * Enumera todos los pagos de trenes, por cada moneda utilizada.
   */
  /**
   * Contiene montos totales de pagos monetarios, montos antes de impuestos y montos de tarifas.
   */
  trainTotals?: TotalValues[]
  /**
   * Enumera todos los métodos de pago que están almacenados en la reserva.
   */
  /**
   * Contiene detalles de una forma de pago.
   */
  formsOfPayment?: FormOfPayment[]
}