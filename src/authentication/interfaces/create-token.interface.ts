import { PostOptions } from "../../common/interfaces"
import { ErrorResponse } from "../../interfaces";

export interface CreateTokenResponseSuccess {
  /**
   * El token ligero ATK.
   *
   * example: T1RLAQJPQzjC8M7MPu+2vm9J86MWvDzJIxBrkd3OsIZH9jSJ+Gbd15XoAACgsBW7lZMgx26vSTP4nx7E3Oa4Gpd2ypySwCFrtTCIp8YT3W/2lergfTRZsH2rUfGzQjz2SvMPoi20pvDMKkcgiju1DBrByskZg9gECjTXvI38gxKOyS4RmxOn4YJLXUSlzeKslMev0P8jmkg5wuQbyQIBHhISRKk0c8+0lW5lJfX0fueROpqx9oQMNdwcdMcrmvcA3eV+FkTCyJUgk3rT+w**
   */
  access_token: string
  /**
   * El tipo de token.
   *
   * example: bearer
   */
  token_type: string
  /**
   * El tiempo de vencimiento en segundos.
   *
   * example: 604800
   */
  expires_in: number
}
export interface CreateTokenRequestOptions extends PostOptions {}

export interface CreateTokenResponse {
  data: CreateTokenResponseSuccess | null;
  error: ErrorResponse | null;
}