// El cambio de contexto de la sesión (Q-143) para scripts/validate-update-reservation.mjs: cambia
// el PCC antes de cualquier lectura o escritura y, si el host no lo confirma, aborta sin tocar el
// PNR. Tres variantes (`plan.sessionContext`, de SABRE_SESSION_CONTEXT):
//   - `aaa`: `session.command('AAA<PCC>')` (SabreCommandLLSRQ).
//   - `context-change`: ContextChangeLLSRQ 2.0.3. Si la respuesta trae `SecurityToken Updated="true"`,
//     todos los requests siguientes de la sesión, `close` incluido, usan ese token.
//   - `context-change-cpaid`: lo mismo y además el `CPAId` del encabezado pasa al PCC destino.
// Aparte del script para que los tests le pasen una conexión falsa: la conexión, el plan y los
// efectos (`step`, `log`, `fail`, `watch`) entran por parámetro. El token nuevo es un secreto: no se
// imprime, no se graba y solo sale de aquí hacia `watchToken` y el setter interno de la sesión.
import {
  aaaCommand,
  aaaScreenValues,
  anonymizeAaaScreen,
  contextChangePayload,
  describeError,
  parseAaaScreen,
  parseContextChange,
} from './update-reservation.mjs';

export const WITHOUT_READING = 'No se leyó ni se escribió nada en el PNR.';

/**
 * @param {object} options
 * @param {{ sessionPcc?: string, sessionPccLabel?: string, sessionContext?: string }} options.plan lo que da `resolvePlan`
 * @param {(name: string, run: () => Promise<unknown>) => Promise<{ value?: any, error?: unknown }>} options.step
 *   corre un paso y anota su resultado; no lanza (devuelve `{ value }` o `{ error }`)
 * @param {ReadonlyArray<string | undefined>} [options.secrets] los PCC conocidos, para anonimizar la pantalla
 * @param {(values: string[]) => void} [options.watch] recibe el PCC, el home y la sine reales de la
 *   pantalla: el chequeo de fugas de la fixture los vigila
 * @param {(token: string) => void} [options.watchToken] recibe el token nuevo para que la fixture
 *   no lo traiga nunca (no se imprime)
 * @param {() => void} [options.fail] se llama cuando el cambio no se confirma (el script sale con código 4)
 * @param {{ log: Function, error: Function }} [options.log] la consola
 */
