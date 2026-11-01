import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { SabreBusinessError, SabreGatewayError, SabreWarning } from '../src/errors/index.js';
import type { SabreRawResponse } from '../src/http/raw-response.js';
import { type SoapRequest, SoapTransport } from '../src/http/soap-transport.js';
import type { SabreLogger } from '../src/logging/index.js';
import { REDACTED } from '../src/logging/redact.js';
import { config, mockFetch } from './helpers.js';

const SESSION_TOKEN = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/RESG!ICESMSLB\\/RES.LB!-3142469889442586496!1404637!0';
const NEW_TOKEN = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/CERTG!ICESMSLB\\/CRT.LB!-3206400065398209398!380374!0';

function soap(body: string, header = ''): string {
  return [
    '<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">',
    '<soap-env:Header>',
    '<eb:MessageHeader xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" eb:version="1.0" soap-env:mustUnderstand="1">',
    '<eb:CPAId>ABCD</eb:CPAId>',
    '<eb:ConversationId>conv-1</eb:ConversationId>',
    '<eb:MessageData><eb:MessageId>3412287548732070140</eb:MessageId><eb:Timestamp>2026-10-31T12:00:00</eb:Timestamp></eb:MessageData>',
    '</eb:MessageHeader>',
    header,
    '</soap-env:Header>',
    `<soap-env:Body>${body}</soap-env:Body>`,
    '</soap-env:Envelope>',
  ].join('\n');
}

const tokenHeader = (token: string) =>
  `<wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext"><wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${token}</wsse:BinarySecurityToken></wsse:Security>`;

function queueRS(results: string, extra = ''): string {
  return `<QueueAccessRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.1.1"><stl:ApplicationResults status="Complete">${results}</stl:ApplicationResults>${extra}</QueueAccessRS>`;
}

const success = '<stl:Success timeStamp="2026-10-31T12:00:00-06:00"/>';

function entry(kind: 'Error' | 'Warning', code: string, text: string, shortText?: string, type = 'BusinessLogic'): string {
  return `<stl:${kind} type="${type}" timeStamp="2026-10-31T12:00:00-06:00"><stl:SystemSpecificResults><stl:Message code="${code}">${text}</stl:Message>${shortText === undefined ? '' : `<stl:ShortText>${shortText}</stl:ShortText>`}</stl:SystemSpecificResults></stl:${kind}>`;
}

function fault(faultcode: string, faultstring: string, detail = ''): string {
  return `<soap-env:Fault><faultcode>${faultcode}</faultcode><faultstring>${faultstring}</faultstring>${detail === '' ? '' : `<detail>${detail}</detail>`}</soap-env:Fault>`;
}

function xml(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml;charset=UTF-8', ...headers } });
}

