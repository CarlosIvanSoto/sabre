// El AAA de la sesión (Q-143) para scripts/validate-update-reservation.mjs: cambia el PCC con
// `session.command('AAA<PCC>')` antes de cualquier lectura o escritura y, si el host no lo
// confirma, aborta sin tocar el PNR. Aparte del script para que los tests le pasen una conexión
// falsa: la conexión, el plan y los efectos (`step`, `log`, `fail`, `watch`) entran por parámetro.
import { aaaCommand, aaaScreenValues, anonymizeAaaScreen, describeError, parseAaaScreen } from './update-reservation.mjs';

export const WITHOUT_READING = 'No se leyó ni se escribió nada en el PNR.';

/**
 * @param {object} options
 * @param {{ sessionPcc?: string, sessionPccLabel?: string }} options.plan lo que da `resolvePlan`
 * @param {(name: string, run: () => Promise<unknown>) => Promise<{ value?: any, error?: unknown }>} options.step
 *   corre un paso y anota su resultado; no lanza (devuelve `{ value }` o `{ error }`)
 * @param {ReadonlyArray<string | undefined>} [options.secrets] los PCC conocidos, para anonimizar la pantalla
 * @param {(values: string[]) => void} [options.watch] recibe el PCC, el home y la sine reales de la
 *   pantalla: el chequeo de fugas de la fixture los vigila
 * @param {() => void} [options.fail] se llama cuando el AAA no se confirma (el script sale con código 4)
 * @param {{ log: Function, error: Function }} [options.log] la consola
 */
export function createSessionContext({ plan, step, secrets = [], watch = () => {}, fail = () => {}, log = console }) {
  /** Lo que pasó con el AAA de esta corrida (Q-143); `sent` solo es `true` si se mandó el comando. */
  const aaa = { sent: false, ok: null, screen: undefined };

  /**
   * Cambia el AAA de la sesión si hay SABRE_SESSION_PCC. Devuelve `false` si la pantalla no confirma
   * el cambio o el comando falla: el paso debe salir sin tocar el PNR. Sin SABRE_SESSION_PCC no manda
   * nada y devuelve `true`.
   */
  async function enterContext(conn) {
    if (plan.sessionPcc === undefined) return true;
    const command = aaaCommand(plan.sessionPcc);
    aaa.sent = true;
    log.log(`AAA: mando ${command} (PCC de ${plan.sessionPccLabel}) antes de cualquier lectura o escritura`);
    const sent = await step('AAA de la sesión', () => conn.session.command(command));
    if (sent.error !== undefined) {
      aaa.ok = false;
      log.error(`\n✘ el AAA falló: ${describeError(sent.error).name ?? ''} ${sent.error?.message ?? sent.error}\n${WITHOUT_READING} Sesión cerrada.`);
      fail();
      return false;
    }
    const screen = String(sent.value?.text ?? '');
    // La sine y el home reales no están en los secretos conocidos: salen de la forma de la pantalla.
    // Una sine `AAA` ya es el valor anonimizado, no se vigila.
    watch(aaaScreenValues(screen).filter((value) => value !== 'AAA'));
    aaa.screen = anonymizeAaaScreen(screen, [...secrets, plan.sessionPcc]);
    const verdict = parseAaaScreen(screen, plan.sessionPcc);
    aaa.ok = verdict.ok;
    log.log(`pantalla del AAA:\n${screen}\n`);
    if (!verdict.ok) {
      log.error(`✘ la pantalla no confirma el cambio de AAA (${verdict.reason}).\n${WITHOUT_READING} Sesión cerrada.`);
      fail();
      return false;
    }
    log.log(`✔ ${verdict.reason}`);
    return true;
  }

  /**
   * Lo que hace cada paso con la sesión abierta: el AAA primero, `body` solo si se confirma, y `close`
   * siempre (también si `body` lanza). Devuelve `{ entered: false }` si el AAA abortó el paso.
   */
  async function runInContext(conn, body) {
    try {
      if (!(await enterContext(conn))) return { entered: false };
      return { entered: true, value: await body() };
    } finally {
      await step('close', () => conn.session.close());
    }
  }

  return { aaa, enterContext, runInContext };
}
