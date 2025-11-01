import { Sabre } from "../sabre"
import { CreatePassengerNameRecordOptions, CreatePassengerNameRecordResponseSuccess } from "./interfaces"

export class Reservation {
  /**
   * Reservation
   * 
   * La API para crear un registro de nombre de pasajero es una API 
   * orquestada que integra varias funciones y operaciones en una sola llamada.
   * 
   * Esta API permite crear un registro de nombre de pasajero (PNR), 
   * incluyendo segmentos aéreos, en una sola llamada.
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}
  /**
   * Cree una reserva completa de contenido aéreo, hotel y automóvil de alquiler, todo dentro de una sola solicitud.
   * 
   * payload - Contiene elementos obligatorios y opcionales para realizar una solicitud de reserva.
   * @param payload CreatePassengerNameRecordOptions
   * @returns {Promise<CreatePassengerNameRecordResponseSuccess>}
   */
  create(payload: CreatePassengerNameRecordOptions): Promise<CreatePassengerNameRecordResponseSuccess> {
    const path = '/v2.5.0/passenger/records?mode=create'
    return this.sabre.post<CreatePassengerNameRecordResponseSuccess>(path, payload)
  }

}