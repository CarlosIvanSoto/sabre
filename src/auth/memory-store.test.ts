import { createMemoryTokenStore } from './memory-store';

describe('createMemoryTokenStore', () => {
  it('round-trips a stored token', async () => {
    const store = createMemoryTokenStore();
    expect(await store.get()).toBeNull();

    await store.set({ accessToken: 'abc', expiresAt: 12345 });
    expect(await store.get()).toEqual({ accessToken: 'abc', expiresAt: 12345 });
  });

  it('clear removes the cached token', async () => {
    const store = createMemoryTokenStore();
    await store.set({ accessToken: 'abc', expiresAt: 12345 });
    await store.clear();
    expect(await store.get()).toBeNull();
  });

  it('serializes withLock callers', async () => {
    const store = createMemoryTokenStore();
    const order: string[] = [];

    const slow = store.withLock(async () => {
      order.push('slow-start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('slow-end');
      return 'slow';
    });

    const fast = store.withLock(() => {
      order.push('fast-start');
      order.push('fast-end');
      return Promise.resolve('fast');
    });

    const [slowResult, fastResult] = await Promise.all([slow, fast]);
    expect(slowResult).toBe('slow');
    expect(fastResult).toBe('fast');
    expect(order).toEqual(['slow-start', 'slow-end', 'fast-start', 'fast-end']);
  });

  it('a rejected lock holder does not block subsequent holders', async () => {
    const store = createMemoryTokenStore();
    const failing = store.withLock(() => Promise.reject(new Error('boom')));
    await expect(failing).rejects.toThrow('boom');

    const result = await store.withLock(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');
  });
});
