# Blueprint: el próximo SDK de Sabre

Este documento es la referencia de diseño para construir, desde cero, un
cliente de las APIs REST de Sabre que combine lo mejor de los dos proyectos
que hoy conviven en este repositorio:

- **`sabre-client`** (raíz de este repo): cobertura del flujo de reserva
  aérea clásico, ergonomía orientada a dominio (`sabre.booking.create(...)`),
  configuración por variables de entorno con fail-fast, ejemplos ejecutables
  y una capa de transporte simple.
- **`sabre-rest`** (`djensen-sabre-rest/`): arquitectura mucho más madura —
  superficie pública de solo interfaces/factories, cadena de middleware,
  autenticación con `TokenProvider`/`TokenStore` y locking, jerarquía de
  errores propia, tipos generados desde OpenAPI aislados detrás de una capa
  de mapeo, cobertura de aéreo + hotelería + datos de referencia, y un flujo
  de release completamente automatizado.

La meta declarada por quien pidió este documento es explícita: **una base
tan sólida que no necesitemos rehacerla más adelante**. Por eso este texto
no es solo "lo mejor de cada uno" — en varios puntos identifica huecos que
ninguno de los dos proyectos cubre todavía (timeouts configurables,
reintentos, cabeceras transversales, capa de conveniencia por dominio) y
propone cómo resolverlos sin traicionar los principios que sí funcionan.

Este documento describe **decisiones**, no código final. Cuando el nuevo
proyecto arranque, `docs/architecture.md` y `docs/decisions.md` (siguiendo
el modelo de `sabre-rest`) deben nacer a partir de este blueprint y luego
convertirse en la fuente de verdad viva — actualizándose en el mismo cambio
que motive una revisión de estas decisiones.

---

## 1. De dónde viene cada decisión

| Área | Ganador | Por qué |
|---|---|---|
| Superficie pública (interfaces + factories, sin clases exportadas) | `sabre-rest` | Programa contra el contrato, no la implementación; evita fugas de detalles internos. |
| Cadena de middleware | `sabre-rest` | Un solo modelo mental componible para auth, errores, logging, retries. |
| Autenticación (`TokenProvider`/`TokenStore`, refresh proactivo, locking) | `sabre-rest` | Resuelve multi-instancia/distribuido; `sabre-client` no tiene refresh ni cache de token. |
| Doble esquema de credenciales OAuth v2 (usuario/PCC **y** clientId/secret) | Fusión | `sabre-rest` solo implementa clientId/secret; `sabre-client` solo implementa el esquema EPR (usuario/password/PCC) más v3 password grant. El SDK final necesita ambos. |
| Jerarquía de errores tipada | `sabre-rest` | `sabre-client` tiene una sola clase `SabreError`; la subclasificación por causa (red, timeout, parseo, auth, respuesta API) permite manejo condicional real. |
| Tipos generados + mappers aislados | `sabre-rest` | `sabre-client` no genera tipos desde OAS; sin esta capa cada cambio de Sabre es una migración manual y propensa a *drift*. |
| Cabeceras transversales (`User-Agent`, `Conversation-ID`) | `sabre-client` | `sabre-rest` no las modela; Sabre las recomienda para soporte/trazabilidad y `sabre-client` ya resuelve bien el *fallback* a defaults. |
| Ejemplos ejecutables (`examples/*.ts`) | `sabre-client` | Complementan al JSDoc y a los scripts de shell como forma de onboarding rápido. |
| Fixtures de respuestas reales (`response/*.json`) | `sabre-client` | Útiles como base de datos de prueba para los mappers; `sabre-rest` no las tiene versionadas de forma sistemática. |
| Scripts e2e contra CERT + hallazgos operativos documentados | `sabre-rest` | El caso `designatePrinters` / `PRINTER_NOT_ASSIGNED` en `decisions.md` demuestra el valor de este proceso. |
| Versionado y releases (release-please, conventional commits) | `sabre-rest` | Automatiza lo que en `sabre-client` es manual. |
| Lint/format | `sabre-rest` (Biome) | Una sola herramienta reemplaza ESLint + Prettier. |
| Agrupación de servicios | Fusión (ver §5) | Por-API-y-versión como base (evita ambigüedad de versión), más una capa opcional de conveniencia por dominio para la ergonomía que sí tenía `sabre-client`. |
| Build | `sabre-rest` (`tsc` puro, solo ESM) | Ver §14 para el trade-off frente al build dual de `sabre-client`. |

