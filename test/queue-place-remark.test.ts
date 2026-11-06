// parseQueuePlaceRemark (#163, A4 de ADR-027). Las formas reales son de Q-090 (producción,
// 2026-11-06). Los PCC de los demás casos son inventados (ABC, Z9Z9, AB12), salvo HDQ.
import { describe, expect, it } from 'vitest';
import { parseQueuePlaceRemark } from '../src/index.js';

describe('parseQueuePlaceRemark: las formas de Q-090', () => {
  it.each([
    ['MEX25SEP146/015', { pcc: 'MEX', date: '25SEP', queue: 146, pic: 15 }],
    ['HDQ05JUL313/036', { pcc: 'HDQ', date: '05JUL', queue: 313, pic: 36 }],
    ['MEX15AUG134/015', { pcc: 'MEX', date: '15AUG', queue: 134, pic: 15 }],
    ['MEX17AUG146/015', { pcc: 'MEX', date: '17AUG', queue: 146, pic: 15 }],
  ])('%s', (text, expected) => {
    expect(parseQueuePlaceRemark(text)).toEqual(expected);
  });
});

describe('parseQueuePlaceRemark: PCC de 3 y 4 caracteres', () => {
  it.each([
    ['ABC01JAN0/000', { pcc: 'ABC', date: '01JAN', queue: 0, pic: 0 }],
    ['Z9Z931DEC511/254', { pcc: 'Z9Z9', date: '31DEC', queue: 511, pic: 254 }],
    // Un PCC de 4 que termina en dígito: el día son los 2 dígitos antes del mes.
    ['AB1205JUL50/200', { pcc: 'AB12', date: '05JUL', queue: 50, pic: 200 }],
    ['ABC10OCT7/191', { pcc: 'ABC', date: '10OCT', queue: 7, pic: 191 }],
    ['  ABC10OCT7/011  ', { pcc: 'ABC', date: '10OCT', queue: 7, pic: 11 }],
  ])('%j', (text, expected) => {
    expect(parseQueuePlaceRemark(text)).toEqual(expected);
  });
});

describe('parseQueuePlaceRemark: un texto inválido da null', () => {
  it.each([
    ['', 'vacío'],
    ['MEX25SEP146', 'sin PIC'],
    ['MEX25SEP/015', 'sin cola'],
    ['MEX 25SEP146/015', 'con separadores'],
    ['MEX25SEP146-015', 'otro separador'],
    ['MX25SEP146/015', 'PCC de 2'],
    ['ABCDE25SEP146/015', 'PCC de 5'],
    ['MEX5SEP146/015', 'día de un dígito'],
    ['MEX00SEP146/015', 'día 00'],
    ['MEX32SEP146/015', 'día 32'],
    ['MEX25SET146/015', 'mes que no existe'],
    ['mex25sep146/015', 'minúsculas'],
    ['MEX25SEP512/015', 'cola 512'],
    ['MEX25SEP1460/015', 'cola de 4 dígitos'],
    ['MEX25SEP146/192', 'PIC 192'],
    ['MEX25SEP146/199', 'PIC 199'],
    ['MEX25SEP146/255', 'PIC 255'],
    ['MEX25SEP146/015X', 'texto de más'],
  ])('%j (%s)', (text) => {
    expect(parseQueuePlaceRemark(text)).toBeNull();
  });

  it('un valor que no es string da null sin lanzar', () => {
    for (const value of [undefined, null, 146, { text: 'MEX25SEP146/015' }]) {
      expect(parseQueuePlaceRemark(value as unknown as string)).toBeNull();
    }
  });
});
