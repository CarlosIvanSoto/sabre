import { RevalidateItineraryOptions, Sabre } from '../src'

// Ejemplo ejecutable para search.revalidate
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

const options: RevalidateItineraryOptions = {
  OTA_AirLowFareSearchRQ: {
    AvailableFlightsOnly: true,
    OriginDestinationInformation: [
      {
        OriginLocation: { LocationCode: 'TRC' },
        DestinationLocation: { LocationCode: 'MEX' },
        DepartureDateTime: '2025-11-25T10:00:00',
        Fixed: true,
        TPA_Extensions: {
          Flight: [
            {
              Airline: { Marketing: 'SU' },
              DepartureDateTime: '2024-10-25T10:00:00',
              ArrivalDateTime: '2024-10-25T13:00:00',
              OriginLocation: { LocationCode: 'SVO' },
              DestinationLocation: { LocationCode: 'LHR' },
              Number: 100,
              Type: 'A',
              ClassOfService: 'Y'
            }
          ]
        }
      }
    ],
    POS: {
      Source: [
        {
          RequestorID: { ID: '1', Type: '1', CompanyName: { Code: 'TN' } },
          PseudoCityCode: '7TZA',
          FixedPCC: true
        }
      ]
    },
    TravelerInfoSummary: {
      AirTravelerAvail: [
        {
          PassengerTypeQuantity: [
            { Code: 'ADT', Quantity: 1, PersonName: { Surname: 'SIMPSON' } }
          ]
        }
      ]
    },
    Version: 'V5',
  }
}

async function main() {
  const run = process.env.RUN_EXAMPLES === '1' || process.env.RUN_EXAMPLES === 'true'
  if (!run) {
    console.log('Este ejemplo está listo. Para ejecutarlo en tu entorno con credenciales:')
    console.log('RUN_EXAMPLES=1 SABRE_USERNAME=xxx SABRE_PASSWORD=yyy SABRE_ORGANIZATION=zzz npx ts-node examples/search-revalidate.ts')
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
    const res = await sabre.search.revalidate(options)
    console.log('Respuesta:',JSON.stringify(res));
  } catch (err) {
    console.error('Error al llamar a search.revalidate:', err)
  }
}

void main()