---

## 2. Principios rectores

1. **El consumidor nunca ve una clase interna.** Solo interfaces y
   funciones factory (`createSabreClient`, `createOAuthV2`, ...).
2. **Todo comportamiento transversal es middleware.** Autenticación,
   mapeo de errores, reintentos, timeouts, logging: todos son la misma
   forma componible, no casos especiales.
3. **Los tipos generados no cruzan la frontera del paquete, nunca.** Cada
   servicio traduce a mano entre lo generado y lo público.
4. **Ningún error público expone formas de `fetch`.** `Response`,
   `Headers`, etc. quedan encapsulados; se preserva la causa original vía
   `cause`.
5. **La configuración es explícita en el punto de construcción.** Nada de
   adivinar entorno (cert vs. prod) ni de tokens por defecto.
6. **Cero dependencias de runtime.**
7. **La documentación de arquitectura es fuente de verdad y se actualiza
   en el mismo PR que la motiva.**
8. **0.x hasta que la superficie sea estable; entonces 1.0 y semver
   estricto.**

---

## 3. Superficie pública: interfaces + factories

```ts
// público
export interface SabreClient { /* ... */ }
export function createSabreClient(opts: SabreClientOptions): SabreClient;

// interno — no se exporta
class DefaultSabreClient implements SabreClient { /* ... */ }
```

- Ningún `new` en la API pública. Construcción únicamente vía factories.
- Las variables/parámetros públicos se tipan a la interfaz, nunca a la
  clase `Default*`.
- Nada de prefijo `I` en las interfaces (no es idiomático en TS moderno).
- Los tests tampoco instancian `Default*` directamente: usan las mismas
  factories que un consumidor real, para que un refactor interno no rompa
  tests que dependían de detalles de implementación.

---

## 4. Composición del cliente

Patrón facade de `sabre-client` (una raíz + submódulos inyectados),
reimplementado con interfaces/factories en vez de clases exportadas:

```ts
export interface SabreClient {
  readonly bargainFinderMaxV5: BargainFinderMaxV5Service;
  readonly bookingManagementV1: BookingManagementV1Service;
  // ...un miembro readonly por servicio

  /** Escape hatch: enviar una petición cruda por la cadena configurada. */
  request(req: SabreRequest): Promise<SabreResponse>;
}

export function createSabreClient(opts: SabreClientOptions): SabreClient {
  // construye la cadena de middleware, construye cada servicio eagerly,
  // retorna una única implementación interna.
}
```

- **Construcción eager**, no lazy getters: los servicios son baratos (unas
  pocas referencias), y la simplicidad gana sobre el ahorro de memoria.
- **Un solo camino de construcción.** No hay `createXyzService` público
  independiente — evita una segunda superficie a mantener.
- `request()` queda expuesto como escape hatch documentado para casos que
  ningún servicio cubre todavía (nuevo endpoint sin service formal aún,
  debugging, etc.), igual que en `sabre-rest`.

---

## 5. Nomenclatura y agrupación de servicios

### Base: por API de Sabre + versión (de `sabre-rest`)

```ts
client.bargainFinderMaxV5.search(...)
client.bookingManagementV1.createBooking(...)
client.airlineLookupV1.lookup(...)
```

Sabre publica un OAS por API, versionado de forma independiente. Agrupar
por dominio (`client.flights.search`) esconde qué API y qué versión se
está llamando realmente, y esa ambigüedad se vuelve insostenible en cuanto
Sabre publica una v6 de algo. Este es el motivo por el que `sabre-rest`
elige agrupar así, y es correcto: es la única forma de que dos versiones
convivan sin ambigüedad durante una migración.

Nombres hand-curated (no derivados mecánicamente del `info.title` del OAS
ni de la ruta), carpeta en kebab-case con el mismo nombre:
`src/services/bargain-finder-max-v5/`.

### Capa opcional de conveniencia por dominio (nueva propuesta)

