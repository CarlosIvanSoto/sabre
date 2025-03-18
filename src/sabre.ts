import { GetOptions, PostOptions } from "./common/interfaces";
import { baseUrl, conversationId, domain, userAgent } from "./config";
import { ErrorResponse } from "./interfaces";

export class Sabre {
  private readonly headers: Headers;
  private readonly secret: string;

  constructor(
    private readonly username?: string,
    private readonly password?: string,
    private readonly organization?: string, // PCC
  ) {

    const processEnv = typeof process !== 'undefined' && process.env
    if (!username && processEnv) 
      this.username = processEnv.SABRE_USERNAME
    if (!password && processEnv)
      this.password = processEnv.SABRE_PASSWORD
    if (!organization && processEnv)
      this.organization = processEnv.SABRE_ORGANIZATION

    if (!this.username || !this.password || !this.organization) {
      throw new Error('Missing LegacySabre authorization. Pass it to the constructor `new LegacySabre("USERNAME", "PASSWORD", "ORGANIZATION")')
    }

    this.headers = new Headers({
      'User-Agent': userAgent,
      'Conversation-ID': conversationId
    });

    this.secret = this.getSecret()
  }

  setAuthorization(token: string) {
    this.headers.set('Authorization', `Bearer ${token}`)
    this.headers.set('Content-Type', 'application/json')
  }

  async fetchRequest<T>(
    path: string,
    options = {},
  ): Promise<{ data: T | null; error: ErrorResponse | null }> {
    try {
      const response = await fetch(`${baseUrl}${path}`, options);

      if (!response.ok) {
        try {
          const rawError = await response.text();
          return { data: null, error: JSON.parse(rawError) };
        } catch (err) {
          if (err instanceof SyntaxError) {
            return {
              data: null,
              error: {
                name: 'application_error',
                message:
                  'Internal server error. We are unable to process your request right now, please try again later.',
              },
            };
          }

          const error: ErrorResponse = {
            message: response.statusText,
            name: 'application_error',
          };

          if (err instanceof Error) {
            return { data: null, error: { ...error, message: err.message } };
          }

          return { data: null, error };
        }
      }

      const data = await response.json();
      return { data: data as T, error: null };
    } catch (error) {
      return {
        data: null,
        error: {
          name: 'application_error',
          message: 'Unable to fetch data. The request could not be resolved.',
        },
      };
    }
  }
  async post<T>(path: string, entity?: unknown, options: PostOptions = {}) {
    const requestOptions = {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(entity),
      ...options,
    };

    return this.fetchRequest<T>(path, requestOptions);
  }

  async auth<T>(path: string, entity?: unknown, options: PostOptions = {}) {
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

  private getSecret() {
    if (!this.password) throw new Error('Missing Sabre password')
    return btoa(`${this.userID()}:${btoa(this.password)}`)
  }
  private userID() {
    return btoa(`V1:${this.username}:${this.organization}:${domain}`)
  }
  // security(): SabreSecurity {
  //   return { username: this.username, password: this.password, pcc: this.organization }
  // }
}