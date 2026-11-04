import { describe, expect, it } from 'vitest';
import type { SabreConfig } from '../src/config.js';
import { SabreBusinessError, SabreGatewayError, SabreLegacy, SabreSessionError } from '../src/index.js';
import { commandToken, MAX_COMMAND_LENGTH, sabreCommandLength, sabreCommandPayload, sabreCommandRequest } from '../src/session/command.js';
import { mockFetch } from './helpers.js';
import { entry, fault, hostError, memoryLogger, SESSION_TOKEN, soap, tokenHeader, xml } from './soap-helpers.js';

const createRS =
  '<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved"><ConversationId>conv</ConversationId></SessionCreateRS>';
const opened = () => xml(200, soap(createRS, tokenHeader(SESSION_TOKEN)));

/**
 * `SabreCommandLLSRS` con la forma de la respuesta real a `DC¥USD1/MXN/20MAR25` del 2025-03-22
 * (test de `sabre-legacy-client@1.0.8`): `stl:HostCommand` repite el comando y la pantalla va en
 * `Response`, con saltos de línea.
 */
function commandRS(screen: string, results = '<stl:Success timeStamp="2025-03-22T18:43:48Z"><stl:SystemSpecificResults><stl:HostCommand LNIATA="6B3525">DC¥USD1/MXN/20MAR25</stl:HostCommand></stl:SystemSpecificResults></stl:Success>'): string {
  return `<SabreCommandLLSRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.0.0"><stl:ApplicationResults status="Complete">${results}</stl:ApplicationResults><Response>${screen}</Response></SabreCommandLLSRS>`;
}

const DC_SCREEN = `RATE BSR 1USD -  19.9845          MXN

MXN        19.9       TRUNCATED

MXN        20         ROUNDED UP TO NEXT   1      - FARES`;

function legacy(fetch: typeof globalThis.fetch, retry: SabreConfig['retry'] = { maxRetries: 0 }) {
  const { logger, calls } = memoryLogger();
  const config: SabreConfig = {
    environment: 'production',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:H8GI:AA', password: 'epr-pass' },
    fetch,
    logger,
    retry,
  };
  return { client: new SabreLegacy(config), calls };
}

function body(fetch: ReturnType<typeof mockFetch>, call: number): string {
  return String(fetch.mock.calls[call]?.[1]?.body);
}

describe('sabreCommandPayload', () => {
  it('arma SabreCommandLLSRQ 2.0.0 con Output="SCREEN" y ReturnHostCommand="true"', () => {
    expect(sabreCommandPayload('W/PT¥*')).toBe(
      '<SabreCommandLLSRQ xmlns="http://webservices.sabre.com/sabreXML/2011/10" Version="2.0.0" ReturnHostCommand="true"><Request Output="SCREEN"><HostCommand>W/PT¥*</HostCommand></Request></SabreCommandLLSRQ>',
    );
  });

  it('manda el comando tal cual: no normaliza ‡ y solo escapa XML', () => {
    expect(sabreCommandPayload('W/PT‡ON')).toContain('<HostCommand>W/PT‡ON</HostCommand>');
    expect(sabreCommandPayload('*A<B>&"')).toContain('<HostCommand>*A&lt;B&gt;&amp;&quot;</HostCommand>');
  });
});

describe('commandToken', () => {
  it.each<[string, string]>([
    ['W/PT¥*', 'W/PT'],
    ['W/PT‡ON', 'W/PT'],
    ['DC¥USD1/MXN/19MAR25', 'DC'],
    ['*IM', '*IM'],
    ['SI9', 'SI9'],
    ['  *S*P ', '*S*P'],
    ['*ABC123', '*ABC'],
    ['N-SMITH/JOHN', 'N-SM'],
    ['AAAH8GI', 'AAAH'],
  ])('%s → %s', (command, token) => {
    expect(commandToken(command)).toBe(token);
  });
});

describe('sabreCommandLength', () => {
  it.each<[string, number]>([
    ['W/PT¥*', 7],
    ['*IM', 3],
    ['!%$&¥§', 12],
    ['‡', 1],
    ['', 0],
  ])('%s → %i', (command, length) => {
    expect(sabreCommandLength(command)).toBe(length);
  });
});