`sabre-client` acertó en la ergonomía: `sabre.search.shop(...)`,
`sabre.booking.create(...)` es más legible para quien no vive y respira las
convenciones de nomenclatura de Sabre. La forma de tener ambas cosas sin
repetir el error de esconder la versión es una **capa de alias fina,
explícitamente marcada como azúcar sintáctico**, construida sobre los
mismos objetos de servicio — nunca una reimplementación:

```ts
export interface SabreClient {
  readonly bargainFinderMaxV5: BargainFinderMaxV5Service;
  readonly bookingManagementV1: BookingManagementV1Service;
  // ...

  /**
   * Alias de conveniencia agrupados por dominio de negocio. Cada
   * propiedad es una referencia directa al servicio versionado
   * correspondiente — no hay lógica ni estado propio aquí. Preferir la
   * forma versionada (`bargainFinderMaxV5`) en código de librería o
   * cuando la versión importa explícitamente; usar `domains` solo como
   * atajo legible en código de aplicación.
   */
  readonly domains: {
    readonly flights: {
      readonly search: BargainFinderMaxV5Service;
      readonly booking: BookingManagementV1Service;
    };
    readonly hotels: {
      readonly search: HotelSearchV2Service;
      readonly avail: GetHotelAvailV5Service;
    };
  };
}
```

Cuando Sabre publique una v6 de BFM, `domains.flights.search` se reapunta
en una sola línea del factory (una decisión consciente y documentada, no
una elección automática) mientras `bargainFinderMaxV5` sigue disponible
para quien necesite la versión anterior explícitamente durante la
migración. Este nivel es aditivo y nunca reemplaza la base versionada.

### Dos versiones de OAuth conviven

Igual que en `sabre-rest`: `createOAuthV2` y `createOAuthV3` como factories
separadas (nunca una sola `createOAuth({ version })` con union types que
degradan el autocompletado). Ver §8 para el detalle de por qué v2 necesita
además dos *esquemas de credenciales* distintos.

---

## 6. Capa HTTP: cadena de middleware

Adoptar tal cual el diseño de `sabre-rest`:

```ts
type Middleware = (
  req: SabreRequest,
  next: (req: SabreRequest) => Promise<SabreResponse>,
) => Promise<SabreResponse>;
```

- Cadena invocada outermost-first; el terminador (`fetch` real) no es
  middleware porque no llama a `next` — tratarlo como tal mentiría sobre
  su forma.
- Tipos de request/response **desacoplados de `fetch`** (`Record<string,
  string>` para headers, `body` ya serializado) para que un middleware
  pueda inspeccionar/modificar sin tocar objetos específicos de transporte.
- Cadena por defecto: `[...middleware del consumidor] → retry → timeout →
  errorMap → auth → fetch` (ver §7 para justificar por qué `retry` y
  `timeout` se agregan a la cadena por defecto respecto a `sabre-rest`,
  que hoy solo trae `errorMap` y `auth`).
- `overrideMiddleware: true` para control total; incompatible con pasar
  `auth` (opt-out total, no una mezcla ambigua). Los building blocks
  (`createAuthMiddleware`, `createErrorMappingMiddleware`,
  `createRetryMiddleware`, `createTimeoutMiddleware`) se exportan para que
  quien haga override pueda recomponer.

---

## 7. Timeouts y reintentos (hueco nuevo, ninguno de los dos proyectos lo resuelve del todo)

`sabre-rest` ya traduce un `AbortError` del `fetch` terminador en
`SabreTimeoutError`, pero no hay ningún mecanismo que **produzca** ese
abort — depende de que cada consumidor arme su propio `AbortSignal` y lo
pase por servicio. Sin un timeout por defecto, una API de Sabre que cuelgue
cuelga la petición del consumidor indefinidamente.

### Decisión

- `SabreClientOptions.timeoutMs` (default razonable, p. ej. 30_000) crea un
  `createTimeoutMiddleware(timeoutMs)` instalado por defecto en la cadena,
  justo por fuera del terminador.
- Cada llamada de servicio puede pasar su propio `signal` (o un
  `timeoutMs` puntual) que se combina con el del cliente vía
  `AbortSignal.any([...])` (disponible desde Node 20+): el primero en
  dispararse gana.
