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
      let errorDetails =  `Request failed with status ${response.status}`;
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

  async auth<T>(path: string, entity?: unknown, options: PostOptions = {}): Promise<T>  {
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

  private getSecret(): string {
    if (!this.options.password) throw new Error('Missing Sabre password')
    return btoa(`${this.userID()}:${btoa(this.options.password)}`)
  }
  private userID(): string {
    return btoa(`V1:${this.options.username}:${this.options.organization}:${domain}`)
  }
}
