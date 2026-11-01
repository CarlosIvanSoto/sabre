import { describe, expect, it, vi } from 'vitest';
import type { SabreConfig } from '../src/config.js';
import { SabreGatewayError, SabreLegacy, type SabreSession } from '../src/index.js';
import { installAsyncDispose, sessionCreatePayload, sessionSend } from '../src/session/session.js';
import { mockFetch } from './helpers.js';
import { fault, memoryLogger, rejection, SESSION_TOKEN, soap, tokenHeader, xml } from './soap-helpers.js';

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
    expect(warn?.[2]?.error).toMatchObject({ name: 'SabreGatewayError', code: 'USG_INVALID_SESSION' });
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
