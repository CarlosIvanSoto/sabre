import type { StoredToken, TokenStore } from './types';

/**
 * Devuelve un `TokenStore` en memoria para un solo proceso.
 *
 * El token cacheado vive en una variable capturada por closure; nada se
 * comparte entre instancias. `withLock` es una cadena de promesas por
 * instancia que serializa los refresh dentro del proceso.
 *
 * Para despliegues multi-proceso o multi-host donde varios clientes
 * deberían compartir token, proveer un `TokenStore` propio (p.ej.
 * respaldado por Redis).
 */
export function createMemoryTokenStore(): TokenStore {
  let cached: StoredToken | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  return {
    get(): Promise<StoredToken | null> {
      return Promise.resolve(cached);
    },

    set(token: StoredToken): Promise<void> {
      cached = token;
      return Promise.resolve();
    },

    clear(): Promise<void> {
      cached = null;
      return Promise.resolve();
    },

    withLock<T>(fn: () => Promise<T>): Promise<T> {
      // Serializa las llamadas encadenándolas sobre la anterior. Ambas
      // ramas de `then` usan `fn` para que un rechazo del holder previo
      // no le impida correr al siguiente.
      const next = chain.then(fn, fn);
      // Absorbe el rechazo sobre `chain` mismo para que futuros awaits no
      // vean un unhandled rejection viejo. El error real se propaga por
      // `next` hacia quien llamó a `withLock`.
      chain = next.catch(() => {});
      return next;
    },
  };
}
