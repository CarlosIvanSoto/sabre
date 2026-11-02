import { describe, expect, it } from 'vitest';
import { resolveHostDate } from '../src/index.js';

describe('resolveHostDate', () => {
  describe("regla 'past' (recibido, placedAt, countedAt)", () => {
    it('es la regla por defecto', () => {
      expect(resolveHostDate('06SEP', '2026-11-01')).toBe('2026-09-06');
    });

    it('acepta el mismo día de la referencia', () => {
      expect(resolveHostDate('01NOV', '2026-11-01', { direction: 'past' })).toBe('2026-11-01');
    });

    it('va al año anterior si la fecha todavía no llegó', () => {
      expect(resolveHostDate('02NOV', '2026-11-01')).toBe('2025-11-02');
    });

    it('cruza el cambio de año hacia atrás', () => {
      expect(resolveHostDate('12-30T23:15', '2027-01-02')).toBe('2026-12-30T23:15');
      expect(resolveHostDate('31DEC', '2027-01-01')).toBe('2026-12-31');
    });

    it('no tiene ventana: una fecha de hace casi un año sigue hacia atrás', () => {
      expect(resolveHostDate('03JAN', '2026-01-02')).toBe('2025-01-03');
    });

    it('lleva un 29 de febrero al último año bisiesto', () => {
      expect(resolveHostDate('29FEB', '2026-11-01')).toBe('2024-02-29');
      expect(resolveHostDate('02-29T08:00', '2028-02-29')).toBe('2028-02-29T08:00');
      expect(resolveHostDate('29FEB', '2028-02-28')).toBe('2024-02-29');
    });

    it('resuelve el DateTime de QueueCountRS', () => {
      expect(resolveHostDate('06-25T09:46', '2026-11-01')).toBe('2026-06-25T09:46');
      expect(resolveHostDate('12-21T07:00', '2026-11-01')).toBe('2025-12-21T07:00');
    });
  });

  describe("regla 'nearest' (segmentos y ticketing)", () => {
    const nearest = { direction: 'nearest' } as const;

    it('toma la fecha más cercana hacia adelante', () => {
      expect(resolveHostDate('15DEC', '2026-11-01', nearest)).toBe('2026-12-15');
    });

    it('toma la fecha más cercana hacia atrás', () => {
      expect(resolveHostDate('15OCT', '2026-11-01', nearest)).toBe('2026-10-15');
    });

    it('cruza el cambio de año hacia adelante', () => {
      expect(resolveHostDate('06JAN', '2026-12-20', nearest)).toBe('2027-01-06');
      expect(resolveHostDate('02MAY', '2026-11-03', nearest)).toBe('2027-05-02');
    });

    it('cruza el cambio de año hacia atrás', () => {
      expect(resolveHostDate('28DEC', '2027-01-05', nearest)).toBe('2026-12-28');
      expect(resolveHostDate('15JUL', '2027-01-05', nearest)).toBe('2026-07-15');
    });

    it('con un empate, gana la fecha futura', () => {
      // Solo hay empate con un 29 de febrero en medio: 366 días, 183 de cada lado.
      // 2027-11-01 queda a 183 días de 2027-05-02 y de 2028-05-02.
      expect(resolveHostDate('02MAY', '2027-11-01', nearest)).toBe('2028-05-02');
      expect(resolveHostDate('01MAY', '2027-11-01', nearest)).toBe('2028-05-01');
      expect(resolveHostDate('03MAY', '2027-11-01', nearest)).toBe('2027-05-03');
      // 2028-01-01 queda a 183 días de 2027-07-02 y de 2028-07-02.
      expect(resolveHostDate('02JUL', '2028-01-01', nearest)).toBe('2028-07-02');
      // Sin bisiesto en medio no hay empate: 2026-11-01 queda a 183 días de 2026-05-02 y a 182
      // de 2027-05-02, y a 182 de 2026-05-03 y a 183 de 2027-05-03.
      expect(resolveHostDate('02MAY', '2026-11-01', nearest)).toBe('2027-05-02');
      expect(resolveHostDate('03MAY', '2026-11-01', nearest)).toBe('2026-05-03');
    });

    it('resuelve un 29 de febrero contra el bisiesto más cercano', () => {
      expect(resolveHostDate('29FEB', '2027-11-01', nearest)).toBe('2028-02-29');
      expect(resolveHostDate('29FEB', '2028-07-01', nearest)).toBe('2028-02-29');
    });

    it('no resuelve un 29 de febrero sin un bisiesto a menos de 6 meses', () => {
      expect(resolveHostDate('29FEB', '2026-11-01', nearest)).toBeUndefined();
      expect(resolveHostDate('29FEB', '2025-02-28', nearest)).toBeUndefined();
    });
  });

  describe('texto con año', () => {
    it('usa el año del texto, con cualquier regla', () => {
      expect(resolveHostDate('2024-05-15T13:24', '2026-11-01')).toBe('2024-05-15T13:24');
      expect(resolveHostDate('2030-01-01', '2026-11-01')).toBe('2030-01-01');
      expect(resolveHostDate('06SEP29', '2026-11-01', { direction: 'nearest' })).toBe('2029-09-06');
      expect(resolveHostDate('06SEP29', '2026-11-01', { direction: 'past' })).toBe('2029-09-06');
    });

    it('valida el 29 de febrero contra ese año', () => {
      expect(resolveHostDate('2028-02-29', '2026-11-01')).toBe('2028-02-29');
      expect(resolveHostDate('29FEB28', '2026-11-01')).toBe('2028-02-29');
      expect(resolveHostDate('2026-02-29', '2026-11-01')).toBeUndefined();
      expect(resolveHostDate('29FEB26', '2026-11-01')).toBeUndefined();
    });
  });

  describe('formato', () => {
    it('acepta minúsculas, un día de un dígito y espacios a los costados', () => {
      expect(resolveHostDate(' 6sep ', '2026-11-01')).toBe('2026-09-06');
    });

    it('devuelve undefined con un texto que no reconoce o una fecha que no existe', () => {
      const texts = ['', 'SEP', '06SEPT', '06XYZ', '31APR', '00SEP', '13-01', '12-21T24:00', '12-21T07:60'];
      for (const text of [...texts, '2024-5-15', '06SEP2026']) {
        expect(resolveHostDate(text, '2026-11-01'), text).toBeUndefined();
      }
    });
  });

  describe('referenceDate', () => {
    it('acepta un Date, tomando el día en UTC', () => {
      expect(resolveHostDate('01NOV', new Date('2026-11-01T23:59:59Z'))).toBe('2026-11-01');
      expect(resolveHostDate('01NOV', new Date('2026-10-31T23:59:59Z'))).toBe('2025-11-01');
    });

    it('acepta un string con hora, que no se usa', () => {
      expect(resolveHostDate('01NOV', '2026-11-01T00:00:00-06:00')).toBe('2026-11-01');
    });

    it('lanza TypeError si falta o no es válida', () => {
      for (const reference of [undefined, '', '2026-02-30', '01NOV', new Date('nope'), 20261101]) {
        expect(() => resolveHostDate('06SEP', reference as unknown as string)).toThrow(TypeError);
      }
    });

    it("lanza TypeError con una direction que no es 'past' ni 'nearest'", () => {
      expect(() => resolveHostDate('06SEP', '2026-11-01', { direction: 'future' as 'past' })).toThrow(TypeError);
    });
  });
});
