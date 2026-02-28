import { CreatePassengerNameRecordOptions, Sabre } from '../src'

// Ejemplo ejecutable para search.revalidate
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1
// Es necesario ajustar la fecha y hora del ArrivalDateTime y DepartureDateTime
const options: CreatePassengerNameRecordOptions = {
  CreatePassengerNameRecordRQ: {
    version: '2.5.0',
    targetCity: process.env.SABRE_ORGANIZATION!,
    TravelItineraryAddInfo: {
      AgencyInfo: {
        Address: {
          AddressLine: 'SABRE TRAVEL',
          CityName: 'SOUTHLAKE',
          CountryCode: 'US',
          PostalCode: '76092',
          StateCountyProv: {
            StateCode: 'TX'
          },
          StreetNmbr: '3150 SABRE DRIVE',
          VendorPrefs: {
            Airline: {
              Hosted: true
            }
          }
        },
        Ticketing: {
          TicketType: '7TAW'
        }
      },
      CustomerInfo: {
        ContactNumbers: {
          ContactNumber: [
            {
              NameNumber: '1.1',
              Phone: '817-555-1212',
              PhoneUseType: 'H'
            }
          ]
        },
        PersonName: [
          {
            NameNumber: '1.1',
            GivenName: 'MARCELO',
            Surname: 'GUZMAN'
          }
        ]
      }
    },
    AirBook: {
      OriginDestinationInformation: {
        FlightSegment: [
          {
            ArrivalDateTime: '2026-04-23T06:20:00',
            DepartureDateTime: '2026-04-23T08:05:00',
            FlightNumber: '101',
            NumberInParty: '1',
            ResBookDesigCode: 'E',
            Status: 'NN',
            DestinationLocation: {
              LocationCode: 'MEX'
            },
            MarketingAirline: {
              Code: 'AM',
              FlightNumber: '101'
            },
            OriginLocation: {
              LocationCode: 'TRC'
            }
          }
        ]
      }
    },
    AirPrice: [
      {
        PriceRequestInformation: {
          Retain: true,
          OptionalQualifiers: {
            FOP_Qualifiers: {
              BasicFOP: {
                Type: 'CK'
              }
            },
            PricingQualifiers: {
              PassengerType: [
                {
                  Code: 'ADT',
                  Quantity: '1'
                }
              ]
            }
          }
        }
      }
    ],
    PostProcessing: {
      EndTransaction: {
        Source: {
          ReceivedFrom: 'SP TEST'
        }
      },
      RedisplayReservation: {},
      PricingInterval: {
        waitInterval: 100
      }
    }
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
    const res = await sabre.reservation.create(options)
    console.log('Respuesta:',JSON.stringify(res));
  } catch (err) {
    console.error('Error al llamar a reservation.create', err)
  }
}

void main()