// Anonimización de las respuestas de colas grabadas (la regla de #96, ADR-018), la misma que usan
// los scripts que graban fixtures. Exportada para que los consumidores no la repitan (ADR-027, D1).
// Solo Web Standard APIs: corre en cualquier runtime.

/** Qué dato real quedó en un texto: lo que devuelve `Anonymizer.leaks`. */
export type AnonymizerLeak = 'secreto' | 'localizador' | 'nombre' | 'línea del PNR' | 'token';

export interface AnonymizerOptions {
  /**
   * Valores que nunca deben quedar: credenciales, usuario, PCC. Cada uno pasa a `XXXX` donde
   * aparezca. Se ignoran los que no son string o tienen menos de 3 caracteres.
   */
  secrets?: ReadonlyArray<string | undefined>;
}

/**
 * Una anonimización con memoria: el mismo localizador da siempre el mismo alias y el mismo
 * pasajero el mismo nombre falso, en todos los textos que pasen por ella. Una por grabación.
 */
export interface Anonymizer {
  /**
   * Un sobre SOAP o cualquier texto con su XML (también un JSON con XML adentro):
   * - cada `UniqueID@ID` pasa a un alias (`AAAAAA`, `AAAAAB`…), y el localizador real se reemplaza
   *   por su alias en todo el texto;
   * - `PassengerName` a `PASAJERO/UNO`, `PASAJERO/DOS`…, y `Group` a `GRUPO`;
   * - `AgentSine` a `AAA` (salvo `SABRE`), `PseudoCityCode` a `XXXX` y `LNIATA` a `XXXXXX`;
   * - cada `<Text>` pasa por `maskLine`;
   * - los `secrets`, a `XXXX`.
   */
  anonymize(text: string): string;
  /**
   * Una línea del PNR en formato de host. Las de la lista blanca (`isSafeHostLine`) quedan tal
   * cual; en las demás, letras a `X` y dígitos a `9`. La cabecera `QUEUE LIST FOR <PCC>` solo
   * tapa el PCC, y `RECEIVED FROM - ` conserva el prefijo. La línea de firma
   * (`… HHMM/DDMMMYY <localizador> H`) conserva su forma, y el localizador solo si ya es un alias:
   * de ella sale el localizador del PNR siguiente en `place` dentro de una cola. Llamarla después
   * de dar alias a los localizadores.
   */
  maskLine(line: string): string;
  /** `maskLine` sobre cada línea de un párrafo, p. ej. `QueueItem.paragraph`. */
  maskParagraph(lines: readonly string[]): string[];
  /** El alias de un localizador: lo asigna la primera vez, en orden (`AAAAAA`, `AAAAAB`…). */
  aliasOf(locator: string): string;
  /**
   * Qué datos reales siguen en `text`, sin repetir: un `secret`, un localizador o un nombre que ya
   * tienen alias, una línea del PNR que se enmascaró, o un token de sesión. Vacío si no queda
   * ninguno. Sirve para no escribir una fixture que todavía trae datos reales.
   */
  leaks(text: string): AnonymizerLeak[];
}

const NAMES = ['UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ'];

/** Líneas de un PNR en formato de host que quedan tal cual: no traen datos del pasajero. */
const SAFE_LINES: readonly RegExp[] = [
  /^\s*$/,
  // Aviso PIC: 011  SEE REMARKS. Sin dígitos después del número: una línea de `list`
  // (`100  ABC123  PLT  MAM  01JUN26  1948`) también empieza con 3 dígitos y trae el sine.
  /^\s*\d{3}\s{2,}[A-Z][A-Z ,./-]*$/,
  /^\s*END OF DISPLAY FOR REQUESTED DATA\s*$/,
  /^\s*(TKT\/TIME LIMIT|PHONES|REMARKS|ADDRESS|INVOICED|GENERAL FACTS|[A-Z0-9]{2} FACTS|NO ITIN)\s*$/,
  /^\s*PASSENGER EMAIL DATA EXISTS\s+\*PE TO DISPLAY ALL\s*$/,
];

/**
 * Si una línea del PNR en formato de host queda tal cual al anonimizar: está en la lista blanca de
 * #96 (líneas vacías, avisos PIC como `011  SEE REMARKS`, títulos de sección como `REMARKS`, el fin
 * de cola).
 */
export function isSafeHostLine(line: string): boolean {
  return SAFE_LINES.some((pattern) => pattern.test(line));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ENTITIES[entity] ?? '');
const encode = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const masked = (text: string) => text.replace(/\p{L}/gu, 'X').replace(/\p{N}/gu, '9');