- Reintentos: `createRetryMiddleware({ retries, retryOn, backoff })`
  instalado por defecto con una política conservadora (solo
  `SabreNetworkError` y 5xx idempotentes — nunca reintentar POST de
  creación de reserva/emisión de boletos sin que el consumidor lo pida
  explícitamente, para no duplicar side effects). Igual que `auth` y
  `errorMap`, es un building block exportado y reemplazable.

### Por qué

- Sin timeout por defecto, cada consumidor reinventa (o peor, olvida
  reinventar) protección contra cuelgues — es exactamente el tipo de
  comportamiento transversal que la cadena de middleware ya existe para
  resolver una sola vez.
- Los reintentos son la otra mitad de la misma preocupación de
  resiliencia y encajan en la misma forma sin ampliar la superficie
  conceptual (siguen siendo `Middleware`).

### Alternativas rechazadas

- **Dejar timeout/retry completamente fuera de la librería** (postura
  actual de `sabre-rest`). Válido para un MVP, pero es justo el tipo de
  comportamiento que todo consumidor de producción termina necesitando —
  mejor resolverlo una vez, bien, con un default sensato y overridable.
- **Timeout hardcodeado sin opción de configurarlo.** Las operaciones de
  Sabre varían mucho en latencia esperada (un lookup de aerolíneas vs. un
  BFM con múltiples orígenes/destinos); un solo valor fijo no sirve para
  todas.

---

## 8. Autenticación

### Interfaces base (de `sabre-rest`, sin cambios)

```ts
interface TokenProvider {
  getToken(): Promise<string>;
  invalidate(): Promise<void>;
}

interface TokenStore {
  get(): Promise<StoredToken | null>;
  set(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
  withLock<T>(fn: () => Promise<T>): Promise<T>;
}

interface StoredToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}
```

- Refresh **proactivo** (chequeo de expiración local con skew configurable,
  default 60s) con **fallback a 401** (un reintento tras `invalidate()`).
- `withLock` soporta despliegues distribuidos (Redis u otro) sin que el
  provider sepa nada de clustering — el store resuelve el *thundering
  herd*.
- Store en memoria por defecto; pluggable sin tocar el provider.

### Dos esquemas de credenciales para v2 (fusión — hueco real en ambos proyectos)

Sabre expone su token endpoint v2 (`/v2/auth/token`, `grant_type=client_credentials`)
aceptando **dos formas distintas de construir el header `Authorization:
Basic ...`**, según el tipo de cuenta:

1. **Esquema EPR (usuario/contraseña/PCC)** — el que ya implementa
   `sabre-client`: el "user id" es
   `base64("V1:" + username + ":" + pcc + ":" + domain)`, y el secreto es
   `base64(userId + ":" + base64(password))`.
2. **Esquema `clientId`/`clientSecret`** — el que ya implementa
   `sabre-rest`: doble base64,
   `base64(base64(clientId) + ":" + base64(clientSecret))`.

Ninguno de los dos proyectos cubre el otro esquema. El SDK final necesita
ambos porque son formas de autenticación real y activamente usadas según
el tipo de entitlement que Sabre le dé a cada cuenta — no es una decisión
de diseño interna, es una realidad de la API. Se resuelve con un único
`createOAuthV2` que acepta una unión discriminada de credenciales:

```ts
export type OAuthV2Credentials =
  | { type: 'client'; clientId: string; clientSecret: string }
  | { type: 'user'; username: string; password: string; pcc: string; domain?: string };

export interface OAuthV2Options {
  baseUrl: string;
  credentials: OAuthV2Credentials;
  store?: TokenStore;
  expirySkewMs?: number;
}

export function createOAuthV2(opts: OAuthV2Options): TokenProvider;
```

Internamente, cada rama de la unión resuelve a su propia función de
codificación del header (`encodeClientCredentials` /
`encodeUserCredentials`); el resto del provider (refresh, store, locking,
manejo de errores) es idéntico e independiente del esquema.

### v3 (password grant, de `sabre-client`)

`createOAuthV3` cubre `grant_type=password` (usuario/PCC/dominio +
contraseña en el body, no en el header). Se implementa como un segundo
`TokenProvider` independiente — nunca una rama más dentro de
`createOAuthV2` — porque el endpoint, el shape del request y los casos
límite difieren lo suficiente como para que forzarlos a compartir código
sea peor que dos factories separadas y simples.

