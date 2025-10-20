import { Sabre } from "../sabre";
import { CreateTokenResponseSuccess } from "./interfaces";

const grantType = new URLSearchParams({ 'grant_type': 'client_credentials' }).toString()

export class Authentication {
  constructor(private readonly sabre: Sabre) {}
  /**
   * OAuth Token Create REST API v2
   * See https://developer.sabre.com/docs/rest_apis/session_management/token_create_api/v2
   * @param payload El tipo de concesión utilizado para obtener el token. Sólo se admiten 'client_credentials'.
   * @returns TokenResponse
   */
  async OAuthTokenV2(
    payload: string = grantType
  ): Promise<CreateTokenResponseSuccess> {
    const data = await this.sabre.auth<CreateTokenResponseSuccess>(
      '/v2/auth/token',
      payload
    );
    this.sabre.setAuthorization(data.access_token)
    return data
  }
}