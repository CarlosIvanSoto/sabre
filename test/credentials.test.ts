import { describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { Sabre, SabreLegacy, buildCredentials } from '../src/index.js';
import type { BuildCredentialsOptions } from '../src/index.js';
import { resolveSessionCredentials } from '../src/session/credentials.js';

const parts = { user: '7971', pcc: 'H8GI', password: 'epr-pass' };
const app = { clientId: 'app-client-id', clientSecret: 'app-client-secret' };

describe('buildCredentials', () => {
  it('arma el username v3 por defecto, con domain AA', () => {
    expect(buildCredentials({ ...parts, ...app })).toEqual({ ...app, username: '7971-H8GI-AA', password: 'epr-pass' });
  });

  it('arma el username v2 sin clientId/clientSecret', () => {
    expect(buildCredentials({ ...parts, authVersion: 'v2' })).toEqual({
      username: 'V1:7971:H8GI:AA',
      password: 'epr-pass',
    });
  });

  it('con v2 conserva clientId/clientSecret si vienen los dos', () => {
    expect(buildCredentials({ ...parts, ...app, authVersion: 'v2' })).toEqual({
      ...app,
      username: 'V1:7971:H8GI:AA',
      password: 'epr-pass',
    });
  });

  it('usa el domain que se le pasa', () => {
    expect(buildCredentials({ ...parts, ...app, domain: 'EXT' }).username).toBe('7971-H8GI-EXT');
    expect(buildCredentials({ ...parts, authVersion: 'v2', domain: 'EXT' }).username).toBe('V1:7971:H8GI:EXT');
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['user vacío', { ...parts, ...app, user: '' }, 'sabre-client: user es requerido y debe ser un string no vacío'],
    ['password ausente', { ...parts, ...app, password: undefined }, 'sabre-client: password es requerido'],
    ['PCC de 5 caracteres', { ...parts, ...app, pcc: 'H8GI1' }, 'sabre-client: pcc debe tener 3 o 4 caracteres'],
    ['un group en lugar de PCC', { ...parts, ...app, pcc: 'DEVCENTER' }, 'sabre-client: pcc debe tener 3 o 4'],
    ['domain vacío', { ...parts, ...app, domain: '' }, 'sabre-client: domain es requerido'],
    ['domain con separador', { ...parts, ...app, domain: 'A-A' }, "sabre-client: domain no puede contener '-' ni ':'"],
    ['v3 sin clientId/clientSecret', parts, 'sabre-client: clientId (requerido con authVersion v3)'],
    ['clientId sin clientSecret', { ...parts, authVersion: 'v2', clientId: 'x' }, 'sabre-client: clientId y clientSecret van juntos'],
    ['clientId vacío en v2', { ...parts, authVersion: 'v2', clientId: '', clientSecret: 'y' }, 'sabre-client: clientId es requerido'],
    ['authVersion desconocida', { ...parts, ...app, authVersion: 'v4' }, "sabre-client: authVersion debe ser 'v3' o 'v2'"],
  ])('rechaza %s con TypeError', (_, options, message) => {
    expect(() => buildCredentials(options as unknown as BuildCredentialsOptions)).toThrow(TypeError);
    expect(() => buildCredentials(options as unknown as BuildCredentialsOptions)).toThrow(message);
  });

  it('no repite secretos en los mensajes de error', () => {
    const call = () => buildCredentials({ ...parts, password: 'secret-pass', clientId: 'secret-id' } as never);
    expect(call).toThrow(/^(?!.*secret-)/);
  });

  it.each<[string, BuildCredentialsOptions, '2.0.0' | '1.0.0']>([
    ['v3 con app → SessionCreateRQ 2.0.0', { ...parts, ...app }, '2.0.0'],
    ['v2 sin app → SessionCreateRQ 1.0.0', { ...parts, authVersion: 'v2' }, '1.0.0'],
    ['v2 con app → SessionCreateRQ 2.0.0', { ...parts, ...app, authVersion: 'v2' }, '2.0.0'],
  ])('el mismo objeto sirve para Sabre y SabreLegacy: %s', (_, options, version) => {
    const credentials = buildCredentials(options);
    const config = { environment: 'sandbox', authVersion: options.authVersion, credentials } as never;

    expect(() => new Sabre(config)).not.toThrow();
    expect(() => new SabreLegacy(config)).not.toThrow();
    expect(resolveConfig(config).credentials).toEqual(credentials);
    expect(resolveSessionCredentials(credentials)).toMatchObject({
      version,
      username: '7971',
      organization: 'H8GI',
      domain: 'AA',
      password: 'epr-pass',
    });
  });
});