function memoryLogger() {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const make =
    (level: string) =>
    (message: string, context?: Record<string, unknown>): void => {
      calls.push([level, message, context]);
    };
  const logger: SabreLogger = { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
  return { logger, calls };
}

function setup(...responses: Array<Response | Error>) {
  const fetch = mockFetch(...responses);
  const { logger, calls } = memoryLogger();
  const transport = new SoapTransport(resolveConfig(config({ environment: 'production', fetch, logger })), {
    messageId: () => 'test-uuid',
    now: () => new Date('2026-10-31T18:00:00.123Z'),
  });
  return { fetch, transport, calls };
}

function request(overrides: Partial<SoapRequest> = {}): SoapRequest {
  return {
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: '<QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"/>',
    cpaId: 'ABCD',
    conversationId: 'conv-1',
    security: { binarySecurityToken: SESSION_TOKEN },
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba que la promesa fallara');
}

describe('SoapTransport: request', () => {
  it('arma el sobre con MessageHeader y BinarySecurityToken y lo manda al endpoint SOAP', async () => {
    const { fetch, transport } = setup(xml(200, soap(queueRS(success))));
    await transport.request(request());

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://webservices.platform.sabre.com');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('text/xml; charset=utf-8');
    const sent = String(init?.body);
    expect(sent).toContain('<eb:MessageHeader soap-env:mustUnderstand="1" eb:version="1.0">');
    expect(sent).toContain('<eb:CPAId>ABCD</eb:CPAId>');
    expect(sent).toContain('<eb:ConversationId>conv-1</eb:ConversationId>');
    expect(sent).toContain('<eb:Service>QueueAccessLLSRQ</eb:Service><eb:Action>QueueAccessLLSRQ</eb:Action>');
    expect(sent).toContain('<eb:MessageId>mid:test-uuid</eb:MessageId><eb:Timestamp>2026-10-31T18:00:00Z</eb:Timestamp>');
    expect(sent).toContain(
      `<wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${SESSION_TOKEN}</wsse:BinarySecurityToken>`,
    );
    expect(sent).toContain(
      '<soap-env:Body><QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"/></soap-env:Body>',
    );
  });

  it('usa el endpoint de CERT en sandbox', async () => {
    const fetch = mockFetch(xml(200, soap(queueRS(success))));
    const transport = new SoapTransport(resolveConfig(config({ environment: 'sandbox', fetch })));
    await transport.request(request());
    expect(fetch.mock.calls[0]![0]).toBe('https://webservices.cert.platform.sabre.com');
  });

  it('arma el UsernameToken, con ClientId y ClientSecret solo si vienen, y escapa los valores', async () => {
    const { fetch, transport } = setup(xml(200, soap('<SessionCreateRS status="Approved"/>')), xml(200, soap('<SessionCreateRS status="Approved"/>')));
    const usernameToken = { username: 'agente', password: 'p<a>&"ss', organization: 'ABCD', domain: 'AA' };

    await transport.request(request({ security: { usernameToken } }));
    await transport.request(request({ security: { usernameToken: { ...usernameToken, clientId: 'cid', clientSecret: 'csec' } } }));

    const v1 = String(fetch.mock.calls[0]![1]?.body);
    expect(v1).toContain(
      '<wsse:UsernameToken><wsse:Username>agente</wsse:Username><wsse:Password>p&lt;a&gt;&amp;&quot;ss</wsse:Password><Organization>ABCD</Organization><Domain>AA</Domain></wsse:UsernameToken>',
    );
    expect(v1).not.toContain('ClientId');
    const v2 = String(fetch.mock.calls[1]![1]?.body);
    expect(v2).toContain('<Domain>AA</Domain><ClientId>cid</ClientId><ClientSecret>csec</ClientSecret></wsse:UsernameToken>');
  });
});

describe('SoapTransport: respuesta', () => {
  it('devuelve el payload parseado sin prefijos, con los valores como string', async () => {
    const { transport } = setup(
      xml(200, soap(queueRS(success, '<Line Number="1"><UniqueID ID="ABCDEF"/></Line><Paragraph><Text>011  SEE REMARKS</Text></Paragraph>'))),
    );

    const result = await transport.request(request());

    expect(result.payloadName).toBe('QueueAccessRS');
    expect(result.payload['@Version']).toBe('2.1.1');
    expect(result.payload.Line).toEqual({ '@Number': '1', UniqueID: { '@ID': 'ABCDEF' } });
    expect(result.payload.Paragraph).toEqual({ Text: '011  SEE REMARKS' });
    expect(result.warnings).toEqual([]);
    expect(result.messageId).toBe('3412287548732070140');
    expect(result.status).toBe(200);
    expect(result.securityToken).toBeUndefined();
  });

  it('devuelve los stl:Warning en warnings, sin lanzar', async () => {
    const { transport, calls } = setup(
      xml(200, soap(queueRS(success + entry('Warning', 'WARN.SWS.HOST.WARNING_IN_RESPONSE', 'END OF DISPLAY FOR REQUESTED DATA')))),
    );

    const result = await transport.request(request());

    expect(result.warnings).toHaveLength(1);
    const [warning] = result.warnings;
    expect(warning).toBeInstanceOf(SabreWarning);
    expect(warning!.service).toBe('queueAccess');
    expect(warning!.code).toBe('WARN.SWS.HOST.WARNING_IN_RESPONSE');
    expect(warning!.message).toBe('queueAccess: END OF DISPLAY FOR REQUESTED DATA');
    expect(calls.find(([, event]) => event === 'sabre.request.end')?.[0]).toBe('info');
  });

  it('lanza SabreBusinessError con el primer stl:Error y adjunta los demás y los warnings', async () => {
    const { transport, calls } = setup(
      xml(
        200,
        soap(
          queueRS(
            entry('Error', 'ERR.SWS.HOST.ERROR_IN_RESPONSE', 'QUEUE SELECTED NOT VALID OR CLOSED', 'ERR.SWS.HOST.ERROR_IN_RESPONSE') +
              entry('Error', '12', 'SEGUNDO ERROR', 'DETALLE', 'Application') +
              entry('Warning', '0', 'UN AVISO'),
          ),
        ),
      ),
    );

    const error = await rejection(transport.request(request()));

    expect(error).toBeInstanceOf(SabreBusinessError);
    const business = error as SabreBusinessError;
    expect(business.service).toBe('queueAccess');
    expect(business.code).toBe('ERR.SWS.HOST.ERROR_IN_RESPONSE');
    expect(business.message).toBe('queueAccess: QUEUE SELECTED NOT VALID OR CLOSED (ERR.SWS.HOST.ERROR_IN_RESPONSE)');
    expect(business.retryable).toBe(false);
    expect(business.errors.map((e) => [e.code, e.message])).toEqual([['12', 'queueAccess: SEGUNDO ERROR (DETALLE)']]);
    expect(business.warnings.map((w) => w.message)).toEqual(['queueAccess: UN AVISO']);
    expect(typeof business.raw).toBe('string');
    expect(calls.find(([, event]) => event === 'sabre.request.end')?.[0]).toBe('warn');
  });

  it('usa el type del stl:Error como código si no viene Message@code', async () => {
    const { transport } = setup(
      xml(200, soap(queueRS('<stl:Error type="Application"><stl:SystemSpecificResults><stl:Message>SIN CODIGO</stl:Message></stl:SystemSpecificResults></stl:Error>'))),
    );
    const error = (await rejection(transport.request(request()))) as SabreBusinessError;
    expect(error.code).toBe('Application');
    expect(error.message).toBe('queueAccess: SIN CODIGO');
  });

  it('acepta un payload sin ApplicationResults (p. ej. SessionCreateRS)', async () => {
    const { transport } = setup(
      xml(200, soap('<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved"><ConversationId>conv-1</ConversationId></SessionCreateRS>')),
    );
    const result = await transport.request(request());
    expect(result.payloadName).toBe('SessionCreateRS');
    expect(result.payload).toMatchObject({ '@status': 'Approved', ConversationId: 'conv-1' });
  });
});

describe('SoapTransport: SOAP fault y gateway', () => {
  it('mapea un fault a SabreGatewayError con el USG_* que encuentra en el fault', async () => {
    const { transport } = setup(
      xml(
        500,
        soap(
          fault(
            'soap-env:Client.InvalidSecurityToken',
            'Invalid or Expired binary security token',
            '<StackTrace>com.sabre.universalservices.base.security.AuthenticationException: errors.session.USG_INVALID_SECURITY_TOKEN</StackTrace>',
          ),
        ),
      ),
    );

    const error = (await rejection(transport.request(request()))) as SabreGatewayError;

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error.protocol).toBe('soap');
    expect(error.status).toBe(500);
    expect(error.code).toBe('USG_INVALID_SECURITY_TOKEN');
    expect(error.retryable).toBe(false);
    expect(error.message).toBe(
      'queueAccess: SOAP fault soap-env:Client.InvalidSecurityToken: Invalid or Expired binary security token',
    );
  });

  it('usa el faultcode si el fault no trae un USG_*', async () => {
    const { transport } = setup(xml(500, soap(fault('soap-env:Client.Validation', 'Request is not valid'))));
    const error = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect(error.code).toBe('soap-env:Client.Validation');
  });

  it('trata un fault como fault aunque llegue con HTTP 200', async () => {
    const { transport } = setup(xml(200, soap(fault('soap-env:Server.SystemError', 'USG_IS_BUSY'))));
    const error = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect(error).toBeInstanceOf(SabreGatewayError);
    expect(error.code).toBe('USG_IS_BUSY');
  });

  it('una respuesta que no es un sobre SOAP es SabreGatewayError, reintentable solo si el status lo es', async () => {
    const { transport } = setup(
      xml(503, '<html><body>Service Unavailable</body></html>', { 'Content-Type': 'text/html' }),
      xml(200, 'no es xml'),
      xml(403, ''),
    );

    const unavailable = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect(unavailable).toBeInstanceOf(SabreGatewayError);
    expect([unavailable.protocol, unavailable.status, unavailable.retryable]).toEqual(['soap', 503, true]);

    const garbage = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect([garbage.status, garbage.retryable]).toEqual([200, false]);

    const forbidden = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect([forbidden.status, forbidden.retryable]).toEqual([403, false]);
  });

  it('un sobre con payload y HTTP de error es SabreGatewayError', async () => {
    const { transport } = setup(xml(502, soap(queueRS(success))));
    const error = (await rejection(transport.request(request()))) as SabreGatewayError;
    expect([error.status, error.protocol]).toEqual([502, 'soap']);
  });

  it('envuelve un fallo de red en SabreGatewayError sin reintentarlo', async () => {
    const cause = new TypeError('fetch failed');
    const { fetch, transport, calls } = setup(cause);

    const error = (await rejection(transport.request(request()))) as SabreGatewayError;

    expect(error).toBeInstanceOf(SabreGatewayError);
    expect([error.protocol, error.status, error.code, error.retryable]).toEqual(['soap', undefined, undefined, false]);
    expect(error.cause).toBe(cause);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(calls.find(([, event]) => event === 'sabre.request.end')?.[0]).toBe('error');
  });

  it('propaga tal cual el abort del consumidor', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('aborted', 'AbortError');
    const { transport } = setup(abort);
    await expect(transport.request(request({ signal: controller.signal }))).rejects.toBe(abort);
  });
});

