# Sabre Client — Descripción del Proyecto

## ¿Qué es?

`sabre-client` es un SDK de Node.js/TypeScript que envuelve la API REST de Sabre
([developer.sabre.com](https://developer.sabre.com)), el sistema de distribución global (GDS)
usado por aerolíneas y agencias de viaje para búsqueda de vuelos, reservas y emisión de boletos.

El objetivo es que un desarrollador integre Sabre sin tener que lidiar directamente con
autenticación OAuth, construcción de peticiones HTTP, headers ni parseo de errores de la API:
solo instancia el cliente y llama métodos tipados como `sabre.search.shop(...)` o
`sabre.booking.create(...)`.

## Propósito

Sabre expone su funcionalidad como una API REST amplia, con múltiples esquemas de autenticación,
convenciones inconsistentes entre endpoints y payloads complejos. Consumirla directamente desde
cada proyecto implica repetir lógica de fetch, manejo de tokens y tipado de requests/responses.

Este proyecto centraliza esa integración en una única librería reutilizable y publicable en npm,
de forma que cualquier aplicación Node/TypeScript pueda operar contra Sabre con una API ergonómica,
tipada de extremo a extremo y con manejo de errores consistente (`ApiError`).

## Tema / dominio

Reservas y operaciones aéreas (industria de viajes), cubriendo el ciclo de vida típico de una
reserva:

1. **Autenticación** (`authentication`) — obtención de tokens OAuth (ATK) vía v2/v3.
2. **Búsqueda** (`air/search`) — Bargain Finder Max (shop) y revalidación de itinerarios.
3. **Gestión de reservas** (`booking-management`) — creación, modificación, cancelación y
   consulta de PNRs (Passenger Name Records).
4. **Boletos** (`booking-management/flight-tickets`, `air/ticketing`) — emisión, anulación
   (void), reembolso (refund) y verificación de boletos electrónicos.
5. **Trip management** (`trip-management`) — consulta de reservas existentes.

Ver [`docs/air-booking-workflow-es.md`](./air-booking-workflow-es.md) para el flujo completo de
una reserva (búsqueda → revalidación → creación de PNR).

## Objetivos del proyecto

- **Cobertura funcional**: exponer los endpoints más usados del flujo de reservas aéreas de Sabre
  (auth, shop, revalidate, booking, ticketing) con una API consistente.
- **Tipado fuerte**: interfaces TypeScript para requests y responses de cada dominio, de modo que
  errores de payload se detecten en tiempo de compilación.
- **Ergonomía**: un solo cliente (`Sabre`) como punto de entrada, con submódulos navegables por
  dominio (`sabre.authentication`, `sabre.search`, `sabre.booking`, `sabre.flightTickets`,
  `sabre.ticketing`).
- **Configuración simple**: credenciales configurables por opciones del constructor o por
  variables de entorno (`.env`), con fallo temprano y mensajes descriptivos si faltan datos.
- **Distribución estándar**: publicado como paquete npm (`sabre-client`) con build dual ESM/CJS y
  tipos generados, consumible desde cualquier proyecto Node moderno o legado.
- **Mantenibilidad**: código organizado por dominio funcional (feature folders) para que agregar
  soporte a un nuevo endpoint de Sabre no requiera tocar los dominios existentes. Ver
  [`docs/architecture-decisions.md`](./architecture-decisions.md) para el detalle de los patrones
  usados.

## Alcance actual

Implementado: autenticación (v2/v3), búsqueda (shop/revalidate), gestión de PNR (get/create/
modify/cancel), boletos (void/refund/check/fulfill/issue).

Fuera de alcance por ahora: EMDs (Electronic Miscellaneous Documents) y otros dominios de Sabre no
listados arriba (por ejemplo, hoteles, carros, o back-office/reporting).

## Público objetivo

Equipos de desarrollo que integran capacidades de reserva aérea (agencias de viaje, OTAs,
plataformas de gestión de viajes corporativos) y necesitan comunicarse con Sabre desde una
aplicación Node/TypeScript.
