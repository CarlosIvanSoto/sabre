import { describe, expect, it } from 'vitest';
import type { SabreConfig } from '../src/config.js';
import { SabreLegacy } from '../src/index.js';
import { parseEprUsername, resolveSessionCredentials } from '../src/session/credentials.js';
import { mockFetch } from './helpers.js';

const password = 'epr-pass';
const clientId = 'app-client-id';
const clientSecret = 'app-client-secret';

function v2(credentials: Record<string, unknown>): SabreConfig {
  return { environment: 'production', authVersion: 'v2', credentials: { password, ...credentials } as never };
}

describe('parseEprUsername', () => {
  it.each<[string, string, string, string, string]>([
    ['v2', 'V1:7971:H8GI:AA', '7971', 'H8GI', 'AA'],
    ['v3', '7971-H8GI-AA', '7971', 'H8GI', 'AA'],
    ['v2 con PCC de 3 caracteres', 'V1:7971:A1B:AA', '7971', 'A1B', 'AA'],
    ['v3 con usuario con guion', 'ab-cd-H8GI-AA', 'ab-cd', 'H8GI', 'AA'],
    ['v2 con usuario con dos puntos', 'V1:ab:cd:H8GI:AA', 'ab:cd', 'H8GI', 'AA'],
    ['v2 con usuario con guion', 'V1:ab-cd:H8GI:AA', 'ab-cd', 'H8GI', 'AA'],
    ['v3 con usuario con dos puntos', 'ab:cd-H8GI-AA', 'ab:cd', 'H8GI', 'AA'],
    ['domain distinto de AA', 'V1:7971:H8GI:EXT', '7971', 'H8GI', 'EXT'],
  ])('lee de derecha a izquierda: %s', (_, input, username, organization, domain) => {
    expect(parseEprUsername(input)).toEqual({ username, organization, domain });
  });

  it.each<[string, string]>([
    ['solo usuario', '7971'],
    ['sin domain (v3)', '7971-H8GI'],
    ['sin domain (v2)', 'V1:7971:H8GI'],
    ['usuario vacío (v3)', '-H8GI-AA'],
    ['usuario vacío (v2)', 'V1::H8GI:AA'],
    ['domain vacío', '7971-H8GI-'],
    ['separador de v2 sin el prefijo V1', '7971:H8GI:AA'],
  ])('rechaza un username sin formato EPR: %s', (_, input) => {
    expect(() => parseEprUsername(input)).toThrow(TypeError);
    expect(() => parseEprUsername(input)).toThrow(/^sabre-client: credentials\.username debe tener el formato/);
  });

  it.each<[string, string]>([
    ['de 2 caracteres', '7971-H8-AA'],
    ['de 5 caracteres', 'V1:7971:H8GI1:AA'],
    ['vacío', 'V1:7971::AA'],
    ['con símbolos', '7971-H8_I-AA'],
    ['DEVCENTER, que es un group y no un PCC', 'V1:7971:DEVCENTER:EXT'],
  ])('rechaza un PCC %s', (_, input) => {
    expect(() => parseEprUsername(input)).toThrow(TypeError);
    expect(() => parseEprUsername(input)).toThrow(
      'sabre-client: el PCC de credentials.username debe tener 3 o 4 caracteres alfanuméricos',
    );
  });

  it('no repite el username en el mensaje de error', () => {
    expect(() => parseEprUsername('secret-user-H8GI1-AA')).toThrow(/^(?!.*secret-user)/);
    expect(() => parseEprUsername('secret-user')).toThrow(/^(?!.*secret-user)/);
  });
});

