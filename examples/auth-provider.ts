import { BargainFinderMaxOptions, createOAuthV2, Sabre } from '../src'

// Ejemplo ejecutable para autenticación automática vía TokenProvider.
//
// A diferencia de examples/search-shop.ts (que requiere pedir un token a
// mano con examples/auth-atk.ts y pasarlo vía sabre.setAuthorization), acá
// el cliente obtiene y refresca el token solo: no hace falta ningún paso
// de autenticación previo, ni SABRE_TOKEN.
//
// Requisitos para ejecutar:
// export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

const options: BargainFinderMaxOptions = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: {
      Source: [
        {
          PseudoCityCode: process.env.SABRE_ORGANIZATION!,
          RequestorID: { ID: '1', Type: '1', CompanyName: { Code: 'TN' } },
          FixedPCC: true
        }
      ]
    },
    AvailableFlightsOnly: true,
    OriginDestinationInformation: [
      {
        OriginLocation: { LocationCode: 'TRC' },
        DestinationLocation: { LocationCode: 'MEX' },
        DepartureDateTime: '2026-03-09T00:00:00',
        Fixed: false
      }
    ],
    TravelerInfoSummary: {
      AirTravelerAvail: [
        {
          PassengerTypeQuantity: [{ Code: 'ADT', Quantity: 1 }]
        }
      ]
    },
    TPA_Extensions: {
      IntelliSellTransaction: {
        RequestType: { Name: '50ITINS' }
      }
    }
  }
}

async function main() {
  const run = process.env.RUN_EXAMPLES === '1' || process.env.RUN_EXAMPLES === 'true'
  if (!run) {
    console.log('Este ejemplo está listo. Para ejecutarlo en tu entorno con credenciales:')
    console.log('RUN_EXAMPLES=1 SABRE_USERNAME=xxx SABRE_PASSWORD=yyy SABRE_ORGANIZATION=zzz npm run example:auth-provider')
    return
  }

  const { SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION } = process.env
  if (!SABRE_USERNAME || !SABRE_PASSWORD || !SABRE_ORGANIZATION) {
    console.error('Faltan variables de entorno: SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION')
    return
  }

  const auth = createOAuthV2({
    credentials: {
      type: 'user',
      username: SABRE_USERNAME,
      password: SABRE_PASSWORD,
      pcc: SABRE_ORGANIZATION,
    },
  })

  const sabre = new Sabre({
    username: SABRE_USERNAME,
    password: SABRE_PASSWORD,
    organization: SABRE_ORGANIZATION,
    auth,
  })

  try {
    // Sin setAuthorization() ni OAuthTokenV2() previo: el provider obtiene
    // el token en esta llamada y lo cachea para las siguientes.
    const res = await sabre.search.shop(options)
    console.log('Respuesta:', JSON.stringify(res));
  } catch (err) {
    console.error('Error al llamar a search.shop:', err)
  }
}

void main()
