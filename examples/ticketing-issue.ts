import { Sabre } from '../src'

// Ejemplo ejecutable para ticketing.issue
// Requisitos para ejecutar: export SABRE_USERNAME=... SABRE_PASSWORD=... SABRE_ORGANIZATION=... y RUN_EXAMPLES=1

const options = {
  AirTicketRQ: {
    Itinerary: { ID: 'GLEBNY' },
    Ticketing: [
      {
        FOP_Qualifiers: {
          BasicFOP: {
            CC_Info: {
              PaymentCard: {
                Number: 4123412341234123,
                ExpireDate: '2026-12',
                Code: 'VI',
                CardSecurityCode: '123'
              },
              Suppress: false
            }
          }
        }
      }
    ],
    PostProcessing: {
      EndTransaction: {
        generateSingleInvoice: true,
        Source: { ReceivedFrom: 'SWS TESTING' },
        Email: { Ind: true, eTicket: { Ind: true, PDF: { Ind: true } } }
      },
      acceptNegotiatedFare: true,
      acceptPriceChanges: true
    },
    version: '1.3.0'
  }
}

async function main() {
  const run = process.env.RUN_EXAMPLES === '1' || process.env.RUN_EXAMPLES === 'true'
  if (!run) {
    console.log('Este ejemplo está listo. Para ejecutarlo en tu entorno con credenciales:')
    console.log('RUN_EXAMPLES=1 SABRE_USERNAME=xxx SABRE_PASSWORD=yyy SABRE_ORGANIZATION=zzz npx ts-node examples/ticketing-issue.ts')
    return
  }

  const { SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION } = process.env
  if (!SABRE_USERNAME || !SABRE_PASSWORD || !SABRE_ORGANIZATION) {
    console.error('Faltan variables de entorno: SABRE_USERNAME, SABRE_PASSWORD, SABRE_ORGANIZATION')
    return
  }

  const sabre = new Sabre({ username: SABRE_USERNAME, password: SABRE_PASSWORD, organization: SABRE_ORGANIZATION })

  try {
    const res = await sabre.ticketing.issue(options as any)
    console.log('Respuesta (resumen):', JSON.stringify(res).slice(0, 1000))
  } catch (err) {
    console.error('Error al llamar a ticketing.issue:', err)
  }
}

void main()
