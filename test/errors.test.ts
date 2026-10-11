import { describe, expect, it } from 'vitest';
import {
  SabreBusinessError,
  SabreError,
  SabreGatewayError,
  SabreOrchestrationError,
  SabreWarning,
} from '../src/index.js';

const raw = { headers: { Authorization: 'Bearer secreto' }, travelers: [{ name: 'Ana' }] };

describe('SabreError', () => {
  it('SabreGatewayError expone protocol, status, code, retryable y raw', () => {
    const err = new SabreGatewayError('Throttled', {
      protocol: 'rest',
      status: 429,
      code: 'ERR.2SG.GATEWAY.REQUEST_THROTTLED',
      retryable: true,
      raw,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SabreError);
    expect(err).toBeInstanceOf(SabreGatewayError);
    expect(err).not.toBeInstanceOf(SabreBusinessError);
    expect(err.name).toBe('SabreGatewayError');
    expect(err.message).toBe('Throttled');
    expect(err.protocol).toBe('rest');
    expect(err.status).toBe(429);
    expect(err.code).toBe('ERR.2SG.GATEWAY.REQUEST_THROTTLED');
    expect(err.retryable).toBe(true);
    expect(err.raw).toBe(raw);
  });

  it('SabreOrchestrationError solo es reintentable con SP.PROVIDER_ERROR', () => {
    const provider = new SabreOrchestrationError('LLS falló', { code: 'SP.PROVIDER_ERROR' });
    const internal = new SabreOrchestrationError('Falla interna', { code: 'SP.INTERNAL_ERROR' });
    expect(provider).toBeInstanceOf(SabreError);
    expect(provider.retryable).toBe(true);
    expect(internal.retryable).toBe(false);
    expect(internal.code).toBe('SP.INTERNAL_ERROR');
  });

  it('SabreBusinessError lleva service y code sin normalizar y por defecto no es reintentable', () => {
    const err = new SabreBusinessError('Asiento no disponible', { service: 'seatMap', code: '135', raw });
    expect(err).toBeInstanceOf(SabreError);
    expect(err).not.toBeInstanceOf(SabreWarning);
    expect(err.service).toBe('seatMap');
    expect(err.code).toBe('135');
    expect(err.retryable).toBe(false);
  });

  it('SabreBusinessError acepta retryable: true para códigos temporales de servicios de lectura', () => {
    const err = new SabreBusinessError('Transmission timeout', {
      service: 'bargainFinderMax',
      code: 'Transmission timeout',
      retryable: true,
    });
    expect(err.retryable).toBe(true);
  });

  it('SabreBusinessError lleva los avisos que llegaron con él, sin su raw al serializar', () => {
    const warning = new SabreWarning('Aviso', { service: 'createBooking', code: 'AIRCRAFT_CHANGE', raw });
    const err = new SabreBusinessError('Falla', { service: 'createBooking', code: 'X', warnings: [warning] });
    expect(err.warnings).toEqual([warning]);
    expect(new SabreBusinessError('Falla', { service: 'seatMap', code: '135' }).warnings).toEqual([]);
    const json = JSON.parse(JSON.stringify(err)) as { warnings: unknown[] };
    expect(json.warnings).toEqual([
      { name: 'SabreWarning', message: 'Aviso', retryable: false, service: 'createBooking', code: 'AIRCRAFT_CHANGE' },
    ]);
  });

  it('SabreBusinessError lleva los otros errores que llegaron con él, sin su raw al serializar', () => {
    const cause = new SabreBusinessError('Causa', { service: 'cancelBooking', code: 'UNABLE_TO_VOID_TICKET', raw });
    const err = new SabreBusinessError('Falla', { service: 'cancelBooking', code: 'NO_ITEMS_CANCELLED', errors: [cause] });
    expect(err.errors).toEqual([cause]);
    expect(new SabreBusinessError('Falla', { service: 'seatMap', code: '135' }).errors).toEqual([]);
    const json = JSON.parse(JSON.stringify(err)) as { errors: unknown[] };
    expect(json.errors).toEqual([
      {
        name: 'SabreBusinessError',
        message: 'Causa',
        retryable: false,
        service: 'cancelBooking',
        code: 'UNABLE_TO_VOID_TICKET',
        warnings: [],
        errors: [],
      },
    ]);
  });

  it('SabreWarning es un SabreError distinto de SabreBusinessError', () => {
    const warn = new SabreWarning('Aviso', { service: 'createBooking', code: 'WARN' });
    expect(warn).toBeInstanceOf(SabreError);
    expect(warn).not.toBeInstanceOf(SabreBusinessError);
    expect(warn.name).toBe('SabreWarning');
    expect(warn.retryable).toBe(false);
  });

  it('conserva cause', () => {
    const cause = new TypeError('fetch failed');
    const err = new SabreGatewayError('Sin conexión', { protocol: 'rest', retryable: true, cause });
    expect(err.cause).toBe(cause);
  });

  it('raw no se serializa ni aparece al enumerar el error', () => {
    const err = new SabreBusinessError('x', { service: 'createBooking', code: '1', raw });
    const json = JSON.stringify(err);
    expect(json).not.toContain('secreto');
    expect(json).not.toContain('Ana');
    expect(JSON.parse(json)).toEqual({
      name: 'SabreBusinessError',
      message: 'x',
      retryable: false,
      service: 'createBooking',
      code: '1',
      warnings: [],
      errors: [],
    });
    expect(Object.keys(err)).not.toContain('raw');
    expect({ ...err }).not.toHaveProperty('raw');
  });
});