### Por qué esta separación (heredado de `sabre-rest`)

- Separación proveedor/almacenamiento: el proveedor sabe *cómo* obtener un
  token; el store sabe *dónde* vive. Evolucionan independientemente.
- `instanceof`/discriminated union en vez de un solo factory con flags:
  las opciones de cada esquema difieren lo suficiente en forma
  (usuario+PCC vs. clientId+secret) como para que una unión aplanada
  ensucie el autocompletado.

---

## 9. Cabeceras transversales por defecto

`sabre-client` ya resuelve algo que `sabre-rest` no modela: Sabre
recomienda enviar `User-Agent` y `Conversation-ID` para poder rastrear
llamadas en soporte. El nuevo cliente instala estas cabeceras por defecto
en la cadena (antes de `auth`, para que cualquier middleware de logging
externo también las vea):

```ts
const defaultHeaders = {
  'User-Agent': `sabre-sdk-node/${version}`,
  'Conversation-ID': crypto.randomUUID(), // uno por instancia de cliente, no por request
};
```

- Overridable por opción del constructor (`userAgent`, `conversationId`) y
  por variable de entorno en el borde de la aplicación (CLI/scripts), no
  dentro del propio factory — ver §10.
- Un middleware, no un caso especial: `createDefaultHeadersMiddleware(...)`
  se instala junto a `auth`/`errorMap`/`retry`/`timeout`.

---

## 10. Configuración del cliente

### `baseUrl` explícito, sin adivinar entorno (de `sabre-rest`)

```ts
export const SabreBaseUrls = Object.freeze({
  cert: 'https://api.cert.platform.sabre.com',
  prod: 'https://api.platform.sabre.com',
});

createSabreClient({ baseUrl: SabreBaseUrls.cert, /* ... */ });
```

`createSabreClient` **exige** `baseUrl`; no hay default ni lógica de
`NODE_ENV`. Olvidar contra qué entorno se apunta es una clase de bug que
el diseño hace imposible: cada sitio de construcción lleva la URL al lado,
o una constante a un clic de la URL.

### El fallback a variables de entorno vive en el borde, no en el factory (matiz sobre `sabre-client`)

`sabre-client` resuelve credenciales faltantes leyendo `process.env`
directamente dentro del constructor del cliente. Es cómodo para scripts,
pero mezcla dos responsabilidades: *construir* el cliente y *descubrir*
configuración. El SDK final mantiene el factory puro (recibe solo lo que
se le pasa, falla rápido y con mensaje descriptivo si falta algo) y ofrece
el azúcar de entorno como una función explícita y opcional, separada, para
quien la quiera — típicamente CLIs y scripts, exactamente el caso de uso
que `sabre-client` resolvía:

```ts
export function credentialsFromEnv(): OAuthV2Credentials { /* ... */ }
```

Este helper vive en el paquete (o en un sub-path `sabre-sdk/env`) pero
nunca se ejecuta implícitamente dentro de `createSabreClient` u
`createOAuthV2` — el consumidor decide explícitamente llamarlo.

### Por qué

- Mantiene el principio "configuración explícita en el punto de
  construcción" (§2.5) sin perder la comodidad de `.env` que hacía
  productivo a `sabre-client` para scripts y para la CLI provisional.
- Un error de configuración se detecta en la construcción, con un mensaje
  que incluye un ejemplo de uso correcto (patrón que ya tiene
  `sabre-client` y vale la pena conservar tal cual).

---

## 11. Errores

### Jerarquía (de `sabre-rest`)

```
SabreError                       (base)
├── SabreApiResponseError        (Sabre devolvió una respuesta no-2xx)
├── SabreAuthenticationError     (falló el flujo de auth)
├── SabreNetworkError            (fetch lanzó — sin respuesta)
├── SabreTimeoutError            (la petición excedió su deadline)
└── SabreParseError              (el cuerpo 2xx no se pudo parsear)
```

- Discriminación por `instanceof` (Node-only, sin necesidad de un campo
  `code` para cruzar realms).
- `cause` (opción estándar de `Error`, Node 16.9+) preserva la causa real
  sin filtrar su tipo en la firma pública.
