---
name: Tarea
about: Unidad de trabajo de una fase del plan de implementación, trazable al wiki de diseño
title: "[Fx.y] "
labels: []
---

## Fase

<!-- Fase del plan a la que pertenece. Ej.: Fase 1 — Auth -->
Plan: `sabre-wiki/wiki/sdk/plan-tier-1.md` → Fase X

## Tipo

<!-- Deja solo uno -->
- implementación — se escribe código
- decisión — hay que decidir algo antes de implementar; se cierra cuando la decisión está en el wiki
- fuente — falta documentación oficial; se cierra cuando la fuente está ingerida en el wiki

## Objetivo

<!-- Qué queda funcionando o decidido al cerrar el issue, en una o dos frases. -->

## Referencias del wiki

<!-- Páginas de sabre-wiki que fijan el diseño. El código sale de aquí, no de otra implementación. -->
- `wiki/sdk/...`
- `wiki/entities/...`

## Alcance

**Incluye**
-

**No incluye**
-

## Criterios de aceptación

- [ ]
- [ ]

## Dependencias

<!-- Issues que deben cerrarse antes. Ej.: Bloqueado por #12 -->
- Ninguna

## Definición de terminado (común a todas las tareas de implementación)

- [ ] Tests unitarios con `fetch` mockeado (sin red real)
- [ ] Solo Web Standard APIs: nada de `node:*`, `fs` ni `Buffer` en `src/`
- [ ] Ningún secreto ni dato de pasajero llega al `logger` sin redactar
- [ ] Superficie pública alineada con `wiki/sdk/convenciones-de-nombres-y-versionado.md`
- [ ] Hallazgos devueltos al wiki (abajo)

## Hallazgos para el wiki

<!-- Lo que se descubra al implementar (campos sin documentar, códigos de error reales,
comportamiento del sandbox) se anota en la página del wiki correspondiente, no solo aquí. -->
- [ ] Sin hallazgos / anotados en: `wiki/...`
