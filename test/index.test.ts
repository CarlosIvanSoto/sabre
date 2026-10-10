import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/index.js';

describe('sabre-client', () => {
  it('exporta la versión del paquete', () => {
    expect(VERSION).toBe('0.3.0');
  });
});
