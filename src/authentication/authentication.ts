import { Sabre } from "../sabre";
import { CreateTokenRequestOptions, CreateTokenResponseSuccess } from "./interfaces/create-token.interface";

const grantType = new URLSearchParams({ 'grant_type': 'client_credentials' }).toString()

export class Authentication {
  constructor(private readonly sabre: Sabre) {}
  /**
   * V2 AUTH TOKEN
   * See https://developer.sabre.com/docs/rest_apis/session_management/token_create_api/v2
   * @param payload El tipo de concesión utilizado para obtener el token. Sólo se admiten 'client_credentials'.
   * @param options CreateTokenRequestOptions
   * @returns TokenResponse
   */
  async OAuthTokenV2(
    payload: string = grantType,
    options: CreateTokenRequestOptions = {},
  ): Promise<CreateTokenResponseSuccess> {
    const data = await this.sabre.auth<CreateTokenResponseSuccess>(
      '/v2/auth/token',
      payload,
      options
    );
    this.sabre.setAuthorization(data.access_token)
    return data
  }
}