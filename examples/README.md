# Ejemplos

## Flujo de Air Booking del Tier 1

`run-air-booking-flow.mjs` corre el flujo completo con tus credenciales: auth → Bargain Finder
Max → Revalidate Itinerary → Create Booking. El flujo en sí está en `air-booking-flow.mjs`,
que solo usa la API pública del SDK; los tests lo cubren con `fetch` mockeado.

Hace una búsqueda de solo ida para un adulto, a 30 días, revalida el primer itinerario y, si lo
activas, lo reserva con un pasajero sintético (`TEST/PASSENGER`). Al final informa cuántas
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
| `SABRE_CREATE_BOOKING` | no | `1` para reservar. Crea un PNR en sandbox |
| `SABRE_TOKEN_STORE` | no | `file` para reutilizar el token entre corridas (`.sabre-token.json`, ignorado por git) |
| `SABRE_DEBUG` | no | `1` para ver los eventos del SDK en consola, ya redactados |

### Producción

En producción **solo se corren BFM y Revalidate**, que son de solo lectura. El script se niega a
correr con `SABRE_CREATE_BOOKING=1` y `SABRE_ENVIRONMENT=production`, porque crearía un PNR real.

```sh
SABRE_ENVIRONMENT=production SABRE_TOKEN_STORE=file \
  node --env-file=.env.production examples/run-air-booking-flow.mjs
```

Las credenciales van en `.env` o `.env.production`, que git ignora. Nunca las pongas en el
código ni en la línea de comandos.
