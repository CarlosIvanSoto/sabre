import { describe, expect, it } from 'vitest';
import { SabreBusinessError, SabreGatewayError } from '../src/errors/index.js';
import type { SabreRawResponse } from '../src/http/raw-response.js';
import { PREVIOUS_ENTRY_ACTIVE_DELAY_MS, PREVIOUS_ENTRY_ACTIVE_RETRIES } from '../src/http/soap-transport.js';
import { entry, fault, queueRS, rejection, request, setup, soap, success, xml } from './soap-helpers.js';

const ok = () => xml(200, soap(queueRS(success)));
const usg = (code: string) => xml(500, soap(fault('soap-env:Server.SystemError', `${code}: request failed`)));
const previousEntryActive = () => xml(200, soap(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'PREVIOUS ENTRY ACTIVE'))));
const networkError = () => new TypeError('fetch failed');

const READ = { idempotent: true } as const;
const CURSOR = { idempotent: false } as const;

describe('SoapTransport: reintentos ante USG_*_BUSY', () => {
  it.each(['USG_IS_BUSY', 'USG_SERVICE_IS_BUSY', 'USG_CONNECTOR_IS_BUSY'])(
    'reintenta %s también en una operación que mueve el cursor, con backoff de al menos 500 ms',
    async (code) => {
      const { fetch, transport, sleep, calls } = setup(usg(code), ok());

      const result = await transport.request(request(CURSOR));

      expect(result.payloadName).toBe('QueueAccessRS');
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(500);
      const retry = calls.find(([, event]) => event === 'sabre.request.retry');
      expect(retry?.[0]).toBe('warn');
      expect(retry?.[2]).toMatchObject({ protocol: 'soap', service: 'queueAccess', reason: 'busy', attempt: 1 });
    },
  );

  it('agotados los reintentos, lanza el USG_*_BUSY con retryable: true', async () => {
    const { fetch, transport } = setup(usg('USG_IS_BUSY'), usg('USG_IS_BUSY'), usg('USG_IS_BUSY'), usg('USG_IS_BUSY'));

    const error = (await rejection(transport.request(request(CURSOR)))) as SabreGatewayError;

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error.code).toBe('USG_IS_BUSY');
    expect(error.retryable).toBe(true);
  });

  it('respeta retry.maxRetries de la request', async () => {
    const { fetch, transport } = setup(usg('USG_IS_BUSY'), usg('USG_IS_BUSY'));
    const error = (await rejection(transport.request(request({ ...CURSOR, retry: { maxRetries: 1 } })))) as SabreGatewayError;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(error.code).toBe('USG_IS_BUSY');
  });

  it('valida retry antes de llamar a la red', async () => {
    const { fetch, transport } = setup(ok());
    await expect(transport.request(request({ retry: { maxRetries: -1 } }))).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('SoapTransport: PREVIOUS ENTRY ACTIVE', () => {
  it('reintenta 3 veces con 1 s fijo, también en una operación que mueve el cursor', async () => {
    const { fetch, transport, sleep, calls } = setup(previousEntryActive(), previousEntryActive(), previousEntryActive(), ok());

    await expect(transport.request(request(CURSOR))).resolves.toMatchObject({ payloadName: 'QueueAccessRS' });

    expect(PREVIOUS_ENTRY_ACTIVE_RETRIES).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([PREVIOUS_ENTRY_ACTIVE_DELAY_MS, 1000, 1000]);
    expect(calls.filter(([, event]) => event === 'sabre.request.retry').map(([, , ctx]) => ctx?.reason)).toEqual([
      'previous-entry-active',
      'previous-entry-active',
      'previous-entry-active',
    ]);
  });

  it('no se ajusta a retry.maxRetries, y al agotarse lanza con retryable: true', async () => {
    const { fetch, transport } = setup(previousEntryActive(), previousEntryActive(), previousEntryActive(), previousEntryActive());

    const error = (await rejection(transport.request(request({ ...CURSOR, retry: { maxRetries: 0 } })))) as SabreBusinessError;

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error.message).toBe('queueAccess: PREVIOUS ENTRY ACTIVE');
    expect(error.retryable).toBe(true);
  });

  it('también lo reconoce dentro de un SOAP fault', async () => {
    const { fetch, transport } = setup(xml(500, soap(fault('soap-env:Server', 'PREVIOUS ENTRY ACTIVE'))), ok());
    await transport.request(request(CURSOR));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('SoapTransport: fallos de red y transitorios según la idempotencia', () => {
  it('reintenta un fallo de red en una operación idempotente', async () => {
    const { fetch, transport, calls } = setup(networkError(), ok());
    await transport.request(request(READ));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calls.find(([, event]) => event === 'sabre.request.retry')?.[2]).toMatchObject({ reason: 'transient' });
  });

  it('nunca reintenta un fallo de red en una operación que mueve el cursor', async () => {
    const { fetch, transport, sleep } = setup(networkError(), ok());

    const error = (await rejection(transport.request(request(CURSOR)))) as SabreGatewayError;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error.retryable).toBe(false);
  });

  it('agotados los reintentos de red, lanza con retryable: false', async () => {
    const { fetch, transport } = setup(networkError(), networkError(), networkError(), networkError());
    const error = (await rejection(transport.request(request(READ)))) as SabreGatewayError;
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(error.retryable).toBe(false);
  });

  it.each(['USG_SERVICE_PROVIDER_ERROR', 'USG_NO_RESPONSE_FROM_JMSRECEIVER_IN_TIME', 'USG_SECURITY_ICE_ERROR'])(
    'reintenta %s solo si la operación es idempotente',
    async (code) => {
      const read = setup(usg(code), ok());
      await read.transport.request(request(READ));
      expect(read.fetch).toHaveBeenCalledTimes(2);

      const cursor = setup(usg(code), ok());
      const error = (await rejection(cursor.transport.request(request(CURSOR)))) as SabreGatewayError;
      expect(cursor.fetch).toHaveBeenCalledTimes(1);
      expect([error.code, error.retryable]).toEqual([code, false]);
    },
  );

  it('reintenta un 503 sin sobre SOAP solo si la operación es idempotente', async () => {
    const unavailable = () => xml(503, '<html>Service Unavailable</html>', { 'Content-Type': 'text/html' });
    const read = setup(unavailable(), ok());
    await read.transport.request(request(READ));
    expect(read.fetch).toHaveBeenCalledTimes(2);

    const cursor = setup(unavailable(), ok());
    await expect(cursor.transport.request(request(CURSOR))).rejects.toBeInstanceOf(SabreGatewayError);
    expect(cursor.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('SoapTransport: lo que no se reintenta', () => {
  it('USG_RESOURCE_UNAVAILABLE (límite de sesiones) no se reintenta, ni en una operación idempotente', async () => {
    const { fetch, transport } = setup(usg('USG_RESOURCE_UNAVAILABLE'), ok());
    const error = (await rejection(transport.request(request(READ)))) as SabreGatewayError;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([error.code, error.retryable]).toEqual(['USG_RESOURCE_UNAVAILABLE', false]);
  });

  it.each(['USG_INVALID_SESSION', 'USG_AUTHENTICATION_FAILED', 'USG_INVALID_SECURITY_TOKEN'])(
    '%s no se reintenta',
    async (code) => {
      const { fetch, transport } = setup(usg(code), ok());
      const error = (await rejection(transport.request(request(READ)))) as SabreGatewayError;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(error.retryable).toBe(false);
    },
  );

  it('un stl:Error de negocio no se reintenta', async () => {
    const { fetch, transport } = setup(
      xml(200, soap(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED')))),
      ok(),
    );
    const error = (await rejection(transport.request(request(READ)))) as SabreBusinessError;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(error.retryable).toBe(false);
  });

  it('un abort durante la espera se propaga sin otro intento', async () => {
    const controller = new AbortController();
    const { fetch, transport, sleep } = setup(usg('USG_IS_BUSY'), ok());
    sleep.mockImplementationOnce(async () => {
      controller.abort();
      throw controller.signal.reason;
    });

    const error = await rejection(transport.request(request({ ...CURSOR, signal: controller.signal })));
    expect(error).toBe(controller.signal.reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('SoapTransport: onRawResponse con reintentos', () => {
  it('se llama una sola vez, con el último intento y el total de intentos', async () => {
    const raws: SabreRawResponse[] = [];
    const { transport } = setup(usg('USG_IS_BUSY'), ok());

    await transport.request(request({ ...CURSOR, onRawResponse: (raw) => raws.push(raw) }));

    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({ status: 200, attempts: 2 });
    expect(raws[0]!.body).toContain('QueueAccessRS');
  });

  it('cuenta los intentos sin respuesta y entrega el último que sí la tuvo', async () => {
    const raws: SabreRawResponse[] = [];
    const { transport } = setup(usg('USG_IS_BUSY'), networkError(), networkError(), networkError());

    await expect(transport.request(request({ ...READ, onRawResponse: (raw) => raws.push(raw) }))).rejects.toBeInstanceOf(
      SabreGatewayError,
    );

    expect(raws).toHaveLength(1);
    expect(raws[0]).toMatchObject({ status: 500, attempts: 4 });
  });
});
