// Un identificador sin definir o un import que no existe en scripts/*.mjs y scripts/lib/*.mjs (el
// equivalente de `no-undef` de ESLint, con el compilador que ya está en el repo). Los scripts no
// pasan por `typecheck` y casi nunca corren en la CI: así se escapó un `OTHER_CONFIRMABLE` sin
// importar en validate-update-reservation.mjs (#272), que habría reventado el paso read en
// producción después de leer y antes de grabar la fixture. Solo se miran estos diagnósticos: los
// tipos de los scripts no se revisan, y los globales de Node (`process`, `Buffer`) dan 2580/2591.
import ts from 'typescript';
import { expect, it } from 'vitest';

// Sin tipos de Node en el typecheck: se importa por una ruta en variable, como en dist.test.ts.
const fsPath = 'node:fs';
const urlPath = 'node:url';
const { readdirSync } = (await import(/* @vite-ignore */ fsPath)) as { readdirSync: (path: string) => string[] };
const { fileURLToPath } = (await import(/* @vite-ignore */ urlPath)) as { fileURLToPath: (url: URL) => string };

const UNDEFINED = new Set([
  2304, // Cannot find name 'x'.
  2552, // Cannot find name 'x'. Did you mean 'y'?
  2305, // Module 'm' has no exported member 'x'.
  2724, // 'm' has no exported member named 'x'. Did you mean 'y'?
]);

const root = fileURLToPath(new URL('..', import.meta.url));
const files = ['scripts', 'scripts/lib'].flatMap((dir) =>
  readdirSync(`${root}${dir}`)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `${root}${dir}/${name}`),
);

it('los scripts no usan identificadores sin definir ni imports que no existen', () => {
  expect(files.length).toBeGreaterThan(0);
  const program = ts.createProgram(files, {
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
    types: [],
    skipLibCheck: true,
  });
  const found = files.flatMap((file) =>
    program
      .getSemanticDiagnostics(program.getSourceFile(file))
      .filter((d) => UNDEFINED.has(d.code) && d.file !== undefined && d.start !== undefined)
      .map((d) => `${d.file!.fileName.slice(root.length)}:${d.file!.getLineAndCharacterOfPosition(d.start!).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`),
  );
  expect(found).toEqual([]);
}, 60_000);
