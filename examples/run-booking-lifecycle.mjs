#!/usr/bin/env node
// Create → Get → (revisión) → Cancel → Get con credenciales propias. En producción es el piloto
// de una sola corrida que decidió el usuario en #47 (implementación en #50). Lo corre el
// usuario; nunca la CI. Necesita `npm run build` antes. Ver examples/README.md.
//
//   SABRE_CREATE_BOOKING=1 node --env-file=.env examples/run-booking-lifecycle.mjs
//   SABRE_ENVIRONMENT=production SABRE_CREATE_BOOKING=1 SABRE_ALLOW_PRODUCTION_BOOKING=AAAA-MM-DD \
//     node --env-file=.env.production examples/run-booking-lifecycle.mjs
//
// En producción, si ya existe .sabre-pilot-pnr.json, el script no crea nada: solo puede retomar
// la cancelación del localizador que quedó ahí.
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Sabre, SabreError } from 'sabre-client';
import { oneWaySearch, SYNTHETIC_TRAVELER } from './air-booking-flow.mjs';
import {
  bookingLifecycle,
  describeError,
  NotBookedError,
  PILOT_DEPARTURE_DAYS,
  PilotLockedError,
  preflight,
  resumeCancellation,
  REVIEW_TIMEOUT_MS,
  reviewWindow,
} from './booking-lifecycle.mjs';

const LOCK_FILE = new URL('../.sabre-pilot-pnr.json', import.meta.url);

