import { describe, expect, it, vi } from 'vitest';
import { EventLogger, type SabreLogger } from '../src/logging/logger.js';

function fakeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SabreLogger;
}

describe('EventLogger', () => {
  it('sin logger no hace nada', () => {
    expect(() => new EventLogger().emit('info', 'sabre.request.start', { a: 1 })).not.toThrow();
  });

  it('emite el evento como message y el contexto redactado', () => {
    const logger = fakeLogger();
    new EventLogger(logger).emit('debug', 'sabre.request.start', {
      service: 'bargainFinderMax',
      headers: { Authorization: 'Bearer T1RLAQ-token' },
      credentials: { clientSecret: 'c-secret', username: 'epr', password: 'epr-pass' },
      body: { travelers: [{ givenName: 'Ana' }] },
    });
    expect(logger.debug).toHaveBeenCalledOnce();
    const [message, context] = logger.debug.mock.calls[0]!;
    expect(message).toBe('sabre.request.start');
    expect(context).toMatchObject({ service: 'bargainFinderMax' });
    const serialized = JSON.stringify(context);
    for (const secret of ['T1RLAQ-token', 'c-secret', 'epr-pass', 'Ana']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('usa el nivel pedido', () => {
    const logger = fakeLogger();
    new EventLogger(logger).emit('warn', 'sabre.request.retry');
    expect(logger.warn).toHaveBeenCalledWith('sabre.request.retry', {});
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('un logger que lanza no rompe al SDK', () => {
    const logger = fakeLogger();
    logger.error.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => new EventLogger(logger).emit('error', 'sabre.request.end')).not.toThrow();
  });
});
