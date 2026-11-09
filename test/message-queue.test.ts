// Lo que la entrada principal exporta para distinguir la cola de mensajes (#191, ADR-028).
import { describe, expect, it } from 'vitest';
import { isMessageQueue, MESSAGE_QUEUE, type QueueRef } from '../src/index.js';

describe('isMessageQueue y MESSAGE_QUEUE', () => {
  it('MESSAGE_QUEUE es la cola alfabética S', () => {
    expect(MESSAGE_QUEUE).toBe('S');
  });

  it.each<[string, QueueRef, boolean]>([
    ['la cola S', 'S', true],
    ['MESSAGE_QUEUE', MESSAGE_QUEUE, true],
    ['una cola numérica', 12, false],
    ['la cola numérica 0', 0, false],
    ['una cola con nombre', { name: 'HOTELS' }, false],
    ['otra cola alfabética', 'A', false],
  ])('%s → %s', (_, queue, expected) => {
    expect(isMessageQueue(queue)).toBe(expected);
  });
});
