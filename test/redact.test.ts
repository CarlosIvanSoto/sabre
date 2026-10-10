import { describe, expect, it } from 'vitest';
import { SabreBusinessError } from '../src/errors/index.js';
import { REDACTED, redact } from '../src/logging/redact.js';

describe('redact', () => {
  it('enmascara credenciales con cualquier convención de nombre', () => {
    const out = redact({
      clientId: 'V1:abc',
      clientSecret: 's3cr3t',
      client_secret: 's3cr3t',
      credentials: { username: 'epr-user', password: 'epr-pass' },
      access_token: 'T1RLAQ...',
    });
    expect(out).toEqual({
      clientId: 'V1:abc',
      clientSecret: REDACTED,
      client_secret: REDACTED,
      credentials: { username: REDACTED, password: REDACTED },
      access_token: REDACTED,
    });
  });

  it('enmascara Authorization en objetos planos y en Headers', () => {
    expect(redact({ headers: { Authorization: 'Bearer T1RL' } })).toEqual({
      headers: { Authorization: REDACTED },
    });
    const headers = new Headers({ authorization: 'Bearer T1RL', 'content-type': 'application/json' });
    expect(redact(headers)).toEqual({ authorization: REDACTED, 'content-type': 'application/json' });
  });

  it('enmascara bloques completos de pasajeros a cualquier profundidad', () => {
    const out = JSON.stringify(
      redact({
        createBooking: { travelers: [{ givenName: 'Ana', surname: 'Pérez' }] },
        nested: [{ passengers: [{ name: 'Luis' }] }],
      }),
    );
    expect(out).not.toContain('Ana');
    expect(out).not.toContain('Luis');
  });

  it('no muta la entrada y tolera ciclos', () => {
    const input: Record<string, unknown> = { password: 'x' };
    input.self = input;
    const out = redact(input) as Record<string, unknown>;
    expect(input.password).toBe('x');
    expect(out.password).toBe(REDACTED);
    expect(out.self).toBe('[Circular]');
  });

  it('nunca incluye SabreError.raw', () => {
    const err = new SabreBusinessError('x', {
      service: 'createBooking',
      code: '1',
      raw: { travelers: [{ name: 'Ana' }], note: 'contenido-de-raw' },
    });
    const out = JSON.stringify(redact({ error: err }));
    expect(out).toContain('createBooking');
    expect(out).not.toContain('contenido-de-raw');
  });

  it('deja intactos los primitivos', () => {
    expect(redact('texto')).toBe('texto');
    expect(redact(42)).toBe(42);
    expect(redact(undefined)).toBeUndefined();
  });
});
