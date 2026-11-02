import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SabreConfig } from '../src/config.js';
import { SabreBusinessError, SabreGatewayError, SabreLegacy, type SabreSession, SabreSessionError } from '../src/index.js';
import {
  installAsyncDispose,
  KEEP_ALIVE_IDLE_MS,
  sessionCreatePayload,
  sessionSend,
  toSessionError,
} from '../src/session/session.js';
import { mockFetch } from './helpers.js';
import { entry, fault, memoryLogger, queueRS, rejection, SESSION_TOKEN, soap, tokenHeader, xml } from './soap-helpers.js';

const password = 'epr-pass';
const clientId = 'app-client-id';
const clientSecret = 'app-client-secret';

const createRS = (status = 'Approved') =>
  `<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="${status}"><ConversationId>conv</ConversationId></SessionCreateRS>`;
const closeRS = '<SessionCloseRS version="1" status="Approved" xmlns="http://www.opentravel.org/OTA/2002/11"/>';
const pingRS = '<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0.0"><Success/></OTA_PingRS>';

const opened = () => xml(200, soap(createRS(), tokenHeader(SESSION_TOKEN)));
const closed = () => xml(200, soap(closeRS));
const pinged = () => xml(200, soap(pingRS));

function legacy(fetch: typeof globalThis.fetch, credentials: Record<string, unknown> = {}) {
  const { logger, calls } = memoryLogger();
  const config: SabreConfig = {
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:H8GI:AA', password, ...credentials } as never,
    fetch,
    logger,
    retry: { maxRetries: 0 },
  };
  return { client: new SabreLegacy(config), calls };
}

function body(fetch: ReturnType<typeof mockFetch>, call: number): string {
  return String(fetch.mock.calls[call]?.[1]?.body);
}

function tag(envelope: string, name: string): string | undefined {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(envelope)?.[1];
}

/** Request de prueba dentro de la sesión (las operaciones reales llegan con #87 y la Fase 2). */
const ping = (session: SabreSession) =>
  session[sessionSend]({
    service: 'ping',
    action: 'OTA_PingRQ',
    payload: '<OTA_PingRQ Version="1.0.0"/>',
    idempotent: true,
  });

describe('SessionCreateRQ', () => {
  it('con clientId y clientSecret manda la 2.0.0 con ClientId y ClientSecret', async () => {
    const fetch = mockFetch(opened());
    await legacy(fetch, { clientId, clientSecret }).client.openSession();

    const envelope = body(fetch, 0);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://webservices.platform.sabre.com');
    expect(envelope).toContain(
      '<soap-env:Body><SessionCreateRQ xmlns="http://webservices.sabre.com" Version="2.0.0"><POS><Source PseudoCityCode="H8GI"/></POS></SessionCreateRQ></soap-env:Body>',
    );
    expect(tag(envelope, 'eb:Action')).toBe('SessionCreateRQ');
    expect(tag(envelope, 'eb:CPAId')).toBe('H8GI');
    expect(envelope).toContain(
      `<wsse:UsernameToken><wsse:Username>7971</wsse:Username><wsse:Password>${password}</wsse:Password><Organization>H8GI</Organization><Domain>AA</Domain><ClientId>${clientId}</ClientId><ClientSecret>${clientSecret}</ClientSecret></wsse:UsernameToken>`,
    );
  });

  it('sin clientId ni clientSecret manda la 1.0.0 en el namespace OTA, sin ClientId', async () => {
    const fetch = mockFetch(opened());
    await legacy(fetch).client.openSession();

    const envelope = body(fetch, 0);
    expect(envelope).toContain(
      '<soap-env:Body><SessionCreateRQ xmlns="http://www.opentravel.org/OTA/2002/11" Version="1.0.0" returnContextID="true"><POS><Source PseudoCityCode="H8GI"/></POS></SessionCreateRQ></soap-env:Body>',
    );
    expect(envelope).toContain(
      `<wsse:UsernameToken><wsse:Username>7971</wsse:Username><wsse:Password>${password}</wsse:Password><Organization>H8GI</Organization><Domain>AA</Domain></wsse:UsernameToken>`,
    );
    expect(envelope).not.toContain('ClientId');
    expect(envelope).not.toContain('ClientSecret');
  });

  it('escapa el PCC en el cuerpo', () => {
    expect(sessionCreatePayload({ version: '1.0.0', organization: 'A&B' })).toContain('PseudoCityCode="A&amp;B"');
  });

  it('registra la versión elegida al abrir, sin credenciales ni token', async () => {
    const { client, calls } = legacy(mockFetch(opened()), { clientId, clientSecret });
    await client.openSession();

    expect(calls).toContainEqual(['info', 'sabre.session.open', { version: '2.0.0', pseudoCityCode: 'H8GI' }]);
    const logged = JSON.stringify(calls);
    for (const secret of [password, clientId, clientSecret, SESSION_TOKEN, '7971']) expect(logged).not.toContain(secret);
  });

  it('una respuesta sin BinarySecurityToken es un SabreGatewayError', async () => {
    const error = await rejection(legacy(mockFetch(xml(200, soap(createRS())))).client.openSession());
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toBe('sessionCreate: la respuesta no trae BinarySecurityToken');
  });

  it('un SessionCreateRS sin status Approved es un SabreGatewayError', async () => {
    const error = await rejection(
      legacy(mockFetch(xml(200, soap(createRS('Rejected'), tokenHeader(SESSION_TOKEN))))).client.openSession(),
    );
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toBe('sessionCreate: SessionCreateRS con status Rejected');
  });

  it('USG_RESOURCE_UNAVAILABLE no se reintenta', async () => {
    const fetch = mockFetch(xml(500, soap(fault('soap-env:Client.ResourceUnavailable', 'USG_RESOURCE_UNAVAILABLE'))));
    const { client } = legacy(fetch);
    const error = await rejection(client.openSession({ retry: { maxRetries: 3, baseDelayMs: 0 } }));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as SabreGatewayError).code).toBe('USG_RESOURCE_UNAVAILABLE');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('entrega la respuesta cruda como openSession, con el token redactado', async () => {
    const onRawResponse = vi.fn();
    await legacy(mockFetch(opened())).client.openSession({ onRawResponse });
    expect(onRawResponse).toHaveBeenCalledOnce();
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'openSession', protocol: 'soap' });
    expect(onRawResponse.mock.calls[0]?.[0].body).not.toContain(SESSION_TOKEN);
  });
});

