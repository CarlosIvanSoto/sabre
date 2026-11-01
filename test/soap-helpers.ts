// Sobres SOAP de ejemplo y un SoapTransport con fetch, logger y espera mockeados.
import { vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { type SoapRequest, SoapTransport } from '../src/http/soap-transport.js';
import type { SabreLogger } from '../src/logging/index.js';
import { config, mockFetch } from './helpers.js';

export const SESSION_TOKEN = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/RESG!ICESMSLB\\/RES.LB!-3142469889442586496!1404637!0';
export const NEW_TOKEN = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/CERTG!ICESMSLB\\/CRT.LB!-3206400065398209398!380374!0';

export function soap(body: string, header = ''): string {
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

export const tokenHeader = (token: string) =>
  `<wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext"><wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${token}</wsse:BinarySecurityToken></wsse:Security>`;

export function queueRS(results: string, extra = ''): string {
  return `<QueueAccessRS xmlns="http://webservices.sabre.com/sabreXML/2011/10" xmlns:stl="http://services.sabre.com/STL/v01" Version="2.1.1"><stl:ApplicationResults status="Complete">${results}</stl:ApplicationResults>${extra}</QueueAccessRS>`;
}

export const success = '<stl:Success timeStamp="2026-10-31T12:00:00-06:00"/>';

export function entry(kind: 'Error' | 'Warning', code: string, text: string, shortText?: string, type = 'BusinessLogic'): string {
  return `<stl:${kind} type="${type}" timeStamp="2026-10-31T12:00:00-06:00"><stl:SystemSpecificResults><stl:Message code="${code}">${text}</stl:Message>${shortText === undefined ? '' : `<stl:ShortText>${shortText}</stl:ShortText>`}</stl:SystemSpecificResults></stl:${kind}>`;
}

export function fault(faultcode: string, faultstring: string, detail = ''): string {
  return `<soap-env:Fault><faultcode>${faultcode}</faultcode><faultstring>${faultstring}</faultstring>${detail === '' ? '' : `<detail>${detail}</detail>`}</soap-env:Fault>`;
}

export function xml(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/xml;charset=UTF-8', ...headers } });
}

export function memoryLogger() {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const make =
    (level: string) =>
    (message: string, context?: Record<string, unknown>): void => {
      calls.push([level, message, context]);
    };
  const logger: SabreLogger = { debug: make('debug'), info: make('info'), warn: make('warn'), error: make('error') };
  return { logger, calls };
}

export function setup(...responses: Array<Response | Error>) {
  const fetch = mockFetch(...responses);
  const { logger, calls } = memoryLogger();
  const sleep = vi.fn(async (_ms: number, _signal?: AbortSignal) => {});
  const transport = new SoapTransport(resolveConfig(config({ environment: 'production', fetch, logger })), {
    messageId: () => 'test-uuid',
    now: () => new Date('2026-10-31T18:00:00.123Z'),
    random: () => 0,
    sleep,
  });
  return { fetch, transport, calls, sleep };
}

export function request(overrides: Partial<SoapRequest> = {}): SoapRequest {
  return {
    service: 'queueAccess',
    action: 'QueueAccessLLSRQ',
    payload: '<QueueAccessRQ Version="2.1.1" xmlns="http://webservices.sabre.com/sabreXML/2011/10"/>',
    cpaId: 'ABCD',
    conversationId: 'conv-1',
    security: { binarySecurityToken: SESSION_TOKEN },
    idempotent: false,
    ...overrides,
  };
}

export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('se esperaba que la promesa fallara');
}