- `SabreApiResponseError` conserva `statusCode: number` y
  `responseBody: unknown` **sin** normalizar un `errors[]` — los sobres de
  error de Sabre varían demasiado entre APIs (`{ errors: [...] }` en unas,
  `OTA_AirLowFareSearchRS.Errors.Error[]` en las OTA-style) como para que
  una normalización premature no termine mintiendo sobre casos que aún no
  se han visto.

### Extensión propuesta: normalizadores opcionales por familia (aditivo, no baked-in)

En vez de forzar un `errors[]` normalizado dentro de la clase base (que
`sabre-rest` correctamente evita), exponer funciones puras y opcionales
que extraen la forma común **cuando se conoce la familia de API**:

```ts
export function extractOtaErrors(err: SabreApiResponseError): OtaError[] | undefined;
export function extractRestErrors(err: SabreApiResponseError): RestError[] | undefined;
```

Cada servicio documenta en su JSDoc cuál extractor aplica a sus errores.
Esto da ergonomía sin comprometer el minimalismo de la clase base ni
inventar una normalización antes de tener evidencia real de todos los
sobres — exactamente el criterio que ya usa `decisions.md` de
`sabre-rest` para rechazar la normalización temprana, aplicado de forma
no-breaking.

### Reglas duras

- Nunca lanzar un `Error` genérico — siempre la subclase `Sabre*Error`
  apropiada.
- Nunca dejar que `Response`, `Headers` u otro objeto con forma de `fetch`
  aparezca en una clase de error pública.

---

## 12. Tipos generados y capa de mapeo

Tal cual `sabre-rest`, sin cambios — es el patrón más valioso de los dos
proyectos y el que más directamente ataca el problema descrito en
`docs/proyecto.md`: "cada servicio trae su propia especificación OpenAPI
... consumir esas APIs directamente implica trabajar contra tipos
generados [e] inconsistencias entre servicios."

```
src/services/<service-name>/
├── service.ts       # interfaz + implementación Default*
├── mappers.ts       # funciones to* / from*, importadas como `mappers`
└── types.ts         # tipos públicos de entrada/salida
```

- Tipos generados en `src/generated/`, estrictamente internos, nunca
  reexportados.
- Mappers como funciones puras (`toCreateBookingRequest`,
  `fromSearchResponse`, ...), sin DI ni estado, con nombres que siguen el
  verbo/sustantivo natural de la operación — no una derivación mecánica.
- **Reglas de diseño de tipos públicos** (de `sabre-rest`, conservar
  literalmente porque nacieron de bugs de *drift* reales):
  - Compartir un tipo público entre operaciones solo cuando el OAS usa el
    mismo `$ref`. "Mismo ref → compartir; mismo shape hoy → no confiar."
  - La opcionalidad del tipo público refleja el `required:` del OAS. No
    aflojar un campo por si acaso.
  - Si un campo se afloja deliberadamente por una rareza observada en
    CERT, documentarlo inline con un comentario que apunte a un fixture
    de prueba que la reproduce.
