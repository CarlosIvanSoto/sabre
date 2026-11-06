// createAnonymizer de sabre-client/testing (#165): la regla de #96 (ADR-018) que usan los scripts
// que graban fixtures, exportada para los consumidores (ADR-027, D1).
import { describe, expect, it } from 'vitest';
import { createAnonymizer, isSafeHostLine } from '../src/testing/index.js';
import activityHistoryInQueue from './fixtures/activity.sandbox-history-in-queue.json';
import activityProductionQa from './fixtures/activity.production-qa.json';
import activityHistory from './fixtures/activity.sandbox-history.json';
import activityHistoryPlace from './fixtures/activity.sandbox-history-place.json';
import queueCount from './fixtures/queue.production-count.json';
import queueListLarge from './fixtures/queue.production-list-large.json';
import queueMessages from './fixtures/queue.production-messages.json';
import queuePlaceCleanup from './fixtures/queue.production-place-cleanup.json';
import queuePlace from './fixtures/queue.production-place.json';
import queueWalkEmpty from './fixtures/queue.production-walk-empty-queue.json';
import queueWalk from './fixtures/queue.production-walk.json';

/** Un sobre de `access` con datos inventados que parecen reales. */
const ACCESS = [
  '<QueueAccessRS><Line Number="1"><DateTime>2026-11-05T10:07</DateTime><Group>7</Group>',
  '<PassengerName>PEREZ/JUAN</PassengerName><POS><Source AgentSine="J7K" PseudoCityCode="H8GI"/></POS>',
  '<UniqueID ID="QWERTY"/></Line><Paragraph>',
  '<Text>QUEUE LIST FOR H8GI  QUEUE 12</Text>',
  '<Text> 1.1PEREZ/JUAN MR</Text>',
  '<Text>011  SEE REMARKS</Text>',
  '<Text>REMARKS</Text>',
  '<Text>RECEIVED FROM - JUAN &amp; ANA</Text>',
  '<Text>H8GI.H8GI*AJ7 1948/01JUN26 QWERTY H</Text>',
  '<Text>H8GI.H8GI*AJ7 1948/01JUN26 ZXCVBN H</Text>',
  '</Paragraph></QueueAccessRS>',
].join('');

describe('createAnonymizer: anonymize', () => {
  it('tapa localizador, pasajero, grupo, firma, PCC y el párrafo', () => {
    const out = createAnonymizer().anonymize(ACCESS);
    expect(out).toContain('<UniqueID ID="AAAAAA"/>');
    expect(out).toContain('<PassengerName>PASAJERO/UNO</PassengerName>');
    expect(out).toContain('<Group>GRUPO</Group>');
    expect(out).toContain('<Source AgentSine="AAA" PseudoCityCode="XXXX"/>');
    expect(out).toContain('<Text>QUEUE LIST FOR XXXX  QUEUE 12</Text>');
    expect(out).toContain('<Text> 9.9XXXXX/XXXX XX</Text>');
    expect(out).toContain('<Text>011  SEE REMARKS</Text>');
    expect(out).toContain('<Text>REMARKS</Text>');
    expect(out).toContain('<Text>RECEIVED FROM - XXXX &amp; XXX</Text>');
    // La firma conserva su forma; el localizador queda solo si ya es un alias.
    expect(out).toContain('<Text>X9XX.X9XX*XX9 9999/99XXX99 AAAAAA H</Text>');
    expect(out).toContain('<Text>X9XX.X9XX*XX9 9999/99XXX99 XXXXXX H</Text>');
    for (const real of ['QWERTY', 'PEREZ', 'JUAN', 'J7K', 'H8GI', 'ZXCVBN']) expect(out).not.toContain(real);
  });

  it('el mismo localizador da el mismo alias en todos los textos, también fuera de UniqueID', () => {
    const anonymizer = createAnonymizer();
    anonymizer.anonymize('<UniqueID ID="QWERTY"/><UniqueID ID="ASDFGH"/>');
    expect(anonymizer.anonymize('{"locator":"ASDFGH","otro":"QWERTY"}')).toBe('{"locator":"AAAAAB","otro":"AAAAAA"}');
    expect(anonymizer.aliasOf('QWERTY')).toBe('AAAAAA');
    expect(anonymizer.aliasOf('NUEVO1')).toBe('AAAAAC');
  });

  it('los alias siguen en base 26 después del 676', () => {
    const anonymizer = createAnonymizer();
    const aliases = Array.from({ length: 678 }, (_, n) => anonymizer.aliasOf(`L${n}`));
    expect(aliases.slice(0, 2)).toEqual(['AAAAAA', 'AAAAAB']);
    expect(aliases[26]).toBe('AAAABA');
    expect(aliases[676]).toBe('AAABAA');
  });

  it('el mismo pasajero da el mismo nombre falso, y SABRE queda como firma', () => {
    const out = createAnonymizer().anonymize(
      '<PassengerName>PEREZ/JUAN</PassengerName><PassengerName>LOPEZ/ANA</PassengerName><PassengerName>PEREZ/JUAN</PassengerName><Source AgentSine="SABRE"/><Group></Group>',
    );
    expect(out).toBe(
      '<PassengerName>PASAJERO/UNO</PassengerName><PassengerName>PASAJERO/DOS</PassengerName><PassengerName>PASAJERO/UNO</PassengerName><Source AgentSine="SABRE"/><Group></Group>',
    );
  });

  it('tapa el LNIATA, los secretos (el más largo primero) e ignora los de menos de 3 caracteres', () => {
    const anonymizer = createAnonymizer({ secrets: ['V1:7971', 'V1:7971:H8GI', 'ab', undefined] });
    expect(anonymizer.anonymize('<HostCommand LNIATA="ABC123">V1:7971:H8GI y V1:7971 ab</HostCommand>')).toBe(
      '<HostCommand LNIATA="XXXXXX">XXXX y XXXX ab</HostCommand>',
    );
  });

  it('acepta prefijos de namespace en los elementos', () => {
    const out = createAnonymizer().anonymize('<stl:UniqueID ID="QWERTY"/><stl:Text>PEREZ</stl:Text>');
    expect(out).toBe('<stl:UniqueID ID="AAAAAA"/><stl:Text>XXXXX</stl:Text>');
  });
});