describe('sabreCommandRequest', () => {
  it(`acepta hasta ${MAX_COMMAND_LENGTH} contados como Sabre`, () => {
    expect(() => sabreCommandRequest('A'.repeat(MAX_COMMAND_LENGTH), {})).not.toThrow();
    expect(() => sabreCommandRequest(`${'¥'.repeat(511)}A`, {})).not.toThrow();
  });

  it.each<[string, string]>([
    ['1024 caracteres simples', 'A'.repeat(MAX_COMMAND_LENGTH + 1)],
    ['512 ¥ (cuentan 2 cada uno)', '¥'.repeat(512)],
  ])('rechaza %s con TypeError', (_, command) => {
    expect(() => sabreCommandRequest(command, {})).toThrow(TypeError);
    expect(() => sabreCommandRequest(command, {})).toThrow(/^sabre-client: command mide 1024 y el máximo es 1023/);
  });

  it('sin reintento por defecto; con idempotent: true entra en la política', () => {
    expect(sabreCommandRequest('W/PT¥*', {}).idempotent).toBe(false);
    expect(sabreCommandRequest('W/PT¥*', { idempotent: true }).idempotent).toBe(true);
  });

  it.each<[string, unknown, Record<string, unknown>, string]>([
    ['un comando vacío', '', {}, 'sabre-client: command es requerido'],
    ['un comando en blanco', '   ', {}, 'sabre-client: command es requerido'],
    ['un comando que no es string', 42, {}, 'sabre-client: command es requerido'],
    ['idempotent que no es boolean', 'W/PT¥*', { idempotent: 'yes' }, 'sabre-client: idempotent debe ser un boolean'],
  ])('rechaza %s con TypeError', (_, command, options, message) => {
    expect(() => sabreCommandRequest(command as string, options as never)).toThrow(TypeError);
    expect(() => sabreCommandRequest(command as string, options as never)).toThrow(message);
  });
});

