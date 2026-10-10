// Guard de portabilidad: falla si en el código publicado aparece una API Node-only
// o un console.*. Ver sabre-wiki/wiki/sdk/configuracion-logging-y-build.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';

const root = process.argv[2] ?? 'src';
const builtins = new Set(builtinModules.filter((m) => !m.startsWith('_')));

const rules = [
  {
    name: 'import de módulo node:*',
    test: (spec) => spec.startsWith('node:'),
  },
  {
    name: 'import de módulo nativo de Node',
    test: (spec) => builtins.has(spec) || builtins.has(spec.split('/')[0]),
  },
];

const patterns = [
  { name: 'uso de Buffer', re: /\bBuffer\b/ },
  { name: 'uso de process.env', re: /\bprocess\s*\.\s*env\b/ },
  { name: 'uso de require()', re: /\brequire\s*\(/ },
  { name: 'uso de console.*', re: /\bconsole\s*\.\s*\w+/ },
];

const importRe =
  /(?:\bimport\s*(?:[\w*{}\s,]+\s*from\s*)?|\bexport\s*[\w*{}\s,]+\s*from\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry)) yield path;
  }
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

const violations = [];
for (const file of walk(root)) {
  const source = stripComments(readFileSync(file, 'utf8'));
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(importRe)) {
      const spec = match[1];
      for (const rule of rules) {
        if (rule.test(spec)) violations.push(`${relative('.', file)}:${i + 1}  ${rule.name} ('${spec}')`);
      }
    }
    for (const { name, re } of patterns) {
      if (re.test(line)) violations.push(`${relative('.', file)}:${i + 1}  ${name}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`APIs no portables a edge en ${root}/:\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-portable: ${root}/ sin APIs Node-only`);
