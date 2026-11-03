# Decisiones Arquitectónicas Reutilizables

Este documento describe los **patrones de diseño** usados en este proyecto para construir un
SDK/cliente de API en TypeScript. Está escrito de forma genérica para poder reutilizarse como
plantilla en otros clientes de API, independientemente del proveedor concreto que se esté
integrando.

## 1. Cliente facade con submódulos inyectados

**Patrón:** una clase central (`Client`) concentra el estado compartido (headers, credenciales,
tokens) y expone las operaciones de transporte HTTP de bajo nivel. Los recursos de la API se
modelan como clases separadas ("submódulos"), una por dominio funcional, que reciben la instancia
del cliente por constructor y se apoyan en sus métodos de transporte para hacer las peticiones.

```ts
class Client {
  readonly resourceA = new ResourceA(this)
  readonly resourceB = new ResourceB(this)

  constructor(options: ClientOptions) { /* ... */ }

  async post<T>(path: string, body?: unknown): Promise<T> { /* ... */ }
}

class ResourceA {
  constructor(private readonly client: Client) {}

  async doSomething(payload: Payload): Promise<Response> {
    return this.client.post<Response>('/path', payload)
  }
}
```

**Por qué:** evita una "clase dios" con todos los métodos de la API, mientras cada submódulo
sigue teniendo acceso al transporte y al estado de autenticación sin duplicarlo. El consumidor
final navega la API de forma descubrible: `client.resourceA.doSomething(...)`.

**Cuándo aplicar:** SDKs que envuelven APIs con múltiples dominios/recursos (auth, búsqueda,
reservas, facturación, etc.) donde cada dominio tiene varios métodos relacionados.

## 2. Organización por dominio (feature folders)

**Patrón:** el código fuente se organiza por dominio funcional, no por tipo técnico. Cada carpeta
de dominio contiene su propia lógica y sus propios tipos, con un barrel `index.ts` que reexporta
la superficie pública del dominio.

```
src/
  <dominio-a>/
    index.ts              # barrel: export * from "./resource-x"
    resource-x.ts
    interfaces/
      index.ts            # barrel de tipos del dominio
      resource-x.interface.ts
  <dominio-b>/
    ...
  common/
    interfaces/           # tipos compartidos entre dominios (ej. opciones de request)
```

**Por qué:** mantiene cada dominio autocontenido (código + tipos), facilita añadir un nuevo
dominio sin tocar los existentes, y permite reexportar selectivamente solo lo público desde el
`index.ts` raíz del paquete.

## 3. Cadena de middleware HTTP con tipos desacoplados de `fetch`

**Patrón:** el transporte deja de ser un único método privado (`fetchRequest`) y pasa a ser una
cadena de funciones `Middleware` compuestas outermost-first sobre un terminador que hace el
`fetch` real. Los tipos de petición/respuesta que ve cada middleware (`SabreRequest`,
`SabreResponse`) son planos y están desacoplados de `Request`/`Response`/`Headers` nativos —
`headers` es un `Record<string, string>` propio de cada petición, no una instancia compartida.

```ts
type Middleware = (
  req: SabreRequest,
  next: (req: SabreRequest) => Promise<SabreResponse>,
) => Promise<SabreResponse>

function buildChain(middlewares: readonly Middleware[]): (req: SabreRequest) => Promise<SabreResponse> {
  const dispatch = (i: number, req: SabreRequest): Promise<SabreResponse> =>
    i >= middlewares.length ? terminator(req) : middlewares[i](req, (next) => dispatch(i + 1, next))
  return (req) => dispatch(0, req)
}
```

Los métodos públicos (`post`, `auth`, `authClient`) quedan como constructores delgados de
`SabreRequest` que delegan en la cadena; el manejo de cabeceras por defecto, autenticación y
mapeo de errores se separan en middlewares independientes (`createDefaultHeadersMiddleware`,
`createBearerAuthMiddleware`, `createErrorMappingMiddleware`) en vez de vivir todos dentro del
mismo método.

