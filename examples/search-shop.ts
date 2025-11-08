import { BargainFinderMaxOptions, Sabre } from '../src'

// Ejemplo ejecutable para search.shop
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

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
        DepartureDateTime: '2025-12-02T10:00:00',
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
    console.log('RUN_EXAMPLES=1 npm run example:search-shop')
    return
  }

  const { SABRE_TOKEN } = process.env
  if (!SABRE_TOKEN) {
    console.error('Faltan variables de entorno: SABRE_TOKEN')
    return
  }

  const { SABRE_ORGANIZATION } = process.env
  if (!SABRE_ORGANIZATION) {
    console.error('Faltan variables de entorno: SABRE_ORGANIZATION')
    return
  }

  const sabre = new Sabre()

  try {
    sabre.setAuthorization(SABRE_TOKEN);
    const res = await sabre.search.shop(options)
    console.log('Respuesta:',JSON.stringify(res));
  } catch (err) {
    console.error('Error al llamar a search.shop:', err)
  }
}

void main()
