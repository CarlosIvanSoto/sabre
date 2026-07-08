import { Search, Ticketing } from "./air";
import { Authentication } from "./authentication/authentication";
import { Booking, FlightTickets } from "./booking-management";
import { PostOptions } from "./common/interfaces";
import { baseUrl, conversationId, domain, userAgent } from "./config";
import { SabreError } from "./errors";
import { SabreOptions } from "./interfaces";
import { Reservation } from "./trip-management/reservation";

export class Sabre {
  private readonly headers: Headers;
  private readonly secret: string;
  private readonly auth_secret: string | null;
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

    this.headers = new Headers({
      'User-Agent': userAgent,
      'Conversation-ID': conversationId
    });

    this.secret = this.getSecret()
    this.auth_secret = this.getAuthSecret()
    this.grant_type_v2 = this.getGrantTypeV2()
    this.grant_type_v3 = this.getGrantTypeV3()
  }

  setAuthorization(token: string): void {
    this.headers.set('Authorization', `Bearer ${token}`)
    this.headers.set('Content-Type', 'application/json')
  }

  async fetchRequest<T>(
    path: string,
    options = {},
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, options);

    if (!response.ok) {
      let errorDetails = `Request failed with status ${response.status}`;
      try {
        const jsonError = await response.json() as unknown;
        errorDetails = JSON.stringify(jsonError);
      } catch (e) {
        console.error(e)
        errorDetails = response.statusText;
      }
      throw new SabreError(
        `Request failed with status ${response.status}`,
        response.status,
        errorDetails);
    }

    const data = await response.json() as T;
    return data;
  }
  async post<T>(path: string, entity?: unknown, options: PostOptions = {}): Promise<T> {
    const requestOptions = {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(entity),
      ...options,
    };

    return this.fetchRequest<T>(path, requestOptions);
  }

  async auth<T>(path: string, entity?: unknown, options: PostOptions = {}): Promise<T> {
    /**
     * La palabra 'basic' seguida de un EPR codificado en base64 
     * como par base64(base64(V1:usuario:grupo:dominio):base64(contraseña)), 
     * p.e. basic VmpFNmRYTmxjbWxrT21keWIzVndPbVJ2YldGcGJnPT06TVRJek5EVT0=
     */
    this.headers.set('Authorization', `Basic ${this.secret}`)
    this.headers.set('Content-Type', 'application/x-www-form-urlencoded')

    const requestOptions = {
      method: 'POST',
      headers: this.headers,
      body: entity,
      ...options,
    };

    return this.fetchRequest<T>(path, requestOptions);
  }
  async authClient<T>(path: string, entity?: unknown, options: PostOptions = {}): Promise<T> {
    /**
     * Credenciales de clientId codificadas con el algoritmo base64 
     * pasadas como encabezado de autorización (Authorization: Basic base64(cliendId:clientSecret))
     */
    if (!this.auth_secret) throw new Error('Missing Sabre client id or client secret')
    this.headers.set('Authorization', `Basic ${this.auth_secret}`)
    this.headers.set('Content-Type', 'application/x-www-form-urlencoded')

    const requestOptions = {
      method: 'POST',
      headers: this.headers,
      body: entity,
      ...options,
    };
    console.log(requestOptions)

    return this.fetchRequest<T>(path, requestOptions);
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