- Mantener el changelog de *drift* corregido (`decisions.md` §"Known spec
  drift" de `sabre-rest`) como proceso: cada corrección de drift agrega
  una entrada fechada y con PR, describiendo la ubicación del spec
  malinterpretada y la forma corregida.

---

## 13. Organización de carpetas y specs

```
docs/specifications/<api-name>.yaml     # OAS de Sabre, committeado, YAML o JSON
src/generated/<api-name>.ts             # generado, nunca editado a mano
src/services/<api-name>-v<n>/           # service.ts + mappers.ts + types.ts
scripts/generate-types.mjs              # acepta 0..N basenames como args
```

- Specs versionados en `docs/` (son documentación, no config) —
  committeados para que un diff de spec sea revisable en PR, nunca
  fetcheados on-demand.
- `npm run generate` regenera todo; `npm run generate -- <spec>` regenera
  uno solo — el trabajo día a día toca una API a la vez.
- Swagger 2.0 se convierte in-place a OpenAPI 3.x con `swagger2openapi`
  vía `npx` (sin nueva dependencia) en el momento de intake; se commitea
  el archivo ya convertido, sin mantener un "original" en paralelo.

---

## 14. Convenciones de proyecto

### Módulos y build

- **ESM only**, `"type": "module"`, imports relativos con extensión `.js`
  explícita incluso apuntando a un `.ts`.
- Build con **`tsc` puro**, sin bundler — el paquete es server-side, sin
  dependencias, sin necesidad de tree-shaking ni de un output de un solo
  archivo.

  **Trade-off explícito frente a `sabre-client`:** `sabre-client` publica
  hoy un build dual ESM/CJS vía `tsup` para maximizar compatibilidad con
  consumidores legacy en CommonJS. Elegir `tsc`-solo-ESM significa que
  proyectos CJS no pueden `require()` el paquete directamente (sí pueden
  vía `import()` dinámico). Dado que el target son integraciones
  server-side modernas (Node 20+) y que evitar el dual-publish elimina una
  fuente entera de bugs sutiles de resolución de módulos, esta guía
  recomienda ESM-only como default — pero si el roadmap real incluye
  consumidores CJS conocidos y no migrables, dual-build vía `tsup` sigue
  siendo la mitigación correcta y debe decidirse explícitamente en
  `decisions.md`, no adoptarse por inercia.
- `tsconfig`: `module`/`moduleResolution: NodeNext`, `target: ES2022`,
  `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`. **No**
  `exactOptionalPropertyTypes` (interactúa mal con código generado y con
  patrones de spread comunes).
- `engines.node` fijado explícitamente en `package.json` (y `.nvmrc` a
  juego) al mínimo LTS real que el equipo soporta — no dejarlo implícito.

### Nomenclatura de archivos

Kebab-case para archivos y carpetas; identificadores en código camelCase/
PascalCase como siempre. La carpeta de cada servicio usa la forma
kebab-case del nombre de propiedad camelCase del cliente.

### Lint y formato

Biome para ambos — una sola herramienta, un solo config, sin ecosistema de
plugins que mantener.

---

## 15. Testing

Tres capas, todas necesarias, cada una cubriendo lo que la otra no puede:

1. **Unit tests (vitest)** a nivel de mapper y de servicio — rápidos,
   deterministas, corren en CI en cada PR.
2. **Fixtures de respuestas reales** (patrón `response/*.json` de
   `sabre-client`, formalizado como `test/fixtures/<service>/*.json`):
   respuestas reales capturadas de CERT (anonimizadas si hace falta) que
   alimentan los tests de mapper. Sin esto, un mapper puede pasar sus
   propios tests unitarios y romperse igual contra la forma real que
   Sabre devuelve.
3. **Scripts e2e contra CERT** (`scripts/*.sh` de `sabre-rest`) — la única
   capa que detecta rarezas operativas y de entitlement de cuenta que
   ningún spec ni ningún test unitario puede predecir (el caso
   `designatePrinters`/`PRINTER_NOT_ASSIGNED` documentado en
   `decisions.md` es el ejemplo canónico: el spec no lo dice, el mock no
   lo reproduce, solo CERT real lo revela).

La CLI provisional (presente en ambos proyectos hoy) se mantiene como
herramienta de desarrollo para probar contra servidores reales de Sabre,
nunca como parte de la superficie pública del paquete como librería.

---

## 16. Ejemplos y documentación narrativa

`sabre-client` acierta con `examples/*.ts` ejecutables
(`node --env-file=.env --import=tsx examples/search-shop.ts`) y con guías
de flujo completo como `docs/air-booking-workflow-es.md` (búsqueda →
revalidación → creación de PNR). `sabre-rest` cubre esto con JSDoc denso
por servicio y scripts de shell, que son mejores para probar pero peores
para *leer* como introducción.

El SDK final conserva ambos:

- `examples/` con un script corto y ejecutable por flujo real de negocio,
  con su propio `examples/README.md` explicando cómo correrlos.
- Un doc narrativo por flujo multi-paso importante (reserva aérea,
  reserva de hotel, cambio de boleto) que enlaza a los métodos exactos
  involucrados, en el idioma que use el equipo (los flujos existentes en
  este repo están en español; mantener esa convención si el equipo es
  hispanohablante, sin que eso condicione el idioma del código o del
  JSDoc, que permanece en inglés por convención del ecosistema npm).

---

## 17. Versionado y releases

Adoptar el flujo de `sabre-rest` sin cambios:

- Conventional commits + [release-please](https://github.com/googleapis/release-please).
- El título del PR **es** el conventional commit (squash-merge obligatorio;
  release-please depende de ese flujo).
- `0.1.0` inicial, minor bumps hasta `1.0.0` (breaking changes permitidos
  en minor durante `0.x`, por semántica de semver).
- El workflow de publish corre lint + typecheck + test + build y publica
  con `npm publish --provenance` al mergear el "release PR".
- Criterio de salida de `0.x`: cuando la superficie pública deja de
  cambiar de forma breaking con cada API nueva agregada (ver §19).

---

## 18. Gobernanza de la documentación

Cuatro documentos, cada uno con un rol distinto — este patrón, tomado casi
literal de `sabre-rest`, es en sí mismo una de las decisiones más valiosas
a preservar:

| Documento | Rol | Se actualiza cuando |
|---|---|---|
| `docs/proyecto.md` | Qué es el proyecto, para quién, qué cubre hoy | Cambia el propósito, el dominio o el alcance |
| `AGENTS.md` | Guía operativa corta y táctica para humanos/agentes | Cambia un flujo de trabajo o una convención de commit/branch |
| `docs/architecture.md` | Decisiones **reutilizables** (aplicables a cualquier cliente REST) | Se toma o se revisa una decisión de arquitectura genérica |
| `docs/decisions.md` | Decisiones **específicas de Sabre** (naming, agrupación, quirks de cuenta/entorno) | Se descubre un quirk operativo o se toma una decisión ligada a las APIs concretas de Sabre |

Regla dura: **si una decisión tomada en un PR contradice lo escrito en
estos documentos, el PR actualiza el documento correspondiente en el mismo
cambio.** Los documentos son la fuente de verdad, no un archivo histórico.

---

## 19. Roadmap de cobertura

- El primer corte cubre el flujo de reserva aérea completo (auth → shop →
  revalidate → book → ticket), por ser el que ya está probado en
  `sabre-client` y el que tiene guía narrativa lista para adaptar.
- Cobertura de hotelería y datos de referencia (ya resuelta en
  `sabre-rest`) se incorpora servicio por servicio, cada uno como un PR
  independiente con su propio spec en `docs/specifications/`.
- Cada API/servicio nuevo agregado es un minor bump. La librería sale de
  `0.x` cuando: (a) el flujo aéreo y el de hotelería completos están
  cubiertos, (b) la capa de conveniencia por dominio (§5) ha demostrado no
  necesitar cambios estructurales tras cubrir ambos dominios, y (c) no ha
  habido un breaking change en la superficie pública en al menos una serie
  de releases consecutivos.

---

## 20. Checklist para arrancar el proyecto desde cero

1. `package.json`: ESM-only, `engines.node` explícito, cero dependencias
   de runtime, scripts de `lint`/`typecheck`/`test`/`build`/`generate`.
2. `tsconfig.json` con las flags de §14.
3. Biome configurado (lint + format).
4. Vitest configurado; carpeta `test/fixtures/` creada desde el primer
   servicio.
5. `docs/specifications/` con el primer spec (OAS del flujo aéreo) commited.
6. `scripts/generate-types.mjs` aceptando basenames como args.
7. `src/http/` (tipos + chain + terminador), `src/middleware/` (auth,
   error-mapping, retry, timeout, default-headers).
8. `src/auth/` (`TokenProvider`/`TokenStore`, `createOAuthV2` con ambos
   esquemas de credenciales, `createMemoryTokenStore`).
9. `src/errors/` (jerarquía completa desde el día uno, no agregada
   incrementalmente).
10. Primer servicio end-to-end (generado + mapeado + testeado + expuesto
    en `createSabreClient`) como plantilla para los siguientes.
11. `examples/` con al menos un ejemplo por paso del flujo aéreo.
12. `AGENTS.md`, `docs/architecture.md`, `docs/decisions.md`,
    `docs/proyecto.md` escritos desde el inicio — no retrofitteados tras
    la primera versión.
13. release-please + workflow de publish configurados antes del primer
    tag, no después.