/** Ver `Anonymizer`. */
export function createAnonymizer(options: AnonymizerOptions = {}): Anonymizer {
  const secrets = (options.secrets ?? [])
    .filter((value): value is string => typeof value === 'string' && value.length >= 3)
    .sort((a, b) => b.length - a.length);
  const redactSecrets = (text: string) => secrets.reduce((value, secret) => value.split(secret).join('XXXX'), text);
  const locatorAliases = new Map<string, string>();
  const realNames = new Map<string, string>();
  const maskedLines = new Set<string>();

  const aliasOf = (locator: string): string => {
    let alias = locatorAliases.get(locator);
    if (alias === undefined) {
      const n = locatorAliases.size;
      // Base 26 en cuatro letras: `AAAAAA`, `AAAAAB`… y sigue en letras después del 676 (`AAABAA`).
      const letters = [17576, 676, 26, 1].map((size) => String.fromCharCode(65 + (Math.floor(n / size) % 26))).join('');
      alias = `AA${letters}`;
      locatorAliases.set(locator, alias);
    }
    return alias;
  };
  const fakeName = (name: string): string => {
    let fake = realNames.get(name);
    if (fake === undefined) {
      fake = `PASAJERO/${NAMES[realNames.size] ?? realNames.size + 1}`;
      realNames.set(name, fake);
    }
    return fake;
  };

  function anonymizeLine(line: string): string {
    if (isSafeHostLine(line)) return line;
    const header = /^(\s*QUEUE LIST FOR )\S+(\s+QUEUE )(\S+)\s*$/.exec(line);
    if (header !== null) return `${header[1]}XXXX${header[2]}${header[3]}`;
    const received = /^(\s*RECEIVED FROM - )(.*)$/.exec(line);
    const signature = /^(.*\s)(\d{4}\/\d{2}[A-Z]{3}\d{2})(\s+)([A-Z0-9]{6})(\s+H\s*)$/.exec(line);
    const aliases = new Set(locatorAliases.values());
    let result: string;
    if (received !== null) {
      result = `${received[1]}${masked(received[2] ?? '')}`;
    } else if (signature !== null) {
      const [, before = '', stamp = '', gap = '', locator = '', end = ''] = signature;
      result = `${masked(before)}${masked(stamp)}${gap}${aliases.has(locator) ? locator : masked(locator)}${end}`;
    } else {
      result = masked(line);
    }
    if (line.trim().length >= 4 && result.trim() !== line.trim()) maskedLines.add(line.trim());
    return result;
  }

  function anonymize(body: string): string {
    let text = String(body).replace(
      /(<(?:\w+:)?UniqueID\b[^>]*\bID=")([^"]+)(")/g,
      (_, a: string, locator: string, b: string) => `${a}${aliasOf(locator)}${b}`,
    );
    for (const [locator, alias] of locatorAliases) text = text.split(locator).join(alias);
    text = text.replace(
      /(<(?:\w+:)?PassengerName>)([^<]*)(<\/)/g,
      (_, a: string, name: string, b: string) => `${a}${fakeName(decode(name))}${b}`,
    );
    text = text.replace(/(<(?:\w+:)?Group>)([^<]*)(<\/)/g, (_, a: string, value: string, b: string) =>
      value === '' ? `${a}${b}` : `${a}GRUPO${b}`,
    );
    text = text.replace(/(\bAgentSine=")([^"]*)(")/g, (_, a: string, sine: string, b: string) =>
      `${a}${sine === 'SABRE' ? sine : 'AAA'}${b}`,
    );
    text = text.replace(/(\bPseudoCityCode=")([^"]*)(")/g, '$1XXXX$3');
    // La dirección de la terminal (`stl:HostCommand@LNIATA`, en `session.command()`).
    text = text.replace(/(\bLNIATA=")([^"]*)(")/g, '$1XXXXXX$3');
    text = text.replace(
      /(<(?:\w+:)?Text\b[^>/]*>)([\s\S]*?)(<\/(?:\w+:)?Text>)/g,
      (_, a: string, line: string, b: string) => `${a}${encode(anonymizeLine(decode(line)))}${b}`,
    );
    return redactSecrets(text);
  }

  const maskLine = (line: string) => redactSecrets(anonymizeLine(line));

  function leaks(text: string): AnonymizerLeak[] {
    const found: AnonymizerLeak[] = [
      ...secrets.filter((secret) => text.includes(secret)).map((): AnonymizerLeak => 'secreto'),
      ...[...locatorAliases.keys()].filter((locator) => text.includes(locator)).map((): AnonymizerLeak => 'localizador'),
      ...[...realNames.keys()]
        .filter((realName) => realName.length >= 3 && text.includes(realName))
        .map((): AnonymizerLeak => 'nombre'),
      ...[...maskedLines].filter((line) => text.includes(line)).map((): AnonymizerLeak => 'línea del PNR'),
      ...(/IceSess|Shared\/IDL/.test(text) ? (['token'] as const) : []),
    ];
    return [...new Set(found)];
  }

  return {
    anonymize,
    maskLine,
    maskParagraph: (lines) => lines.map(maskLine),
    aliasOf,
    leaks,
  };
}
