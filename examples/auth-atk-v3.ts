import { Sabre } from '../src'

// Ejemplo ejecutable para auth.atk
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

async function main() {
  const run = process.env.RUN_EXAMPLES === '1' || process.env.RUN_EXAMPLES === 'true'
  if (!run) {
    console.log('Este ejemplo está listo. Para ejecutarlo en tu entorno con credenciales:')
    console.log('RUN_EXAMPLES=1 SABRE_USERNAME=xxx SABRE_PASSWORD=yyy SABRE_ORGANIZATION=zzz SABRE_CLIENT_ID=aaa SABRE_CLIENT_SECRET=bbb npm run example:auth-atk-v3')
    return
  }

  const { SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION } = process.env
  if (!SABRE_USERNAME || !SABRE_PASSWORD || !SABRE_ORGANIZATION) {
    console.error('Faltan variables de entorno: SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION')
    return
  }
  const { SABRE_CLIENT_ID, SABRE_CLIENT_SECRET } = process.env
  if (!SABRE_CLIENT_ID || !SABRE_CLIENT_SECRET) {
    console.error('Faltan variables de entorno: SABRE_CLIENT_ID, SABRE_CLIENT_SECRET')
    return
  }

  const sabre = new Sabre({ username: SABRE_USERNAME, password: SABRE_PASSWORD, organization: SABRE_ORGANIZATION, clientId: SABRE_CLIENT_ID, clientSecret: SABRE_CLIENT_SECRET })

  try {
    const res = await sabre.authentication.OAuthTokenV3();
    console.log('Respuesta (resumen):', JSON.stringify(res).slice(0, 1000))
  } catch (err) {
    console.error('Error al llamar a authentication.OAuthTokenV3:', err)
  }
}

void main()
