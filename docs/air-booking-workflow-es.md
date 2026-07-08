## Inicio: Reservas aéreas

# Paso 1: Buscar vuelos con Bargain Finder Max
Busca opciones de vuelo por tarifa más baja con Bargain Finder Max.

Bargain Finder Max calcula una amplia gama de horarios y tarifas de aerolíneas en múltiples fechas para generar la mejor oferta de itinerario en segundos.

# Paso 2: Revalidar precios de itinerario
Revalida la disponibilidad y el precio de una opción de itinerario específica con Revalidar Itinerario (sin tener que reservar un vuelo).

Esta API también se puede usar para solicitar información adicional sobre reglas, detalles del vuelo y asientos, incluyendo la posibilidad de ofrecer otras opciones.
# Paso 3: Servicio Obtener asientos (opcional)
Visualización de la disponibilidad de asientos a través del servicio Obtener asientos.

# Paso 4: Servicio Obtener servicios complementarios (opcional)
Visualización de la disponibilidad de servicios complementarios a través del servicio Obtener servicios complementarios.

Esta API proporciona detalles sobre los servicios complementarios, tanto de pago (p. ej., equipaje) como gratuitos (p. ej., silla de ruedas), que se ofrecen para un vuelo/viaje determinado. Este paso es opcional y, según las necesidades de su flujo de trabajo, puede ejecutarse antes o después de crear la reserva.
# Paso 5: Crear una reserva mediante la API de Gestión de Reservas
Genere una reserva completa (PNR u Orden) dentro de una única API utilizando la API de Gestión de Reservas (específicamente a través del punto final /createBooking).

Esta API reserva todos los vuelos, cotiza y almacena las tarifas, y añade todos los datos/solicitudes especiales necesarios (si las hubiera) en una sola llamada. Tras la ejecución correcta, la API devolverá el ID de confirmación de Sabre para la reserva recién creada, así como el ID de confirmación de la(s) aerolínea(s).
# Fin: Reserva confirmada con los ID de Sabre y de la aerolínea