**Por qué:** cada preocupación transversal (cabeceras, auth, errores, y más adelante timeouts o
reintentos) se vuelve una unidad componible y testeable de forma aislada, en lugar de lógica
entrelazada dentro de un solo método de transporte. Al no compartir un objeto `Headers` mutable
entre peticiones, dos llamadas concurrentes con esquemas de autenticación distintos (p. ej. Basic
para el endpoint de token y Bearer para el resto de la API) no se pisan los headers entre sí.

**Cuándo aplicar:** cuando una misma API expone varios esquemas de autenticación o variantes de
request (form-urlencoded vs JSON, Basic vs Bearer), o cuando se anticipa necesitar más
comportamiento transversal (timeouts, reintentos, logging) sin seguir apilando lógica dentro del
método de transporte.

## 4. Estado de autenticación como valor leído por un getter, no mutación compartida

**Patrón:** el cliente expone un método explícito (`setAuthorization(token)`) que actualiza un
campo privado del cliente. El middleware de autenticación no recibe el valor directamente sino un
getter (`() => this.token`), porque la cadena se arma una sola vez en el constructor y el token
llega después, tras un login exitoso.

**Por qué:** evita pasar el token manualmente entre llamadas — el estado de sesión vive en un solo
lugar y se actualiza mediante una API explícita — sin necesitar un objeto de transporte mutable
compartido entre peticiones concurrentes (ver §3).

## 5. Jerarquía de errores tipada con una base compatible hacia atrás

**Patrón:** una clase base (`SabreError`) que extiende `Error` con campos estructurados
opcionales (`statusCode`, `details`) más `cause` (para preservar la causa original sin filtrar
tipos de transporte en la firma pública), y subclases que especializan por categoría de fallo
(`SabreApiResponseError`, `SabreAuthenticationError`, `SabreNetworkError`, `SabreTimeoutError`,
`SabreParseError`).

```ts
class SabreError extends Error {
  readonly statusCode?: number
  readonly details?: string
  constructor(message: string, statusCode?: number, details?: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SabreError'
    this.statusCode = statusCode
    this.details = details
  }
}

class SabreApiResponseError extends SabreError { readonly responseBody?: unknown /* ... */ }
class SabreNetworkError extends SabreError { /* fetch lanzó, sin respuesta */ }
class SabreTimeoutError extends SabreError { /* abort/deadline */ }
```

**Por qué:** permite a los consumidores discriminar por `instanceof` entre fallos de red, timeout,
parseo y respuesta no-2xx, en vez de inspeccionar un `statusCode` genérico. Mantener
`statusCode`/`details` como parámetros opcionales en la base (en vez de una firma limpia
`(message, { cause })`) es una decisión deliberada de compatibilidad: permite introducir la
jerarquía como cambio aditivo sin romper código existente que construía o atrapaba el error único
anterior.

## 6. Configuración isomórfica con defaults y override por entorno

**Patrón:** valores de configuración (URL base, user agent, IDs de correlación) se definen como
constantes con un valor por defecto, sobreescribibles por variable de entorno, protegiendo el
acceso a `process.env` para no romper en entornos sin Node (browser/edge).

```ts
const value =
  typeof process !== 'undefined' && process.env
    ? process.env.MY_VAR || defaultValue
    : defaultValue
```

**Por qué:** el mismo código funciona en Node y en entornos sin `process` (bundlers de browser),
y permite a cada consumidor sobreescribir configuración sin tocar código.

## 7. Fallback de opciones del constructor a variables de entorno + fail-fast

**Patrón:** el constructor del cliente acepta un objeto de opciones; por cada campo requerido que
no venga explícito, se intenta completar desde `process.env`. Si tras el fallback siguen
faltando campos obligatorios, se lanza un error inmediato y descriptivo (incluyendo un ejemplo de
uso correcto) en vez de fallar más adelante con un error críptico de red.

**Por qué:** permite tanto configuración explícita (tests, múltiples instancias) como
configuración implícita vía `.env` (uso típico en scripts/CLIs), detectando errores de setup en
el punto de construcción en lugar de en medio de una petición HTTP.

## 8. Barrel de entrada pública selectivo

**Patrón:** el `index.ts` raíz del paquete solo reexporta la clase principal del cliente y los
**tipos** de cada dominio (`export * from './dominio/interfaces'`), nunca las clases internas de
los submódulos ni la lógica de transporte. Los tipos se consumen para tipar payloads/responses,
pero la única forma de ejecutar operaciones es a través de la instancia del cliente principal.