describe('SoapTransport: el BinarySecurityToken no sale del transporte', () => {
  function leaks(value: unknown, token: string): boolean {
    return JSON.stringify(value ?? '').includes(JSON.stringify(token).slice(1, -1)) || String(value).includes(token);
  }

  it('onRawResponse recibe el sobre completo con solo el token redactado', async () => {
    const response = soap(queueRS(success), tokenHeader(SESSION_TOKEN));
    const raws: SabreRawResponse[] = [];
    const { transport, calls } = setup(xml(200, response, { 'X-Request-Id': 'r-1' }));

    await transport.request(request({ operation: 'queue.access', onRawResponse: (raw) => raws.push(raw) }));

    expect(raws).toHaveLength(1);
    const [raw] = raws;
    expect(raw).toMatchObject({ operation: 'queue.access', protocol: 'soap', status: 200, attempts: 1 });
    expect(raw!.headers.get('X-Request-Id')).toBe('r-1');
    expect(raw!.body).toBe(response.replace(SESSION_TOKEN, REDACTED));
    expect(leaks(calls, SESSION_TOKEN)).toBe(false);
  });

  it('tapa el token enviado si Sabre lo repite en un fault, en raw, en el mensaje y en los logs', async () => {
    const escaped = SESSION_TOKEN.replace(/&/g, '&amp;');
    const response = soap(
      fault('soap-env:Client.InvalidSecurityToken', `Invalid or Expired binary security token: ${escaped}`),
      tokenHeader(SESSION_TOKEN),
    );
    const raws: SabreRawResponse[] = [];
    const { transport, calls } = setup(xml(500, response));

    const error = (await rejection(transport.request(request({ onRawResponse: (raw) => raws.push(raw) })))) as SabreGatewayError;

    expect(error.message).toBe(
      `queueAccess: SOAP fault soap-env:Client.InvalidSecurityToken: Invalid or Expired binary security token: ${REDACTED}`,
    );
    expect(leaks(error.raw, SESSION_TOKEN)).toBe(false);
    expect(leaks(error.message, SESSION_TOKEN)).toBe(false);
    expect(leaks(raws[0]!.body, SESSION_TOKEN)).toBe(false);
    expect(leaks(calls, SESSION_TOKEN)).toBe(false);
  });

  it('SabreError.raw pasa por el redactor aunque el token de la respuesta sea otro', async () => {
    const { transport } = setup(xml(200, soap(queueRS(entry('Error', '1', 'FALLA')), tokenHeader(NEW_TOKEN))));
    const error = (await rejection(transport.request(request()))) as SabreBusinessError;
    expect(leaks(error.raw, NEW_TOKEN)).toBe(false);
    expect(String(error.raw)).toContain(`>${REDACTED}</wsse:BinarySecurityToken>`);
  });

  it('con readSecurityToken devuelve el token nuevo, pero raw y logs siguen redactados', async () => {
    const response = soap(
      '<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved"><ConversationId>conv-1</ConversationId></SessionCreateRS>',
      tokenHeader(NEW_TOKEN),
    );
    const raws: SabreRawResponse[] = [];
    const { transport, calls } = setup(xml(200, response));

    const result = await transport.request(
      request({
        service: 'sessionCreate',
        action: 'SessionCreateRQ',
        security: { usernameToken: { username: 'agente', password: 'clave-epr', organization: 'ABCD', domain: 'AA' } },
        readSecurityToken: true,
        onRawResponse: (raw) => raws.push(raw),
      }),
    );

    expect(result.securityToken).toBe(NEW_TOKEN);
    expect(leaks(raws[0]!.body, NEW_TOKEN)).toBe(false);
    expect(leaks(calls, NEW_TOKEN)).toBe(false);
    expect(leaks(calls, 'clave-epr')).toBe(false);
  });

  it('un onRawResponse que lanza no rompe la operación', async () => {
    const { transport, calls } = setup(xml(200, soap(queueRS(success))));
    const onRawResponse = vi.fn(() => {
      throw new Error('falla del consumidor');
    });

    await expect(transport.request(request({ onRawResponse }))).resolves.toMatchObject({ payloadName: 'QueueAccessRS' });
    expect(calls.find(([, event]) => event === 'sabre.request.rawResponseHookFailed')?.[2]).toMatchObject({
      service: 'queueAccess',
      errorName: 'Error',
    });
  });
});
