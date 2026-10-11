// tokenStore en un archivo local para los scripts de grabación: reutiliza el token entre
// corridas en vez de pedir uno nuevo cada vez. El archivo guarda el token en claro y está
// en .gitignore. No es parte del SDK (src/ no usa APIs de Node).
import { readFile, writeFile } from 'node:fs/promises';

const FILE = new URL('../.sabre-token.json', import.meta.url);

async function readAll() {
  try {
    return JSON.parse(await readFile(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export const fileTokenStore = {
  async get(key) {
    return (await readAll())[key];
  },
  async set(key, token) {
    const all = await readAll();
    all[key] = token;
    await writeFile(FILE, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  },
};
