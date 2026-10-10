Closes #

## Resumen

<!-- Qué problema resuelve este PR, en 2–3 frases. -->

## Cambios

<!-- Lista agrupada por módulo de src/ (auth, shopping, booking, http, errors…). -->
-

## Referencias del wiki

<!-- Páginas de sabre-wiki que fijan el diseño de lo implementado. -->
- `wiki/sdk/...`

## Cómo se probó

- [ ] `npm run check:portable`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm test`

## Definición de terminado

- [ ] Tests unitarios con `fetch` mockeado (sin red real)
- [ ] Solo Web Standard APIs: nada de `node:*`, `fs` ni `Buffer` en `src/`
- [ ] Ningún secreto ni dato de pasajero llega al `logger` sin redactar
- [ ] Superficie pública alineada con `wiki/sdk/convenciones-de-nombres-y-versionado.md`
- [ ] Hallazgos devueltos al wiki

## Hallazgos para el wiki

<!-- Qué se anotó y en qué página, o "Sin hallazgos". -->

## Notas para revisión

<!-- Decisiones discutibles, deuda pendiente, por dónde empezar a leer. -->