const fail = (message) => {
  console.error(message);
  process.exit(2);
};
const env = (name, fallback) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') fail(`falta la variable de entorno ${name}`);
  return value;
};
const integer = (name, fallback, min, max) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} debe ser un entero entre ${min} y ${max} (recibido: ${raw})`);
  return value;
};

const environment = process.env.SABRE_ENVIRONMENT ?? 'sandbox';
if (environment !== 'sandbox' && environment !== 'production') {
  fail(`SABRE_ENVIRONMENT debe ser sandbox o production (recibido: ${environment})`);
}
const production = environment === 'production';

/** Lock de una sola corrida, solo en producción. Sin datos del pasajero. */
const lock = production
  ? {
      async read() {
        try {
          return JSON.parse(await readFile(LOCK_FILE, 'utf8'));
        } catch (error) {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        }
      },
      async write(state) {
        await writeFile(LOCK_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      },
    }
  : undefined;

// Todo lo que se puede rechazar sin red se rechaza antes de pedir un token.
const gate = preflight({
  environment,
  createBooking: process.env.SABRE_CREATE_BOOKING,
  allowProductionBooking: process.env.SABRE_ALLOW_PRODUCTION_BOOKING,
  lock: await lock?.read(),
  now: new Date(),
});
if (gate.action === 'refuse') fail(gate.reason);
const resuming = gate.action === 'resume';
const existing = resuming ? gate.lock : undefined;

// En producción, pasajero real que consienta (precaución 1); en sandbox, el sintético si no hay otro.
const travelerFromEnv = () => {
  const givenName = env('SABRE_TRAVELER_GIVEN_NAME');
  const surname = env('SABRE_TRAVELER_SURNAME');
  const email = env('SABRE_TRAVELER_EMAIL');
  const phone = env('SABRE_TRAVELER_PHONE');
  if (/\d/.test(surname)) fail('SABRE_TRAVELER_SURNAME no puede llevar dígitos');
  if (!/^[0-9+-]+$/.test(phone)) fail('SABRE_TRAVELER_PHONE solo admite dígitos, + y -');
  return {
    traveler: { givenName, surname, passengerCode: 'ADT', emails: [email], phones: [{ number: phone, label: 'M' }] },
    contactInfo: { emails: [email], phones: [phone] },
  };
};
const passenger =
  resuming
    ? undefined
    : production || process.env.SABRE_TRAVELER_SURNAME !== undefined
      ? travelerFromEnv()
      : { traveler: SYNTHETIC_TRAVELER, contactInfo: { emails: ['test@example.com'], phones: ['5550000000'] } };

const departureDays = production
  ? integer('SABRE_DEPARTURE_DAYS', 75, PILOT_DEPARTURE_DAYS.min, PILOT_DEPARTURE_DAYS.max)
  : integer('SABRE_DEPARTURE_DAYS', 30, 1, 330);
const maxStops = production ? 0 : integer('SABRE_MAX_STOPS', 1, 0, 3);
if (production && process.env.SABRE_MAX_STOPS !== undefined && process.env.SABRE_MAX_STOPS !== '0') {
  fail('en producción el piloto solo reserva vuelos directos: quita SABRE_MAX_STOPS');
}

const authVersion = process.env.SABRE_AUTH_VERSION ?? 'v3';
const pcc = env('SABRE_PCC', process.env.SABRE_ORGANIZATION);
const user = env('SABRE_USERNAME');
const isEpr = user.includes('-') || user.includes(':');
const username = isEpr ? user : authVersion === 'v3' ? `${user}-${pcc}-AA` : `V1:${user}:${pcc}:AA`;
const credentials = {
  clientId: authVersion === 'v3' ? env('SABRE_CLIENT_ID') : process.env.SABRE_CLIENT_ID,
  clientSecret: authVersion === 'v3' ? env('SABRE_CLIENT_SECRET') : process.env.SABRE_CLIENT_SECRET,
  username,
  password: env('SABRE_PASSWORD'),
};
const tokenStore =
  process.env.SABRE_TOKEN_STORE === 'file' ? (await import('../scripts/file-token-store.mjs')).fileTokenStore : undefined;
// El SDK ya redacta el contexto antes de llamar al logger.
const logger = process.env.SABRE_DEBUG === '1' ? console : undefined;

const sabre = new Sabre({
  environment,
  authVersion,
  credentials,
  ...(tokenStore === undefined ? {} : { tokenStore }),
  ...(logger === undefined ? {} : { logger }),
});

// Ctrl+C (o SIGTERM) no mata el proceso: pide cancelar. Si ya hay PNR, el `finally` lo cancela.
const interrupt = new AbortController();
const rl = createInterface({ input: process.stdin, output: process.stdout });
const onInterrupt = () => {
  if (interrupt.signal.aborted) {
    console.error('\n… ya se está cancelando; espera a que termine para no dejar el PNR vivo');
    return;
  }
  console.error('\n⚠ interrumpido: se cancela lo que se haya creado');
  interrupt.abort();
};
rl.on('SIGINT', onInterrupt);
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onInterrupt);

const onStep = (step, detail) => console.log(`✓ ${step}`, detail);
const ask = async (question) => {
  try {
    return await rl.question(question, { signal: interrupt.signal });
  } catch {
    return undefined;
  }
};

try {
  if (resuming) {
    console.log(`entorno ${environment} · lock ${existing.status} · localizador ${existing.confirmationId} (${existing.flights})`);
    const answer = await ask(`¿Retomar la cancelación de ${existing.confirmationId}? Escribe "cancelar" para seguir: `);
    if (answer?.trim() !== 'cancelar') fail('no se retomó la cancelación');
    const result = await resumeCancellation(sabre, { lock, onStep });
    report(result);
  } else {
    const departure = new Date(Date.now() + departureDays * 86_400_000).toISOString().slice(0, 10);
    const origin = process.env.SABRE_ORIGIN ?? 'DFW';
    const destination = process.env.SABRE_DESTINATION ?? 'LAX';
    console.log(`entorno ${environment} · OAuth ${authVersion} · ${production ? 'PILOTO DE PRODUCCIÓN (una sola corrida)' : 'sandbox'}`);
    console.log(`búsqueda ${origin}→${destination} · salida ${departure} (+${departureDays} días) · máximo ${maxStops} escala(s)`);
    const result = await bookingLifecycle(sabre, {
      environment,
      search: oneWaySearch({ pcc, origin, destination, departureDateTime: `${departure}T10:00:00`, maxStops }),
      ...passenger,
      ticketingPcc: pcc,
      ...(lock === undefined ? {} : { lock }),
      signal: interrupt.signal,
      onStep,
      confirm: async (preview) => {
        console.log(
          `\nSe va a crear este PNR (sin pago ni emisión, FUTURE_TICKETING con fecha ${preview.ticketingDate} en el PCC ${pcc}):`,
        );
        for (const f of preview.flights) console.log(`  ${f.flight} · ${f.departure} · clase ${f.bookingClass}`);
        console.log(`  precio revalidado ${preview.price} (BFM ${preview.searchPrice}) · umbral: ninguna subida`);
        console.log(`  pasajero ${preview.traveler}`);
        const answer = await ask(`Escribe "reservar" para crear el PNR${production ? ' en PRODUCCIÓN' : ''}: `);
        return answer?.trim() === 'reservar';
      },
      review: ({ confirmationId, signal }) => {
        const minutes = REVIEW_TIMEOUT_MS / 60_000;
        console.log(`\nPNR ${confirmationId} vivo. Revísalo (Get o Sabre Red) y presiona Enter para cancelarlo.`);
        console.log(`Se cancela solo en ${minutes} min; Ctrl+C también cancela.`);
        return reviewWindow({ enter: rl.question(''), signal });
      },
    });
    report(result);
  }
} catch (error) {
  if (error instanceof PilotLockedError || error instanceof NotBookedError) {
    console.error(`✗ ${error.message}`);
    process.exitCode = 2;
  } else if (resuming && error instanceof SabreError) {
    console.error('✗ no se pudo retomar la cancelación', describeError(error));
    console.error(`El PNR ${existing.confirmationId} puede seguir vivo: vuelve a intentarlo o cancélalo a mano.`);
    process.exitCode = 1;
  } else if (error instanceof SabreError) {
    // Falló BFM, Revalidate o Create. Sin localizador: o no hubo PNR (sin lock), o el resultado
    // de Create es incierto (lock sin localizador).
    const after = await lock?.read();
    console.error('✗ la secuencia falló antes de tener un localizador', describeError(error));
    if (after?.status === 'uncertain') {
      console.error('⚠ resultado incierto: revisa en Sabre Red si se creó un PNR. El lock bloquea nuevas corridas.');
    } else {
      console.error('No se creó ningún PNR: la corrida del piloto no se consumió.');
    }
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  rl.close();
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onInterrupt);
}

function report(result) {
  console.log('\nInforme (sin datos del pasajero):');
  console.log(JSON.stringify(result, null, 2));
  if (result.ok) {
    console.log('✓ secuencia completa: el PNR quedó sin vuelos');
    return;
  }
  process.exitCode = 1;
  if (result.final?.ok) {
    console.error('✗ hubo fallos, pero el PNR quedó sin vuelos');
  } else {
    console.error(`✗ el PNR ${result.confirmationId} puede seguir vivo: cancélalo a mano o vuelve a correr el script para retomar la cancelación`);
  }
}
