import { Sabre } from "../sabre"
import { BargainFinderMaxOptions, BargainFinderMaxResponseSuccess, RevalidateItineraryOptions, RevalidateItineraryResponseSuccess } from "./interfaces";

export class Search {
  /**
   * Bargain Finder Max v5
   * 
   * Bargain Finder Max (BFM), 
   * nuestro producto de búsqueda de tarifas bajas líder en su clase, 
   * se utiliza para buscar los itinerarios con los precios más bajos disponibles según una fecha específica.
   * 
   * Revalidate Itinerary v5
   * 
   * La API Revalidate Itinerary permite volver a consultar la disponibilidad 
   * y el precio de una opción de itinerario específica sin tener que reservarla. 
   * La solución revalida si la opción de itinerario es válida para la compra. 
   * Revalidate Itinerary no admite contenido NDC.
   * 
   * @param sabre Sabre Client Reference
   */
  constructor (
    private sabre: Sabre
  ) {}

  /**
   * Crear solicitud de Buscador de ofertas Max.
   * 
   * payload - El mensaje de solicitud de búsqueda de tarifa baja solicita opciones 
   * de itinerario para vuelos entre pares de ciudades específicos, en fechas específicas, 
   * para un número y tipo de pasajeros específicos. 
   * La información opcional de la solicitud puede incluir: 
   *  hora/ventana horaria, ciudades de conexión 
   *  y preferencias del cliente (aerolíneas, cabina, tipo de vuelo, etc.). 
   * La solicitud de búsqueda de tarifa baja contiene información similar a 
   * la de una búsqueda de tarifa baja en el CRS o GDS de una aerolínea.
   * @param payload BargainFinderMaxOptions 
   * @returns {Promise<BargainFinderMaxResponseSuccess>}
   */
  async shop(payload: BargainFinderMaxOptions): Promise<BargainFinderMaxResponseSuccess> {
    const path = "/v5/offers/shop";
    return this.sabre.post<BargainFinderMaxResponseSuccess>(path, payload)
  }
  /**
   * Crear solicitud de revalidación de itinerario.
   * 
   * payload - El mensaje de solicitud de búsqueda de tarifa baja solicita opciones
   * de itinerario para vuelos entre pares de ciudades específicos, en fechas específicas, 
   * para un número y tipo de pasajeros específicos. 
   * La información opcional de la solicitud puede incluir: 
   *  hora/ventana horaria, ciudades de conexión 
   *  y preferencias del cliente (aerolíneas, cabina, tipo de vuelo, etc.). 
   * La solicitud de búsqueda de tarifa baja contiene información similar a 
   * la de una búsqueda de tarifa baja en el CRS o GDS de una aerolínea.
   * @param payload RevalidateItineraryOptions
   * @returns {Promise<RevalidateItineraryResponseSuccess>}
   */
  async revalidate(payload: RevalidateItineraryOptions): Promise<RevalidateItineraryResponseSuccess> {
    const path = "/v5/shop/flights/revalidate";
    return this.sabre.post<RevalidateItineraryResponseSuccess>(path, payload)
  }
}