describe('resolveSessionCredentials', () => {
  it('con clientId y clientSecret elige SessionCreateRQ 2.0.0', () => {
    expect(resolveSessionCredentials({ username: '7971-H8GI-AA', password, clientId, clientSecret })).toEqual({
      version: '2.0.0',
      username: '7971',
      organization: 'H8GI',
      domain: 'AA',
      password,
      clientId,
      clientSecret,
    });
  });

  it('sin clientId ni clientSecret elige 1.0.0, sin esas claves', () => {
    const session = resolveSessionCredentials({ username: 'V1:7971:H8GI:AA', password });
    expect(session).toEqual({ version: '1.0.0', username: '7971', organization: 'H8GI', domain: 'AA', password });
    expect(session).not.toHaveProperty('clientId');
    expect(session).not.toHaveProperty('clientSecret');
  });

  it.each<[string, Record<string, unknown>]>([
    ['solo clientId', { clientId }],
    ['solo clientSecret', { clientSecret }],
  ])('rechaza una credencial a medias: %s', (_, extra) => {
    const credentials = { username: 'V1:7971:H8GI:AA', password, ...extra };
    expect(() => resolveSessionCredentials(credentials)).toThrow(TypeError);
    expect(() => resolveSessionCredentials(credentials)).toThrow(
      /^sabre-client: credentials\.clientId y credentials\.clientSecret van juntos/,
    );
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['clientId vacío', { clientId: ' ', clientSecret }, /credentials\.clientId debe ser un string no vacío/],
    ['clientSecret vacío', { clientId, clientSecret: '' }, /credentials\.clientSecret debe ser un string no vacío/],
    ['clientId no string', { clientId: 42, clientSecret }, /credentials\.clientId debe ser un string no vacío/],
  ])('rechaza %s', (_, extra, message) => {
    const credentials = { username: 'V1:7971:H8GI:AA', password, ...extra } as never;
    expect(() => resolveSessionCredentials(credentials)).toThrow(TypeError);
    expect(() => resolveSessionCredentials(credentials)).toThrow(message);
  });

  it('una credencial a medias no filtra el secreto en el mensaje', () => {
    try {
      resolveSessionCredentials({ username: 'V1:7971:H8GI:AA', password, clientSecret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(clientSecret);
      expect(String(error)).not.toContain(password);
    }
  });
});

describe('SabreLegacy', () => {
  it('mapea environment al endpoint SOAP', () => {
    const sandbox = new SabreLegacy({ ...v2({ username: 'V1:7971:H8GI:AA' }), environment: 'sandbox' });
    const production = new SabreLegacy(v2({ username: '7971-H8GI-AA' }));
    expect(sandbox.environment).toBe('sandbox');
    expect(sandbox.baseUrl).toBe('https://webservices.cert.platform.sabre.com');
    expect(production.baseUrl).toBe('https://webservices.platform.sabre.com');
  });

  it('acepta las dos combinaciones de OAuth y sesión', () => {
    // OAuth v2 solo con EPR → sesión 1.0.0; OAuth v3 con clientId → sesión 2.0.0.
    expect(() => new SabreLegacy(v2({ username: 'V1:7971:H8GI:AA' }))).not.toThrow();
    expect(
      () =>
        new SabreLegacy({
          environment: 'production',
          credentials: { username: '7971-H8GI-AA', password, clientId, clientSecret },
        }),
    ).not.toThrow();
  });

  it.each<[string, SabreConfig, RegExp]>([
    ['username sin formato EPR', v2({ username: '7971' }), /credentials\.username debe tener el formato/],
    ['PCC inválido', v2({ username: 'V1:7971:H8GI12:AA' }), /el PCC de credentials\.username/],
    ['solo clientId', v2({ username: 'V1:7971:H8GI:AA', clientId }), /van juntos/],
    ['solo clientSecret', v2({ username: 'V1:7971:H8GI:AA', clientSecret }), /van juntos/],
    ['config inválida', { environment: 'cert' } as never, /environment debe ser 'sandbox' o 'production'/],
  ])('falla en el constructor, sin red: %s', (_, input, message) => {
    const fetch = mockFetch();
    const withFetch = { ...input, fetch } as SabreConfig;
    expect(() => new SabreLegacy(withFetch)).toThrow(TypeError);
    expect(() => new SabreLegacy(withFetch)).toThrow(new RegExp(`^sabre-client: .*${message.source}`));
    expect(fetch).not.toHaveBeenCalled();
  });
});
