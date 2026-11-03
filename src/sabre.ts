import { Search, Ticketing } from "./air";
import { Authentication } from "./authentication/authentication";
import { Booking, FlightTickets } from "./booking-management";
import { PostOptions } from "./common/interfaces";
import { baseUrl, domain } from "./config";
import { SabreParseError } from "./errors";
import { buildChain } from "./http/chain";
import { Middleware, SabreRequest, SabreResponse } from "./http/types";
import { SabreOptions } from "./interfaces";
import { createAuthMiddleware, createBearerAuthMiddleware } from "./middleware/auth";
import { createDefaultHeadersMiddleware } from "./middleware/default-headers";
import { createErrorMappingMiddleware } from "./middleware/error-mapping";
import { Reservation } from "./trip-management/reservation";

export class Sabre {
  private readonly secret: string;
  private readonly auth_secret: string | null;
  private readonly chain: (req: SabreRequest) => Promise<SabreResponse>;
  private token: string | null = null;
  public readonly grant_type_v2: string;
  public readonly grant_type_v3: string;

  readonly authentication = new Authentication(this)
  readonly booking = new Booking(this)
  readonly flightTickets = new FlightTickets(this)
  readonly search = new Search(this)
  readonly ticketing = new Ticketing(this)
  readonly reservation = new Reservation(this)

  constructor(private readonly options: SabreOptions = {}) {
    const processEnv = typeof process !== 'undefined' && process.env
    if (!this.options.username && processEnv)
      this.options.username = processEnv.SABRE_USERNAME
    if (!this.options.password && processEnv)
      this.options.password = processEnv.SABRE_PASSWORD
    if (!this.options.organization && processEnv)
      this.options.organization = processEnv.SABRE_ORGANIZATION
    if (!this.options.clientId && processEnv)
      this.options.clientId = processEnv.SABRE_CLIENT_ID
    if (!this.options.clientSecret && processEnv)
      this.options.clientSecret = processEnv.SABRE_CLIENT_SECRET

    if (!this.options.username || !this.options.password || !this.options.organization) {
      throw new Error(`Missing Sabre authorization. Pass it to the constructor new Sabre({
        username: '773400',
        password: 'PASSWORD_GOES_HERE',
        organization: '7TZA', // pcc
      });})`)
    }

    this.secret = this.getSecret()
    this.auth_secret = this.getAuthSecret()
    this.grant_type_v2 = this.getGrantTypeV2()
    this.grant_type_v3 = this.getGrantTypeV3()

    const middlewares: Middleware[] = [
      createDefaultHeadersMiddleware(),
      createErrorMappingMiddleware(),
      createBearerAuthMiddleware(() => this.token),
    ]
    if (this.options.auth) {
      middlewares.push(createAuthMiddleware(this.options.auth))
    }
    this.chain = buildChain(middlewares)
  }

  setAuthorization(token: string): void {
    this.token = token
  }

  /**
   * Escape hatch: envía una petición cruda por la cadena de middleware
   * configurada (cabeceras por defecto, mapeo de errores, auth bearer).
   * Útil para endpoints que aún no tienen un submódulo propio o para
   * depuración.
   */
  request(req: SabreRequest): Promise<SabreResponse> {
    return this.chain(req)
  }

  private async runRequest<T>(req: SabreRequest): Promise<T> {
    const res = await this.chain(req)
    try {
      return JSON.parse(res.body) as T
    } catch (err) {
      throw new SabreParseError(
        `Could not parse response body from ${req.url} as JSON`,
        res.body,
        { cause: err },
      )
    }
  }

  async post<T>(path: string, entity?: unknown, _options: PostOptions = {}): Promise<T> {
    const req: SabreRequest = {
      method: 'POST',
      url: `${baseUrl}${path}`,
      headers: { 'Content-Type': 'application/json' },
      body: entity === undefined ? undefined : JSON.stringify(entity),
    };

    return this.runRequest<T>(req);
  }

  async auth<T>(path: string, entity?: unknown, _options: PostOptions = {}): Promise<T> {
    /**
     * La palabra 'basic' seguida de un EPR codificado en base64
     * como par base64(base64(V1:usuario:grupo:dominio):base64(contraseña)),
     * p.e. basic VmpFNmRYTmxjbWxrT21keWIzVndPbVJ2YldGcGJnPT06TVRJek5EVT0=
     */
    const req: SabreRequest = {
      method: 'POST',
      url: `${baseUrl}${path}`,
      headers: {
        'Authorization': `Basic ${this.secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: entity as string | undefined,
    };

    return this.runRequest<T>(req);
  }

  async authClient<T>(path: string, entity?: unknown, _options: PostOptions = {}): Promise<T> {
    /**
     * Credenciales de clientId codificadas con el algoritmo base64
     * pasadas como encabezado de autorización (Authorization: Basic base64(cliendId:clientSecret))
     */
    if (!this.auth_secret) throw new Error('Missing Sabre client id or client secret')
    const req: SabreRequest = {
      method: 'POST',
      url: `${baseUrl}${path}`,
      headers: {
        'Authorization': `Basic ${this.auth_secret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: entity as string | undefined,
    };

    return this.runRequest<T>(req);
  }

  private getSecret(): string {
    if (!this.options.password) throw new Error('Missing Sabre password')
    return btoa(`${this.userID()}:${btoa(this.options.password)}`)
  }
  private userID(): string {
    return btoa(`V1:${this.options.username}:${this.options.organization}:${domain}`)
  }

  private getGrantTypeV2(): string {
    const grantType = new URLSearchParams()
    grantType.set('grant_type', 'client_credentials')
    return grantType.toString()
  }

  private getGrantTypeV3(): string {
    if (!this.options.password) throw new Error('Missing Sabre password')
    const grantType = new URLSearchParams()
    grantType.set('grant_type', 'password')
    grantType.set('username', `${this.options.username}-${this.options.organization}-${domain}`)
    grantType.set('password', this.options.password)
    return grantType.toString()
  }

  private getAuthSecret(): string | null {
    if (!this.options.clientId || !this.options.clientSecret) return null
    return btoa(`${this.options.clientId}:${this.options.clientSecret}`)
  }
}