describe('session.command', () => {
  it('manda el comando dentro de la sesión y devuelve la pantalla cruda con el messageId', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS(DC_SCREEN))));
    const session = await legacy(fetch).client.openSession();

    const screen = await session.command('DC¥USD1/MXN/20MAR25');

    expect(screen).toEqual({ text: DC_SCREEN, warnings: [], messageId: '3412287548732070140' });
    const sent = body(fetch, 1);
    expect(sent).toContain('<eb:Action>SabreCommandLLSRQ</eb:Action>');
    expect(sent).toContain('<HostCommand>DC¥USD1/MXN/20MAR25</HostCommand>');
    expect(sent).toContain(`>${SESSION_TOKEN}</wsse:BinarySecurityToken>`);
  });

  it('entrega la pantalla sin recortar: espacios al principio, al final y saltos de línea', async () => {
    const screen = ' 17MAR  WED   MEX/CST                \n  1 AM  402  Y    MEXCUN  0700  0915\n';
    const fetch = mockFetch(opened(), xml(200, soap(commandRS(screen))));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('1MEXCUN17MAR')).resolves.toMatchObject({ text: screen });
  });

  it('un comando que excede el largo lanza TypeError sin llamar a la red', async () => {
    const fetch = mockFetch(opened());
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('¥'.repeat(512))).rejects.toThrow(TypeError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('un mensaje de host en la pantalla no lanza: llega en text', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('DUTY CODE 9 REQUIRED'))));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('W/PT¥ON')).resolves.toMatchObject({ text: 'DUTY CODE 9 REQUIRED' });
  });

  it('sin Response la pantalla queda vacía', async () => {
    const rs = '<SabreCommandLLSRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" Version="2.0.0"/>';
    const fetch = mockFetch(opened(), xml(200, soap(rs)));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('*IM')).resolves.toMatchObject({ text: '' });
  });

  it('los stl:Warning llegan en warnings y no lanzan', async () => {
    const results = entry('Warning', 'WARN.SWS.HOST.WARNING_IN_RESPONSE', 'CHECK FORMAT');
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('OK', results))));
    const session = await legacy(fetch).client.openSession();

    const screen = await session.command('W/PT¥*');
    expect(screen.warnings).toHaveLength(1);
    expect(screen.warnings[0]?.code).toBe('WARN.SWS.HOST.WARNING_IN_RESPONSE');
  });

  it('lee un stl:Warning con la forma del diseño: HostCommand, Message@code y ShortText', async () => {
    const results =
      '<stl:Warning type="BusinessLogic" timeStamp="2026-11-04T12:00:00Z"><stl:SystemSpecificResults><stl:HostCommand LNIATA="6B3525">W/PT¥*</stl:HostCommand><stl:Message code="12">CHECK FORMAT</stl:Message><stl:ShortText>WARN.SWS.HOST.WARNING_IN_RESPONSE</stl:ShortText></stl:SystemSpecificResults></stl:Warning>';
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('OK', results))));
    const session = await legacy(fetch).client.openSession();

    const screen = await session.command('W/PT¥*');
    expect(screen.warnings).toHaveLength(1);
    expect(screen.warnings[0]?.code).toBe('12');
    expect(screen.warnings[0]?.message).toBe('sabreCommand: CHECK FORMAT (WARN.SWS.HOST.WARNING_IN_RESPONSE)');
  });

  it.each(['Application', 'BusinessLogic'])('un stl:Error type="%s" con la forma del diseño lanza SabreBusinessError', async (type) => {
    const results = `<stl:Error type="${type}" timeStamp="2026-11-04T12:00:00Z"><stl:SystemSpecificResults><stl:HostCommand LNIATA="6B3525">W/PT¥*</stl:HostCommand><stl:Message code="3">INVALID ACTION CODE</stl:Message><stl:ShortText>ERR.SWS.HOST.ERROR_IN_RESPONSE</stl:ShortText></stl:SystemSpecificResults></stl:Error>`;
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('', results))));
    const session = await legacy(fetch).client.openSession();

    const error = await session.command('W/PT¥*').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SabreBusinessError);
    expect(error).toMatchObject({ code: '3', message: 'sabreCommand: INVALID ACTION CODE (ERR.SWS.HOST.ERROR_IN_RESPONSE)' });
  });

  it('un stl:Error lanza SabreBusinessError', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('', hostError('INVALID FORMAT')))));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('W/PT¥*')).rejects.toBeInstanceOf(SabreBusinessError);
  });

  it('un SOAP fault lanza SabreGatewayError; uno de sesión, SabreSessionError', async () => {
    const fetch = mockFetch(
      opened(),
      xml(500, soap(fault('soap-env:Server', 'ERR.SWS.HOST.ERROR'))),
      xml(500, soap(fault('soap-env:Client.InvalidSecurityToken', 'Invalid or Expired binary security token', '<StackTrace>USG_INVALID_SECURITY_TOKEN</StackTrace>'))),
    );
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('W/PT¥*')).rejects.toBeInstanceOf(SabreGatewayError);
    await expect(session.command('W/PT¥*')).rejects.toBeInstanceOf(SabreSessionError);
  });

  it('otra respuesta en el Body es un SabreGatewayError', async () => {
    const fetch = mockFetch(opened(), xml(200, soap('<OTA_PingRS xmlns="http://www.opentravel.org/OTA/2003/05"><Success/></OTA_PingRS>')));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('W/PT¥*')).rejects.toThrow('sabreCommand: respuesta no reconocida (OTA_PingRS)');
  });

  it('sin idempotent no reintenta un fallo de red', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'), xml(200, soap(commandRS('UPDATE OK'))));
    const session = await legacy(fetch, { maxRetries: 1 }).client.openSession();

    await expect(session.command('W/PT¥ON')).rejects.toBeInstanceOf(SabreGatewayError);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('con idempotent: true reintenta un fallo de red', async () => {
    const fetch = mockFetch(opened(), new TypeError('fetch failed'), xml(200, soap(commandRS('PSGR TYPE - ON'))));
    const session = await legacy(fetch, { maxRetries: 1, baseDelayMs: 0 }).client.openSession();

    await expect(session.command('W/PT¥*', { idempotent: true })).resolves.toMatchObject({ text: 'PSGR TYPE - ON' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('en debug loguea solo el token del comando, nunca el comando ni la pantalla', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('*ABC123 SMITH/JOHN'))));
    const { client, calls } = legacy(fetch);
    const session = await client.openSession();

    await session.command('*ABC123');

    expect(calls).toContainEqual(['debug', 'sabre.session.command', { command: '*ABC' }]);
    const logged = JSON.stringify(calls);
    expect(logged).not.toContain('ABC123');
    expect(logged).not.toContain('SMITH');
  });

  it('entrega la respuesta completa a onRawResponse con operation "command"', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('PSGR TYPE - OFF'))));
    const session = await legacy(fetch).client.openSession();
    const raws: Array<{ operation: string; body: string }> = [];

    await session.command('W/PT¥*', { onRawResponse: (raw) => raws.push(raw) });

    expect(raws).toHaveLength(1);
    expect(raws[0]?.operation).toBe('command');
    expect(raws[0]?.body).toContain('PSGR TYPE - OFF');
  });

  it('valida sin red y es exclusiva como el resto de la sesión', async () => {
    const fetch = mockFetch(opened(), xml(200, soap(commandRS('OK'))));
    const session = await legacy(fetch).client.openSession();

    await expect(session.command('')).rejects.toThrow(TypeError);
    const first = session.command('W/PT¥*');
    await expect(session.command('W/PT¥*')).rejects.toThrow('sabre-client: session busy');
    await first;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