describe('SabreSession', () => {
  it('usa el token y el ConversationId de la apertura en cada llamada', async () => {
    const fetch = mockFetch(opened(), pinged());
    const session = await legacy(fetch).client.openSession();
    await ping(session);

    const create = body(fetch, 0);
    const next = body(fetch, 1);
    expect(tag(create, 'eb:ConversationId')).toMatch(/^[0-9a-f-]{36}$/);
    expect(tag(next, 'eb:ConversationId')).toBe(tag(create, 'eb:ConversationId'));
    expect(tag(next, 'eb:CPAId')).toBe('H8GI');
    expect(next).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
    expect(next).not.toContain('UsernameToken');
  });

  it('cada sesión tiene su propio ConversationId', async () => {
    const fetch = mockFetch(opened(), opened());
    const { client } = legacy(fetch);
    await client.openSession();
    await client.openSession();
    expect(tag(body(fetch, 0), 'eb:ConversationId')).not.toBe(tag(body(fetch, 1), 'eb:ConversationId'));
  });

  it('close manda SessionCloseRQ 1.0.1 con el token de la sesión', async () => {
    const fetch = mockFetch(opened(), closed());
    const { client, calls } = legacy(fetch);
    const session = await client.openSession();
    await session.close();

    const envelope = body(fetch, 1);
    expect(tag(envelope, 'eb:Action')).toBe('SessionCloseRQ');
    expect(envelope).toContain(
      '<soap-env:Body><SessionCloseRQ Version="1.0.1"><POS><Source PseudoCityCode="H8GI"/></POS></SessionCloseRQ></soap-env:Body>',
    );
    expect(envelope).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
    expect(calls).toContainEqual(['info', 'sabre.session.close', { pseudoCityCode: 'H8GI' }]);
  });

  it('close es idempotente: la segunda llamada no vuelve a la red', async () => {
    const fetch = mockFetch(opened(), closed());
    const session = await legacy(fetch).client.openSession();
    const first = session.close();
    const second = session.close();
    expect(second).toBe(first);
    await first;
    await session.close();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un close que falló no se repite: devuelve el mismo error sin red', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'));
    const session = await legacy(fetch).client.openSession();
    const first = await rejection(session.close());
    expect(first).toBeInstanceOf(SabreGatewayError);
    expect(await rejection(session.close())).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('después de close, las llamadas lanzan TypeError sin red', async () => {
    const fetch = mockFetch(opened(), closed());
    const session = await legacy(fetch).client.openSession();
    await session.close();
    const error = await rejection(ping(session));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('sabre-client: session closed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('una segunda llamada en vuelo lanza TypeError: session busy, sin red', async () => {
    let release!: (response: Response) => void;
    const fetch = mockFetch(opened());
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
    fetch.mockResolvedValueOnce(pinged());
    const session = await legacy(fetch).client.openSession();

    const inFlight = ping(session);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const second = await rejection(ping(session));
    const closing = await rejection(session.close());
    for (const error of [second, closing]) {
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe('sabre-client: session busy');
    }
    expect(fetch).toHaveBeenCalledTimes(2);

    release(pinged());
    await inFlight;
    // Terminada la primera, la sesión vuelve a estar libre.
    await ping(session);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('una llamada que falla libera la sesión', async () => {
    const fetch = mockFetch(opened(), xml(500, soap(fault('soap-env:Client', 'USG_INVALID_ACTION'))), pinged());
    const session = await legacy(fetch).client.openSession();
    await rejection(ping(session));
    await ping(session);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it.runIf((Symbol as { asyncDispose?: symbol }).asyncDispose !== undefined)(
    'Symbol.asyncDispose cierra la sesión',
    async () => {
      const fetch = mockFetch(opened(), closed());
      const session = await legacy(fetch).client.openSession();
      const dispose = (session as unknown as Record<symbol, () => Promise<void>>)[
        (Symbol as unknown as { asyncDispose: symbol }).asyncDispose
      ];
      await dispose!.call(session);
      expect(tag(body(fetch, 1), 'eb:Action')).toBe('SessionCloseRQ');
    },
  );

  it('sin Symbol.asyncDispose en el runtime no define nada', () => {
    const target = {};
    installAsyncDispose(target, undefined);
    expect(Object.getOwnPropertySymbols(target)).toEqual([]);
  });
});

describe('withSession', () => {
  it('devuelve lo mismo que el callback y cierra la sesión', async () => {
    const fetch = mockFetch(opened(), closed());
    const result = await legacy(fetch).client.withSession(async (session) => {
      expect(session).toBeDefined();
      return { visited: 3 };
    });
    expect(result).toEqual({ visited: 3 });
    expect(tag(body(fetch, 1), 'eb:Action')).toBe('SessionCloseRQ');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('si el callback lanza, cierra la sesión y propaga el error', async () => {
    const fetch = mockFetch(opened(), closed());
    const boom = new Error('regla del consumidor');
    const error = await rejection(
      legacy(fetch).client.withSession(async () => {
        throw boom;
      }),
    );
    expect(error).toBe(boom);
    expect(tag(body(fetch, 1), 'eb:Action')).toBe('SessionCloseRQ');
  });

  it('si el cierre falla y el callback salió bien, emite un warn y devuelve el resultado', async () => {
    const fetch = mockFetch(opened(), xml(500, soap(fault('soap-env:Client', 'USG_INVALID_SESSION'))));
    const { client, calls } = legacy(fetch);
    expect(await client.withSession(async () => 'ok')).toBe('ok');

    const warn = calls.find(([, event]) => event === 'sabre.session.closeFailed');
    expect(warn?.[0]).toBe('warn');
    expect(warn?.[2]?.error).toMatchObject({ name: 'SabreSessionError', kind: 'invalid', code: 'USG_INVALID_SESSION' });
    expect(JSON.stringify(calls)).not.toContain(SESSION_TOKEN);
  });

  it('si fallan el callback y el cierre, propaga el error original y emite un warn', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'));
    const { client, calls } = legacy(fetch);
    const boom = new Error('regla del consumidor');
    const error = await rejection(
      client.withSession(async () => {
        throw boom;
      }),
    );
    expect(error).toBe(boom);
    expect(calls.some(([level, event]) => level === 'warn' && event === 'sabre.session.closeFailed')).toBe(true);
  });

  it('si el callback ya cerró la sesión, no la vuelve a cerrar', async () => {
    const fetch = mockFetch(opened(), closed());
    await legacy(fetch).client.withSession(async (session) => {
      await session.close();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('si la apertura falla, no llama al callback', async () => {
    const fetch = mockFetch(xml(500, soap(fault('soap-env:Client', 'USG_AUTHENTICATION_FAILED'))));
    const callback = vi.fn(async () => 'ok');
    const error = await rejection(legacy(fetch).client.withSession(callback));
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(callback).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

const usgFault = (code: string) => xml(500, soap(fault('soap-env:Client', code)));

describe('SabreSessionError', () => {
  it('es un SabreGatewayError SOAP con kind, y toJSON lo incluye sin raw', () => {
    const error = new SabreSessionError('ping: SOAP fault', {
      kind: 'expired',
      code: 'USG_INVALID_SECURITY_TOKEN',
      retryable: false,
      raw: '<sobre/>',
    });
    expect(error).toBeInstanceOf(SabreSessionError);
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error.name).toBe('SabreSessionError');
    expect(error.protocol).toBe('soap');
    expect(error.kind).toBe('expired');
    expect(error.raw).toBe('<sobre/>');
    expect(JSON.parse(JSON.stringify(error))).toMatchObject({ kind: 'expired', code: 'USG_INVALID_SECURITY_TOKEN' });
    expect(JSON.stringify(error)).not.toContain('<sobre/>');
  });

  it.each<[string, string]>([
    ['USG_RESOURCE_UNAVAILABLE', 'limit'],
    ['USG_INVALID_SESSION', 'invalid'],
    ['USG_INVALID_SECURITY_TOKEN', 'expired'],
    ['USG_AUTHENTICATION_FAILED', 'expired'],
    ['USG_RESOURCE_BLOCKED', 'blocked'],
  ])('dentro de la sesión, %s es kind %s', async (code, kind) => {
    const fetch = mockFetch(opened(), usgFault(code));
    const session = await legacy(fetch).client.openSession();
    const error = await rejection(ping(session));
    expect(error).toBeInstanceOf(SabreSessionError);
    expect(error).toMatchObject({ kind, code, protocol: 'soap', status: 500, retryable: false });
    expect((error as SabreSessionError).raw).toContain(code);
    expect((error as SabreSessionError).raw).not.toContain(SESSION_TOKEN);
  });

  it.each<[string, string]>([
    ['USG_RESOURCE_UNAVAILABLE', 'limit'],
    ['USG_RESOURCE_BLOCKED', 'blocked'],
  ])('al abrir, %s es kind %s', async (code, kind) => {
    const error = await rejection(legacy(mockFetch(usgFault(code))).client.openSession());
    expect(error).toBeInstanceOf(SabreSessionError);
    expect(error).toMatchObject({ kind, code });
  });

  it.each(['USG_AUTHENTICATION_FAILED', 'USG_INVALID_SECURITY_TOKEN', 'USG_INVALID_SESSION'])(
    'al abrir, %s sigue como SabreGatewayError: todavía no hay sesión',
    async (code) => {
      const error = await rejection(legacy(mockFetch(usgFault(code))).client.openSession());
      expect(error).toBeInstanceOf(SabreGatewayError);
      expect(error).not.toBeInstanceOf(SabreSessionError);
      expect((error as SabreGatewayError).code).toBe(code);
    },
  );

  it('los demás errores salen igual y no inutilizan la sesión', async () => {
    const business = xml(200, soap(queueRS(entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED'))));
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_ACTION'), business, pinged());
    const session = await legacy(fetch).client.openSession();
    const gateway = await rejection(ping(session));
    expect(gateway).toBeInstanceOf(SabreGatewayError);
    expect(gateway).not.toBeInstanceOf(SabreSessionError);
    expect(await rejection(ping(session))).toBeInstanceOf(SabreBusinessError);
    await ping(session);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('toSessionError deja pasar lo que no es un fault SOAP de sesión', () => {
    const rest = new SabreGatewayError('x', { protocol: 'rest', retryable: false, code: 'USG_INVALID_SESSION' });
    const plain = new Error('x');
    expect(toSessionError(rest)).toBe(rest);
    expect(toSessionError(plain)).toBe(plain);
  });
});

describe('sesión inutilizable', () => {
  it('después de un SabreSessionError, las llamadas lanzan TypeError sin red', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_SECURITY_TOKEN'));
    const session = await legacy(fetch).client.openSession();
    const cause = await rejection(ping(session));

    const error = await rejection(ping(session));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('sabre-client: session unusable (expired)');
    expect((error as Error).cause).toBe(cause);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('close() de una sesión inutilizable no va a la red y queda cerrada', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_SESSION'));
    const session = await legacy(fetch).client.openSession();
    await rejection(ping(session));
    await session.close();
    expect((await rejection(ping(session)) as Error).message).toBe('sabre-client: session closed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('un close() que recibe un error de sesión lo lanza como SabreSessionError', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_SECURITY_TOKEN'));
    const session = await legacy(fetch).client.openSession();
    const error = await rejection(session.close());
    expect(error).toBeInstanceOf(SabreSessionError);
    expect((error as SabreSessionError).kind).toBe('expired');
  });

  it('withSession propaga el SabreSessionError, no reabre y no intenta el cierre', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_SECURITY_TOKEN'));
    const { client, calls } = legacy(fetch);
    const callback = vi.fn(async (session: SabreSession) => {
      await ping(session);
    });
    const error = await rejection(client.withSession(callback));
    expect(error).toBeInstanceOf(SabreSessionError);
    expect(callback).toHaveBeenCalledOnce();
    // Una sola apertura, ninguna reapertura, y el cierre no va a la red.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(calls.some(([, event]) => event === 'sabre.session.closeFailed')).toBe(false);
  });
});

const MINUTE = 60_000;

/** `fetch` cuya siguiente respuesta queda pendiente hasta `release`. */
function pendingOnce(fetch: ReturnType<typeof mockFetch>) {
  let release!: (response: Response) => void;
  fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));
  return (response: Response) => release(response);
}

const actions = (fetch: ReturnType<typeof mockFetch>) =>
  fetch.mock.calls.map(([, init]) => tag(String(init?.body), 'eb:Action'));

describe('ping', () => {
  it('manda OTA_PingRQ 1.0.0 con el token de la sesión', async () => {
    const fetch = mockFetch(opened(), pinged());
    const session = await legacy(fetch).client.openSession();
    await session.ping();

    const envelope = body(fetch, 1);
    expect(tag(envelope, 'eb:Action')).toBe('OTA_PingRQ');
    expect(envelope).toMatch(
      /<soap-env:Body><OTA_PingRQ xmlns="http:\/\/www.opentravel.org\/OTA\/2003\/05" TimeStamp="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z" Version="1.0.0"><EchoData>sabre-client<\/EchoData><\/OTA_PingRQ><\/soap-env:Body>/,
    );
    expect(envelope).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
  });

  it('lanza SabreGatewayError si OTA_PingRS trae Errors con HTTP 200', async () => {
    // Tal cual respondió producción el 2026-11-02 a un OTA_PingRQ sin namespace (#95).
    const invalidVersion =
      '<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0.0"><Errors><Error Type="VER">Invalid version</Error></Errors></OTA_PingRS>';
    const session = await legacy(mockFetch(opened(), xml(200, soap(invalidVersion, tokenHeader(SESSION_TOKEN))))).client.openSession();
    const error = await rejection(session.ping());
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error).not.toBeInstanceOf(SabreSessionError);
    expect(error).toMatchObject({ message: 'ping: OTA_PingRS con error: Invalid version', code: 'VER', status: 200, retryable: false });
    expect((error as SabreGatewayError).raw).toContain('>[REDACTED]</wsse:BinarySecurityToken>');
  });

  it('lanza SabreGatewayError si OTA_PingRS no trae Success', async () => {
    const empty = '<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05" Version="1.0.0"/>';
    const session = await legacy(mockFetch(opened(), xml(200, soap(empty)))).client.openSession();
    const error = await rejection(session.ping());
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect((error as Error).message).toBe('ping: respuesta no reconocida (sin OTA_PingRS/Success)');
  });

  it('es idempotente: se reintenta ante un fallo de red', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'), pinged());
    const session = await legacy(fetch).client.openSession();
    await session.ping({ retry: { maxRetries: 1, baseDelayMs: 0 } });
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'OTA_PingRQ', 'OTA_PingRQ']);
  });

  it('entrega la respuesta cruda como ping', async () => {
    const onRawResponse = vi.fn();
    const session = await legacy(mockFetch(opened(), pinged())).client.openSession();
    await session.ping({ onRawResponse });
    expect(onRawResponse.mock.calls[0]?.[0]).toMatchObject({ operation: 'ping', protocol: 'soap' });
  });

  it('respeta el uso exclusivo y la sesión cerrada', async () => {
    const fetch = mockFetch(opened(), closed());
    const session = await legacy(fetch).client.openSession();
    await session.close();
    expect(((await rejection(session.ping())) as Error).message).toBe('sabre-client: session closed');
  });
});

describe('idleMs y keepAlive', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-01T12:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('idleMs cuenta desde la última respuesta de Sabre, y vale 0 con una llamada en vuelo', async () => {
    const fetch = mockFetch(opened());
    const session = await legacy(fetch).client.openSession();
    expect(session.idleMs).toBe(0);

    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(session.idleMs).toBe(5 * MINUTE);

    const release = pendingOnce(fetch);
    const ping = session.ping();
    expect(session.idleMs).toBe(0);
    await vi.advanceTimersByTimeAsync(MINUTE);
    release(pinged());
    await ping;
    expect(session.idleMs).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(session.idleMs).toBe(2 * MINUTE);
  });

  it('un error que respondió Sabre reinicia idleMs; un fallo de red no', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_ACTION'), new TypeError('fetch failed'));
    const session = await legacy(fetch).client.openSession();
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    await rejection(session.ping());
    expect(session.idleMs).toBe(0);

    await vi.advanceTimersByTimeAsync(3 * MINUTE);
    await rejection(session.ping());
    expect(session.idleMs).toBe(3 * MINUTE);
  });

  it('keepAlive viene apagado: no hay ping aunque pasen 20 minutos', async () => {
    const fetch = mockFetch(opened());
    await legacy(fetch).client.openSession();
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('con keepAlive, manda el ping a los 13 minutos de inactividad, una y otra vez', async () => {
    expect(KEEP_ALIVE_IDLE_MS).toBe(13 * MINUTE);
    const fetch = mockFetch(opened(), pinged(), pinged());
    await legacy(fetch).client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(13 * MINUTE - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'OTA_PingRQ']);
    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'OTA_PingRQ', 'OTA_PingRQ']);
  });

  it('cada respuesta de Sabre corre el ping de keepAlive', async () => {
    const fetch = mockFetch(opened(), pinged(), pinged());
    const session = await legacy(fetch).client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    await session.ping();
    await vi.advanceTimersByTimeAsync(12 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('close() apaga keepAlive', async () => {
    const fetch = mockFetch(opened(), closed());
    const session = await legacy(fetch).client.openSession({ keepAlive: true });
    await session.close();
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'SessionCloseRQ']);
  });

  it('una llamada del consumidor durante el ping de keepAlive lo espera, sin session busy', async () => {
    const fetch = mockFetch(opened());
    const release = pendingOnce(fetch);
    fetch.mockResolvedValueOnce(pinged());
    const session = await legacy(fetch).client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(2);
    const consumer = session.ping();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    release(pinged());
    await consumer;
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'OTA_PingRQ', 'OTA_PingRQ']);
  });

  it('close() durante el ping de keepAlive cierra cuando termina', async () => {
    const fetch = mockFetch(opened());
    const release = pendingOnce(fetch);
    fetch.mockResolvedValueOnce(closed());
    const session = await legacy(fetch).client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    const closing = session.close();
    expect(session.close()).toBe(closing);
    release(pinged());
    await closing;
    expect(actions(fetch)).toEqual(['SessionCreateRQ', 'OTA_PingRQ', 'SessionCloseRQ']);
  });

  it('si el ping de keepAlive falla, emite un warn y keepAlive se apaga', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'), pinged());
    const { client, calls } = legacy(fetch);
    const session = await client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    const warn = calls.find(([, event]) => event === 'sabre.session.keepAliveFailed');
    expect(warn?.[0]).toBe('warn');
    expect(warn?.[2]?.error).toMatchObject({ name: 'SabreGatewayError' });
    await vi.advanceTimersByTimeAsync(60 * MINUTE);
    expect(fetch).toHaveBeenCalledTimes(2);
    // La sesión sigue usable: el fallo de red no es un error de sesión.
    await session.ping();
  });

  it('si el ping de keepAlive recibe un error de sesión, la sesión queda inutilizable', async () => {
    const fetch = mockFetch(opened(), usgFault('USG_INVALID_SECURITY_TOKEN'));
    const { client, calls } = legacy(fetch);
    const session = await client.openSession({ keepAlive: true });

    await vi.advanceTimersByTimeAsync(13 * MINUTE);
    expect(calls.find(([, event]) => event === 'sabre.session.keepAliveFailed')?.[2]?.error).toMatchObject({
      name: 'SabreSessionError',
      kind: 'expired',
    });
    expect(((await rejection(session.ping())) as Error).message).toBe('sabre-client: session unusable (expired)');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keepAlive tiene que ser un boolean', async () => {
    const fetch = mockFetch();
    const error = await rejection(legacy(fetch).client.openSession({ keepAlive: 'yes' as never }));
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe('sabre-client: keepAlive debe ser un boolean');
    expect(fetch).not.toHaveBeenCalled();
  });
});
