# Ejemplos

## Flujo de Air Booking del Tier 1

`run-air-booking-flow.mjs` corre el flujo completo con tus credenciales: auth → Bargain Finder
Max → Revalidate Itinerary → Create Booking. El flujo en sí está en `air-booking-flow.mjs`,
que solo usa la API pública del SDK; los tests lo cubren con `fetch` mockeado.

Hace una búsqueda de solo ida para un adulto (a 30 días y con hasta una escala, salvo que cambies
`SABRE_DEPARTURE_DAYS` o `SABRE_MAX_STOPS`) y revalida el primer itinerario que Revalidate acepte:
prueba hasta 3 y salta los que rechaza (por ejemplo, `NO FARE FOR CLASS USED`). Si lo activas, lo
reserva con un pasajero sintético (`TEST/PASSENGER`). Con `SABRE_PREVIEW_BOOKING=1` arma el
request de Create Booking e imprime su `flightDetails` **sin enviarlo**. Si el precio revalidado
no coincide con el de BFM, avisa. Al final informa cuántas
peticiones de token hizo: el flujo entero debe usar **un solo token** (cero si lo reutilizó de
`tokenStore`). Si se pidió más de uno, termina con código 1.

### Cómo correrlo

```sh
npm run build
node --env-file=.env examples/run-air-booking-flow.mjs
```

Variables de entorno:

| Variable | Requerida | Descripción |
| - | - | - |
| `SABRE_USERNAME` | sí | Usuario EPR completo, o solo el ID de usuario: se arma `<user>-<PCC>-AA` (v3) o `V1:<user>:<PCC>:AA` (v2) |
| `SABRE_PASSWORD` | sí | Contraseña EPR |
| `SABRE_PCC` | sí | PCC (o `SABRE_ORGANIZATION`) |
| `SABRE_CLIENT_ID`, `SABRE_CLIENT_SECRET` | con v3 | Client ID/Secret de la app |
| `SABRE_ENVIRONMENT` | no | `sandbox` (default) o `production` |
| `SABRE_AUTH_VERSION` | no | `v3` (default) o `v2` |
| `SABRE_ORIGIN`, `SABRE_DESTINATION` | no | `DFW` → `LAX` por defecto |
| `SABRE_DEPARTURE_DAYS` | no | Días hasta la salida, entre 1 y 330. `30` por defecto |
| `SABRE_MAX_STOPS` | no | Escalas máximas, entre 0 y 3. `1` por defecto; `0` deja solo vuelos directos |
| `SABRE_CREATE_BOOKING` | no | `1` para reservar. Crea un PNR en sandbox |
| `SABRE_PREVIEW_BOOKING` | no | `1` para ver el `flightDetails` que se mandaría a Create Booking, sin enviarlo. Excluyente con `SABRE_CREATE_BOOKING` |
| `SABRE_TOKEN_STORE` | no | `file` para reutilizar el token entre corridas (`.sabre-token.json`, ignorado por git) |
| `SABRE_DEBUG` | no | `1` para ver los eventos del SDK en consola, ya redactados |

### Producción

Con este script, en producción **solo se corren BFM y Revalidate**, que son de solo lectura. Se
niega a correr con `SABRE_CREATE_BOOKING=1` y `SABRE_ENVIRONMENT=production`, porque crearía un
PNR real. La única reserva permitida en producción es el piloto de `run-booking-lifecycle.mjs`
(ver abajo).

La corrida recomendada busca un vuelo directo con fecha lejana, el perfil que usaría una futura
reserva de prueba, y muestra sin enviarlo el `flightDetails` de Create Booking:

```sh
npm run build
SABRE_ENVIRONMENT=production SABRE_TOKEN_STORE=file SABRE_MAX_STOPS=0 SABRE_DEPARTURE_DAYS=75 \
  SABRE_PREVIEW_BOOKING=1 node --env-file=.env.production examples/run-air-booking-flow.mjs
```

Cada llamada a producción puede generar un cargo (*scan charge*): corre el smoke cuando haga
falta, no en bucle. Para confirmar que no se llamó a `/v1/trip/orders/*`, agrega `SABRE_DEBUG=1`
y revisa las URLs en el log.

Las credenciales van en `.env` o `.env.production`, que git ignora. Nunca las pongas en el
código ni en la línea de comandos.

## Ciclo de vida de una reserva: Create → Get → Cancel → Get

`run-booking-lifecycle.mjs` reserva el primer itinerario que Revalidate acepte, lo verifica con
Get Booking, deja una ventana de revisión, lo cancela y comprueba que quedó sin vuelos. La lógica
está en `booking-lifecycle.mjs`, con tests en `fetch` mockeado. Es la secuencia de prueba de
`sabre-wiki/wiki/sdk/gestion-de-reserva.md`.

