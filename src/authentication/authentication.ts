import { Sabre } from "../sabre";
import { CreateTokenRequestOptions, CreateTokenResponse, CreateTokenResponseSuccess } from "./interfaces/create-token.interface";

const grantType = new URLSearchParams({ 'grant_type': 'client_credentials' }).toString()

export class Authentication {
  constructor(private readonly sabre: Sabre) {}
  /**
   * V2 AUTH TOKEN
   * @param auth La palabra 'basic' seguida de un EPR codificado en base64 como par base64(base64(V1:usuario:grupo:dominio):base64(contraseña)), p.e. basic VmpFNmRYTmxjbWxrT21keWIzVndPbVJ2YldGcGJnPT06TVRJek5EVT0=
   * @param gt El tipo de concesión utilizado para obtener el token. Sólo se admiten 'client_credentials'.
   * @returns TokenResponse
   */
  async OAuthTokenV2(
    payload: string = grantType,
    options: CreateTokenRequestOptions = {},
  ): Promise<CreateTokenResponse> {
    const response = await this.sabre.auth<CreateTokenResponseSuccess>(
      '/v2/auth/token',
      payload,
      options
    );
    if (!response.data) throw new Error(`Response error ${response.error}`)
    this.sabre.setAuthorization(response.data.access_token)
    return response
  }
}