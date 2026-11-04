// Contrato de `session.command()` contra las respuestas reales de CERT, grabadas con
// scripts/validate-command.mjs el 2026-11-04 (redactadas: PCC, sine, LNIATA y token).
import { describe, expect, it } from 'vitest';
import type { SabreConfig } from '../src/config.js';
import { SabreLegacy } from '../src/index.js';
import fixture from './fixtures/command.sandbox.json';
import { mockFetch } from './helpers.js';
import { SESSION_TOKEN, soap, tokenHeader, xml } from './soap-helpers.js';

const createRS =
  '<SessionCreateRS xmlns="http://www.opentravel.org/OTA/2002/11" version="1" status="Approved"><ConversationId>conv</ConversationId></SessionCreateRS>';

function session(body: string) {
  const fetch = mockFetch(xml(200, soap(createRS, tokenHeader(SESSION_TOKEN))), xml(200, body));
  const config: SabreConfig = {
    environment: 'sandbox',
    authVersion: 'v2',
    credentials: { username: 'V1:7971:H8GI:AA', password: 'epr-pass' },
    fetch,
    retry: { maxRetries: 0 },
  };
  return new SabreLegacy(config).openSession();
}

describe('session.command contra CERT (fixture)', () => {
  it('la fixture es de CERT, sin W/PT¥ON y con todos los pasos bien', () => {
    expect(fixture.environment).toBe('sandbox');
    expect(fixture.activate).toBe(false);
    expect(fixture.steps.map((step) => [step.command, step.ok])).toEqual([
      ['W/PT¥*', true],
      ['SI9', true],
    ]);
  });

  it.each(fixture.steps.map((step) => [step.command, step] as const))(
    '%s: lee la pantalla, los avisos y el MessageId de la respuesta real',
    async (command, step) => {
      const opened = await session(step.response.body);
      const screen = await opened.command(command, { idempotent: step.idempotent });

      expect(screen.text).toBe(step.text);
      expect(screen.warnings).toEqual([]);
      expect(screen.messageId).toMatch(/^\d+$/);
    },
  );

  it('W/PT¥* da el estado del TJR en una línea', () => {
    expect(fixture.steps[0]?.text).toMatch(/^PSGR TYPE - (ON|OFF)$/);
  });

  it('SI9 responde con la firma de duty code 9, no con un error', () => {
    expect(fixture.steps[1]?.text).toContain('9AWS');
  });
});
