import { describe, expect, it } from 'vitest';
import { resolveConfig, type SabreConfig } from '../src/config.js';
import { Sabre } from '../src/index.js';
import { config, credentials } from './helpers.js';

describe('SabreConfig', () => {
  it('mapea environment a la base URL', () => {
    expect(new Sabre(config({ environment: 'sandbox' })).baseUrl).toBe('https://api.cert.platform.sabre.com');
    expect(new Sabre(config({ environment: 'production' })).baseUrl).toBe('https://api.platform.sabre.com');
  });

  it('aplica defaults: authVersion v3 y retry 3/500', () => {
    const resolved = resolveConfig(config());
    expect(resolved.authVersion).toBe('v3');
    expect(resolved.retry).toEqual({ maxRetries: 3, baseDelayMs: 500 });
    expect(resolved.pcc).toBeUndefined();
  });

  it('combina retry parcial con los defaults', () => {
    expect(resolveConfig(config({ retry: { maxRetries: 1 } })).retry).toEqual({ maxRetries: 1, baseDelayMs: 500 });
  });

  it('en v2 no exige clientId/clientSecret (tipo y runtime)', () => {
    const v2: SabreConfig = { environment: 'sandbox', authVersion: 'v2', credentials: { username: 'epr-user', password: 'epr-pass' } };
    expect(resolveConfig(v2).authVersion).toBe('v2');
  });

  it('en v3 (explícito o por defecto) el tipo exige clientId/clientSecret', () => {
    const epr = { username: 'epr-user', password: 'epr-pass' };
    // @ts-expect-error clientId/clientSecret son obligatorios sin authVersion
    const implicit: SabreConfig = { environment: 'sandbox', credentials: epr };
    // @ts-expect-error clientId/clientSecret son obligatorios con authVersion 'v3'
    const explicit: SabreConfig = { environment: 'sandbox', authVersion: 'v3', credentials: epr };
    expect(() => resolveConfig(implicit)).toThrow(/clientId \(requerido con authVersion v3\)/);
    expect(() => resolveConfig(explicit)).toThrow(/clientId \(requerido con authVersion v3\)/);
  });

  it.each<[string, unknown, RegExp]>([
    ['sin config', undefined, /la config debe ser un objeto/],
    ['environment inválido', { credentials, environment: 'cert' }, /environment debe ser 'sandbox' o 'production'/],
    ['sin credentials', { environment: 'sandbox' }, /credentials es requerido/],
    ['sin username', { environment: 'sandbox', credentials: { ...credentials, username: '' } }, /credentials\.username/],
    ['sin password', { environment: 'sandbox', credentials: { ...credentials, password: undefined } }, /credentials\.password/],
    ['v3 sin clientSecret', { environment: 'sandbox', credentials: { ...credentials, clientSecret: ' ' } }, /clientSecret \(requerido con authVersion v3\)/],
    ['authVersion inválido', { ...config(), authVersion: 'v4' }, /authVersion debe ser 'v3' o 'v2'/],
    ['pcc vacío', { ...config(), pcc: '' }, /pcc es requerido/],
    ['logger incompleto', { ...config(), logger: { info() {} } }, /logger\.debug debe ser una función/],
    ['maxRetries negativo', { ...config(), retry: { maxRetries: -1 } }, /retry\.maxRetries/],
    ['baseDelayMs no numérico', { ...config(), retry: { baseDelayMs: Number.NaN } }, /retry\.baseDelayMs/],
  ])('falla en el constructor: %s', (_, input, message) => {
    expect(() => new Sabre(input as SabreConfig)).toThrow(TypeError);
    expect(() => new Sabre(input as SabreConfig)).toThrow(message);
  });

  it('los mensajes de error no incluyen secretos', () => {
    try {
      new Sabre({ ...config(), environment: 'x' as never });
    } catch (error) {
      expect(String(error)).not.toContain(credentials.clientSecret);
      expect(String(error)).not.toContain(credentials.password);
    }
  });
});
