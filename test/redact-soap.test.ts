import { describe, expect, it } from 'vitest';
import { REDACTED, redactSoapEnvelope } from '../src/logging/redact.js';

const TOKEN = 'Shared/IDL:IceSess\\/SessMgr:1\\.0.IDL/Common/!ICESMS\\/RESG!ICESMSLB\\/RES.LB!-3142469889442586496!1404637!0';

/** Sobre con la forma de `SessionCreateRS`: header con `eb:MessageHeader` y `wsse:Security`. */
function envelope(security: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soap-env:Envelope xmlns:soap-env="http://schemas.xmlsoap.org/soap/envelope/">',
    '  <soap-env:Header>',
    '    <eb:MessageHeader xmlns:eb="http://www.ebxml.org/namespaces/messageHeader" eb:version="1.0" soap-env:mustUnderstand="1">',
    '      <eb:MessageData>',
    '        <eb:MessageId>9314594d-6c40-4abe-b5b4-9d13fdc6e8a1@151</eb:MessageId>',
    '        <eb:Timestamp>2026-10-31T12:00:00</eb:Timestamp>',
    '      </eb:MessageData>',
    '    </eb:MessageHeader>',
    security,
    '  </soap-env:Header>',
    '  <soap-env:Body>',
    '    <SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved">',
    '      <ConversationId>conv-1</ConversationId>',
    '    </SessionCreateRS>',
    '  </soap-env:Body>',
    '</soap-env:Envelope>',
  ].join('\n');
}

const wsse = (inner: string) =>
  `    <wsse:Security xmlns:wsse="http://schemas.xmlsoap.org/ws/2002/12/secext">${inner}</wsse:Security>`;

describe('redactSoapEnvelope', () => {
  it('reemplaza el valor del token y deja el resto del sobre byte a byte', () => {
    const tokenElement = (value: string) =>
      `<wsse:BinarySecurityToken valueType="String" EncodingType="wsse:Base64Binary">${value}</wsse:BinarySecurityToken>`;
    const input = envelope(wsse(tokenElement(TOKEN)));

    const out = redactSoapEnvelope(input);

    expect(out).toBe(envelope(wsse(tokenElement(REDACTED))));
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('<eb:MessageId>9314594d-6c40-4abe-b5b4-9d13fdc6e8a1@151</eb:MessageId>');
  });

  it('devuelve idéntico un sobre sin token', () => {
    const input = envelope('');
    expect(redactSoapEnvelope(input)).toBe(input);
    expect(redactSoapEnvelope('')).toBe('');
  });

  it('reconoce otro prefijo y la ausencia de prefijo', () => {
    const other = `<sec:BinarySecurityToken>${TOKEN}</sec:BinarySecurityToken>`;
    const none = `<BinarySecurityToken xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">${TOKEN}</BinarySecurityToken>`;

    expect(redactSoapEnvelope(other)).toBe(`<sec:BinarySecurityToken>${REDACTED}</sec:BinarySecurityToken>`);
    expect(redactSoapEnvelope(none)).toBe(
      `<BinarySecurityToken xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext">${REDACTED}</BinarySecurityToken>`,
    );
  });

  it('reemplaza todas las apariciones', () => {
    const input = envelope(
      wsse(`<wsse:BinarySecurityToken>${TOKEN}-1</wsse:BinarySecurityToken>`) +
        '\n' +
        wsse(`<wsse:BinarySecurityToken>${TOKEN}-2</wsse:BinarySecurityToken>`),
    );

    const out = redactSoapEnvelope(input);

    expect(out).not.toContain(TOKEN);
    expect(out.split(`<wsse:BinarySecurityToken>${REDACTED}</wsse:BinarySecurityToken>`)).toHaveLength(3);
  });

  it('conserva los atributos en el orden en que llegaron', () => {
    const input = `<wsse:BinarySecurityToken EncodingType="wsse:Base64Binary" valueType="String">${TOKEN}</wsse:BinarySecurityToken>`;
    expect(redactSoapEnvelope(input)).toBe(
      `<wsse:BinarySecurityToken EncodingType="wsse:Base64Binary" valueType="String">${REDACTED}</wsse:BinarySecurityToken>`,
    );
  });

  it('tolera saltos de línea, CDATA y un > dentro de un atributo', () => {
    const input = `<wsse:BinarySecurityToken note="a>b"\n  valueType="String">\n  <![CDATA[${TOKEN}]]>\n</wsse:BinarySecurityToken >`;
    expect(redactSoapEnvelope(input)).toBe(
      `<wsse:BinarySecurityToken note="a>b"\n  valueType="String">${REDACTED}</wsse:BinarySecurityToken >`,
    );
  });

  it('no toca un token vacío ni uno autocerrado', () => {
    const empty = '<wsse:BinarySecurityToken valueType="String"></wsse:BinarySecurityToken>';
    const blank = '<wsse:BinarySecurityToken>  </wsse:BinarySecurityToken>';
    const selfClosing = `<wsse:BinarySecurityToken/><wsse:BinarySecurityToken valueType="String" /><eb:Note>${TOKEN}</eb:Note></wsse:BinarySecurityToken>`;

    expect(redactSoapEnvelope(empty)).toBe(empty);
    expect(redactSoapEnvelope(blank)).toBe(blank);
    // El autocerrado no abre un elemento: no se busca su cierre más adelante.
    expect(redactSoapEnvelope(selfClosing)).toBe(selfClosing);
  });

  it('no confunde elementos con un nombre parecido', () => {
    const similar = `<wsse:BinarySecurityTokenRef>${TOKEN}</wsse:BinarySecurityTokenRef>`;
    expect(redactSoapEnvelope(similar)).toBe(similar);
  });

  it('tapa el valor aunque el cierre traiga otro prefijo', () => {
    expect(redactSoapEnvelope(`<a:BinarySecurityToken>${TOKEN}</b:BinarySecurityToken>`)).toBe(
      `<a:BinarySecurityToken>${REDACTED}</b:BinarySecurityToken>`,
    );
  });
});