export function createSessionContext({ plan, step, secrets = [], watch = () => {}, watchToken = () => {}, fail = () => {}, log = console }) {
  const context = plan.sessionContext ?? 'aaa';
  /**
   * Lo que pasó con el cambio de contexto de esta corrida (Q-143); `sent` solo es `true` si se mandó.
   * `tokenUpdated` y `cpaIdChanged` dicen si hubo token nuevo y si el CPAId pasó al PCC destino
   * (nunca el valor del token).
   */
  const aaa = { sent: false, ok: null, screen: undefined, context, tokenUpdated: false, cpaIdChanged: false };

  /** Lo que se graba en `findings.q143`: la variante, el token nuevo (sí/no), la pantalla y el resultado de la lectura. */
  const evidence = (readAfterAaa) => ({
    context,
    aaaSent: aaa.sent,
    aaaOk: aaa.ok,
    screen: aaa.screen ?? null,
    newToken: aaa.tokenUpdated,
    cpaIdChanged: aaa.cpaIdChanged,
    readAfterAaa,
  });

  /** Anota la pantalla (anonimizada para la fixture) y deja vigilados el home y la sine reales. */
  function takeScreen(screen) {
    // La sine y el home reales no están en los secretos conocidos: salen de la forma de la pantalla.
    // Una sine `AAA` ya es el valor anonimizado, no se vigila.
    watch(aaaScreenValues(screen).filter((value) => value !== 'AAA'));
    aaa.screen = anonymizeAaaScreen(screen, [...secrets, plan.sessionPcc]);
  }

  function abort(reason) {
    log.error(`✘ la pantalla no confirma el cambio de contexto (${reason}).\n${WITHOUT_READING} Sesión cerrada.`);
    fail();
    return false;
  }

  /** `AAA<PCC>` por SabreCommandLLSRQ (la variante `aaa`). */
  async function enterAaa(conn) {
    const command = aaaCommand(plan.sessionPcc);
    log.log(`AAA: mando ${command} (PCC de ${plan.sessionPccLabel}) antes de cualquier lectura o escritura`);
    const sent = await step('AAA de la sesión', () => conn.session.command(command));
    if (sent.error !== undefined) {
      aaa.ok = false;
      log.error(`\n✘ el AAA falló: ${describeError(sent.error).name ?? ''} ${sent.error?.message ?? sent.error}\n${WITHOUT_READING} Sesión cerrada.`);
      fail();
      return false;
    }
    const screen = String(sent.value?.text ?? '');
    takeScreen(screen);
    const verdict = parseAaaScreen(screen, plan.sessionPcc);
    aaa.ok = verdict.ok;
    log.log(`pantalla del AAA:\n${screen}\n`);
    if (!verdict.ok) return abort(verdict.reason);
    log.log(`✔ ${verdict.reason}`);
    return true;
  }

  /** ContextChangeLLSRQ por el método interno de la sesión (las variantes `context-change*`). */
  async function enterContextChange(conn) {
    const withCpaId = context === 'context-change-cpaid';
    log.log(`ContextChangeLLSRQ 2.0.3: cambio de contexto a ${plan.sessionPccLabel}${withCpaId ? ' y CPAId al PCC destino' : ''} antes de cualquier lectura o escritura`);
    // Sin hooks de grabación: la respuesta trae el token nuevo y no debe llegar a la fixture.
    const sent = await step('cambio de contexto de la sesión', async () => {
      if (conn.send === undefined || conn.security === undefined) throw new Error('no se encontró sessionSend o sessionSecurity en el prototipo de la sesión');
      return conn.session[conn.send]({
        service: 'contextChange',
        action: 'ContextChangeLLSRQ',
        payload: contextChangePayload(plan.sessionPcc),
        idempotent: false,
        operation: 'context.change',
      });
    });
    if (sent.error !== undefined) {
      aaa.ok = false;
      log.error(`\n✘ el cambio de contexto falló: ${describeError(sent.error).name ?? ''} ${sent.error?.message ?? sent.error}\n${WITHOUT_READING} Sesión cerrada.`);
      fail();
      return false;
    }
    const result = parseContextChange(sent.value?.payload, plan.sessionPcc);
    // El token anterior ya no vale: si vino uno nuevo se usa de inmediato, también si el cambio no se
    // confirma, para que `close` salga con el token vigente.
    if (result.token !== undefined) {
      watchToken(result.token);
      conn.session[conn.security]({ token: result.token });
      aaa.tokenUpdated = true;
    }
    takeScreen(result.screen);
    aaa.ok = result.ok;
    log.log(`pantalla del cambio de contexto:\n${result.screen}\n`);
    log.log(`token nuevo: ${aaa.tokenUpdated ? 'sí (se usa en los requests siguientes y en el cierre; no se imprime)' : 'no'}`);
    if (!result.ok) return abort(result.reason);
    if (withCpaId) {
      conn.session[conn.security]({ cpaId: plan.sessionPcc });
      aaa.cpaIdChanged = true;
      log.log('CPAId del encabezado: ahora el PCC destino');
    }
    log.log(`✔ ${result.reason}`);
    return true;
  }

  /**
   * Cambia el PCC de la sesión si hay SABRE_SESSION_PCC. Devuelve `false` si la pantalla no confirma
   * el cambio o la llamada falla: el paso debe salir sin tocar el PNR. Sin SABRE_SESSION_PCC no manda
   * nada y devuelve `true`.
   */
  async function enterContext(conn) {
    if (plan.sessionPcc === undefined) return true;
    aaa.sent = true;
    return context === 'aaa' ? enterAaa(conn) : enterContextChange(conn);
  }

  /**
   * Lo que hace cada paso con la sesión abierta: el cambio de contexto primero, `body` solo si se
   * confirma, y `close` siempre (también si `body` lanza). Devuelve `{ entered: false }` si el cambio abortó el paso.
   */
  async function runInContext(conn, body) {
    try {
      if (!(await enterContext(conn))) return { entered: false };
      return { entered: true, value: await body() };
    } finally {
      await step('close', () => conn.session.close());
    }
  }

  return { aaa, evidence, enterContext, runInContext };
}
