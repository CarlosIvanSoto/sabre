import { RevalidateItineraryOptions, Sabre } from '../src'

// Ejemplo ejecutable para search.revalidate
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

const options: RevalidateItineraryOptions = {
  OTA_AirLowFareSearchRQ: {
    Version: '5',
    POS: {
      Source: [
        {
          PseudoCityCode: process.env.SABRE_ORGANIZATION!,
          RequestorID: {
            Type: '1',
            ID: '1',
            CompanyName: {
              Code: 'TN'
            }
          },
          FixedPCC: false
        }
      ]
    },
    OriginDestinationInformation: [
      {
        Fixed: false,
        DepartureDateTime: '2026-03-09T06:15:00',
        OriginLocation: {
          LocationCode: 'TRC'
        },
        DestinationLocation: {
          LocationCode: 'MEX'
        },
        TPA_Extensions: {
          Flight: [
            {
              Type: 'A',
              Number: 101,
              DepartureDateTime: '2026-03-09T06:15:00',
              ArrivalDateTime: '2026-03-09T08:00:00',
              ClassOfService: 'E',
              OriginLocation: {
                LocationCode: 'TRC'
              },
              DestinationLocation: {
                LocationCode: 'MEX'
              },
              Airline: {
                Marketing: 'AM',
                Operating: 'AM'
              }
            }
          ]
        }
      }
    ],
    TravelerInfoSummary: {
      AirTravelerAvail: [
        {
          PassengerTypeQuantity: [
            {
              Code: 'ADT',
              Quantity: 1
            }
          ]
        }
      ]
    },
    TPA_Extensions: {
      IntelliSellTransaction: {
        RequestType: {
          Name: '50ITINS'
        }
      }
    },
    AvailableFlightsOnly: false
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
