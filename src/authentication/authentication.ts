import { Sabre } from "../sabre";
import { CreateTokenResponseSuccess } from "./interfaces";

export class Authentication {
  constructor(private readonly sabre: Sabre) { }
  /**
   * OAuth Token Create REST API v2
   * See https://developer.sabre.com/docs/rest_apis/session_management/token_create_api/v2
   * @param payload El tipo de concesión utilizado para obtener el token. Sólo se admiten 'client_credentials'.
   * @returns TokenResponse
   */
  async OAuthTokenV2(
    payload: string = this.sabre.grant_type_v2
  ): Promise<CreateTokenResponseSuccess> {
    const data = await this.sabre.auth<CreateTokenResponseSuccess>(
      '/v2/auth/token',
      payload
    );
    this.sabre.setAuthorization(data.access_token)
    return data
  }
  /**
   * OAuth Token Create REST API v3
   * See https://developer.sabre.com/rest-api/oauth-token-create-rest-api/v3/index.html
   * @param payload El tipo de concesión utilizado para obtener el token. grant_type=password&username={{username}}-{{pcc}}-AA&password={{password}}.
   * @returns TokenResponse
   */
  async OAuthTokenV3(
    payload: string = this.sabre.grant_type_v3
  ): Promise<CreateTokenResponseSuccess> {
    const data = await this.sabre.authClient<CreateTokenResponseSuccess>(
      '/v3/auth/token',
      payload
    );
    this.sabre.setAuthorization(data.access_token)
    return data
  }
}