**Por qué:** mantiene una superficie pública mínima y explícita; refactors internos de los
submódulos no rompen el contrato público mientras el barrel no cambie.

## 9. Build dual ESM/CJS con tipos generados

**Patrón:** el empaquetado (ej. con `tsup`) genera salidas `esm` y `cjs` desde un único entry
point, con generación de `.d.ts`, sourcemaps y limpieza del directorio de salida en cada build.
El `package.json` declara el mapeo `exports` con `import`/`require` apuntando a cada variante.

```ts
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
})
```

**Por qué:** el paquete es consumible tanto desde proyectos ESM como CJS sin configuración
adicional por parte del consumidor.

## 10. Documentación embebida con enlace a la fuente de verdad externa

**Patrón:** cada método público lleva un JSDoc breve que explica su propósito de negocio y enlaza
a la documentación oficial de la API externa que representa, en vez de reexplicar el contrato
completo en comentarios.

**Por qué:** mantiene el código como referencia rápida mientras delega el detalle exhaustivo
(campos, límites, ejemplos) a la documentación oficial, evitando duplicación que se desactualiza.

## 11. Autenticación opt-in con proveedor/almacén separados y double-checked locking

**Patrón:** la obtención de credenciales (`TokenProvider`: sabe *cómo* pedir un token a un
endpoint concreto) se separa de dónde vive el resultado cacheado (`TokenStore`: sabe *dónde* vive
y provee un primitivo de lock). Un middleware de auth (`createAuthMiddleware(provider)`) consume
el provider sin saber nada de HTTP de bajo nivel para obtenerlo.

```ts
interface TokenProvider { getToken(): Promise<string>; invalidate(): Promise<void> }
interface TokenStore {
  get(): Promise<StoredToken | null>
  set(token: StoredToken): Promise<void>
  clear(): Promise<void>
  withLock<T>(fn: () => Promise<T>): Promise<T>
}
```

`getToken()` sigue un **double-checked locking**: primero chequea la cache sin tomar el lock (el
camino frecuente, sin costo de sincronización); si hace falta refrescar, entra al lock y **vuelve a
chequear la cache dentro de él** antes de golpear la red, porque otro llamador concurrente pudo
haber ganado la carrera y dejado un token fresco mientras se esperaba el turno. Solo entonces se
pide un token nuevo. Esto evita que N peticiones concurrentes con un token vencido disparen N
llamadas al endpoint de autenticación (*thundering herd*).

Cada esquema de credenciales (usuario/contraseña, `clientId`/`clientSecret`, distintos endpoints
de token) es una **factory independiente** que construye su propio provider (`createOAuthV2`,
`createOAuthV3`), nunca una rama condicional dentro de un factory genérico — el endpoint, la forma
del request y los casos límite de cada esquema difieren lo suficiente como para que compartir
código entre ellos cueste más de lo que ahorra.

**La pieza de auth es opt-in**, no reemplaza el mecanismo manual existente (§4): el consumidor
sigue pudiendo fijar un token a mano, y ese valor manual tiene precedencia sobre el provider
automático. Esto permite introducir refresh automático como aditivo, sin cambiar el
comportamiento por defecto de quien no lo pide.

**Por qué:** sin esta separación, cada cliente de larga vida reinventa (o, más común, ignora) la
expiración de token, y un despliegue multi-instancia sin locking compartido multiplica llamadas al
endpoint de autenticación de forma innecesaria — exactamente el tipo de comportamiento transversal
que vale la pena resolver una sola vez detrás de una interfaz chica.

**Cuándo aplicar:** clientes de API con tokens de vida corta/media que se usan desde procesos de
larga duración o desde múltiples instancias concurrentes.

---

## Resumen de aplicabilidad

Estos patrones son más útiles cuando el proyecto es **un SDK/wrapper de una API HTTP externa**
con:
- Múltiples dominios/recursos.
- Más de un esquema de autenticación o flujo de token.
- Necesidad de distribuirse como paquete npm consumible desde Node y bundlers.

No son necesarios (y serían sobre-ingeniería) para una API interna simple de un solo endpoint o
un script de un solo uso.