1. BFM y Revalidate, como `air-booking-flow.mjs`.
2. **Confirmación**: muestra vuelo, clase, precio y pasajero, y espera que escribas `reservar`.
3. **Create Booking** sin pago ni emisión (`agency.ticketingPolicy: FUTURE_TICKETING`, con
   `futureTicketingPolicy` de fecha mañana en tu PCC, que Sabre exige con esa política), con
   `priceComparisons` que corta ante cualquier subida sobre el precio revalidado
   (`INCREASE_BY_AMOUNT` `0`) y `HALT_ON_ERROR`, el default de Sabre. Sin reintento.
4. **Get Booking** de verificación: vuelos iguales a los pedidos y en `HK`, y un pasajero `ADT`.
5. **Ventana de revisión**: el PNR queda vivo para revisarlo (Get o Sabre Red). Enter lo cancela;
   a los 15 minutos se cancela solo; Ctrl+C también cancela. Si algo falla antes, se cancela
   enseguida.
6. **Cancel Booking** `{ confirmationId, cancelAll: true }`. `NO_ITEMS_CANCELLED` cuenta como fallo.
7. **Get Booking** final: `flights[]` tiene que quedar vacío. Si no, termina con código 1 y te deja
   el localizador para cancelarlo a mano.

Al final imprime un informe sin datos del pasajero: localizador, estados, warnings y tiempos.

### Piloto de producción (una sola corrida)

Lo decidió el usuario en #47 asumiendo un riesgo de ADM sin confirmar (ver
`sabre-wiki/wiki/concepts/prevencion-de-adm.md`). Sin estas condiciones, el script no llama a
Create Booking:

- **Doble opt-in**: `SABRE_CREATE_BOOKING=1` y `SABRE_ALLOW_PRODUCTION_BOOKING` con la fecha de hoy
  (`AAAA-MM-DD`, hora local).
- **Pasajero real que consienta**, desde `.env.production`: `SABRE_TRAVELER_GIVEN_NAME`,
  `SABRE_TRAVELER_SURNAME`, `SABRE_TRAVELER_EMAIL` y `SABRE_TRAVELER_PHONE`. Nunca se loguean.
- **Vuelo directo** (`SABRE_MAX_STOPS` no se acepta) a 60–90 días: `SABRE_DEPARTURE_DAYS`, 75 por
  defecto.
- **Lejos del mantenimiento** de Sabre (00:15–00:25 CT): se niega desde las 23:55 hasta las 00:30 CT.
- **Una sola corrida**: el localizador se escribe en `.sabre-pilot-pnr.json` (ignorado por git)
  apenas llega. Si ese archivo existe, el script no crea otro PNR:
  - si el PNR quedó sin cancelar, solo ofrece **retomar la cancelación** (escribe `cancelar`);
  - si quedó cancelado, se niega: otra corrida requiere una nueva decisión;
  - si Create terminó con resultado incierto (timeout, red, 5xx), el lock no tiene localizador:
    revisa en Sabre Red si se creó algo y borra el archivo a mano.

Si Sabre rechaza Create sin crear el PNR (por ejemplo `MANDATORY_DATA_MISSING` o un prerrequisito
de la cuenta), no se escribe el lock y la corrida no se consume: se puede repetir una vez
resuelto (decisión de #50).

**Prerrequisito de la cuenta**: el PCC donde se crea el PNR necesita la opción "Store Passenger
Type In PNR" activa en el Travel Journal Record (TJR). Sin ella, Create falla con
`UNABLE_TO_ADD_TRAVELER_PASSENGER_TYPE_NOT_ENABLED`. Si el PCC de tus credenciales no la tiene,
usa otro que sí con `SABRE_TARGET_PCC`:

- la auth sigue con `SABRE_PCC` o `SABRE_ORGANIZATION`;
- el POS de la búsqueda, el `targetPcc` de Create, Get y Cancel, y el `ticketingPcc` de
  `futureTicketingPolicy` usan `SABRE_TARGET_PCC`;
- el lock guarda ese PCC, así que retomar la cancelación también lo usa.

Sin `SABRE_TARGET_PCC`, todo usa el PCC de la auth y no se manda `targetPcc`. Sabre no revierte
el cambio de contexto después de reservar, y la sesión tiene que tener permiso sobre ese PCC. Si
no lo tiene, lo esperable es `UNABLE_TO_CHANGE_CONTEXT`, sin PNR (sin confirmar con una corrida
real).

```sh
npm run build
SABRE_ENVIRONMENT=production SABRE_TOKEN_STORE=file SABRE_CREATE_BOOKING=1 \
  SABRE_ALLOW_PRODUCTION_BOOKING=$(date +%F) \
  node --env-file=.env.production examples/run-booking-lifecycle.mjs
```

En sandbox basta `SABRE_CREATE_BOOKING=1`, no hay lock y, sin las variables `SABRE_TRAVELER_*`,
usa el pasajero sintético. Acepta las mismas variables de búsqueda, auth y depuración que
`run-air-booking-flow.mjs`.