describe('createAnonymizer: maskLine, maskParagraph e isSafeHostLine', () => {
  it('maskParagraph enmascara cada línea como dentro de <Text>, y también los secretos', () => {
    const anonymizer = createAnonymizer({ secrets: ['H8GI'] });
    expect(anonymizer.maskParagraph(['011  SEE REMARKS', ' 1.1PEREZ/JUAN', '', 'END OF DISPLAY FOR REQUESTED DATA'])).toEqual([
      '011  SEE REMARKS',
      ' 9.9XXXXX/XXXX',
      '',
      'END OF DISPLAY FOR REQUESTED DATA',
    ]);
    expect(anonymizer.maskLine('QUEUE LIST FOR H8GI  QUEUE 1')).toBe('QUEUE LIST FOR XXXX  QUEUE 1');
  });

  it.each([
    ['', true],
    ['011  SEE REMARKS', true],
    ['100  ABC123  PLT  MAM  01JUN26  1948', false],
    ['TKT/TIME LIMIT', true],
    ['AA FACTS', true],
    ['PASSENGER EMAIL DATA EXISTS  *PE TO DISPLAY ALL', true],
    [' 1.1PEREZ/JUAN', false],
  ])('isSafeHostLine(%j) es %s', (line, safe) => {
    expect(isSafeHostLine(line)).toBe(safe);
  });
});

describe('createAnonymizer: leaks', () => {
  it('encuentra lo que se tapó y sigue en otro texto, sin repetir', () => {
    const anonymizer = createAnonymizer({ secrets: ['H8GI'] });
    anonymizer.anonymize(ACCESS);
    expect(anonymizer.leaks(anonymizer.anonymize(ACCESS))).toEqual([]);
    expect(anonymizer.leaks('H8GI QWERTY QWERTY PEREZ/JUAN 1.1PEREZ/JUAN MR Shared/IDL:IceSess')).toEqual([
      'secreto',
      'localizador',
      'nombre',
      'línea del PNR',
      'token',
    ]);
  });
});

/** Las fixtures de colas grabadas, ya anonimizadas por los scripts. */
const RECORDED = {
  'activity.production-qa': activityProductionQa,
  'activity.sandbox-history': activityHistory,
  'activity.sandbox-history-in-queue': activityHistoryInQueue,
  'activity.sandbox-history-place': activityHistoryPlace,
  'queue.production-count': queueCount,
  'queue.production-list-large': queueListLarge,
  'queue.production-messages': queueMessages,
  'queue.production-place': queuePlace,
  'queue.production-place-cleanup': queuePlaceCleanup,
  'queue.production-walk': queueWalk,
  'queue.production-walk-empty-queue': queueWalkEmpty,
} as Record<string, { responses: Array<{ body: string }> }>;

describe('createAnonymizer sobre las fixtures grabadas (mismo resultado que el recorder)', () => {
  it.each(Object.keys(RECORDED))('%s ya está anonimizada: pasarla otra vez no la cambia', (name) => {
    const anonymizer = createAnonymizer();
    // Los alias en orden, para que AAAAAA siga siendo AAAAAA aunque el script los haya dado en otro.
    for (let n = 0; n < 1300; n++) {
      const letters = [17576, 676, 26, 1].map((size) => String.fromCharCode(65 + (Math.floor(n / size) % 26))).join('');
      anonymizer.aliasOf(`AA${letters}`);
    }
    for (const response of RECORDED[name]!.responses) expect(anonymizer.anonymize(response.body)).toBe(response.body);
  });
});
