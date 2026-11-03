# CLAUDE.md — sabre-client

SDK de TypeScript para las APIs de Sabre, construido a partir del wiki de diseño
`~/Obsidian/sabre-wiki`. Desde `0.3.0` es la rama `main` del repo. Nació como una
reescritura desde cero, guiada solo por el wiki; la comparación con la implementación
anterior está en `wiki/comparisons/rewrite-vs-main.md`.

## Fuente de verdad

- Diseño y decisiones: `~/Obsidian/sabre-wiki/wiki/sdk/` (ADRs en estado `decidido`).
- Planes y fases: las páginas `tipo: plan` de `~/Obsidian/sabre-wiki/wiki/sdk/` (`plan-tier-*.md`).
- Request/response y errores: `~/Obsidian/sabre-wiki/wiki/entities/` y `wiki/concepts/`.
- Si el wiki no responde algo, no se inventa: se pregunta al usuario o se abre un issue
  de tipo `decisión` o `fuente`.

## Implementación anterior (`0.2.x`)

- Vive en la rama `legacy/0.2` (tag `legacy-0.2-final`) y en `archive/wip-2026-07`, sin
  historial común con `main`. Ver `wiki/sdk/destino-de-main.md`.
- Se puede leer como referencia, pero no se fusiona en bloque: cada pieza que se rescate
  entra por un issue propio, con su fuente en el wiki.

## Seguimiento

- Las tareas son issues de GitHub (`CarlosIvanSoto/sabre`), con el milestone del plan que
  corresponda, creados con la plantilla `.github/ISSUE_TEMPLATE/tarea.md`.
- Lo que se descubra al implementar vuelve al wiki, a la página de la entidad o del ADR
  afectado, siguiendo las convenciones de `sabre-wiki/CLAUDE.md`.

## Git

- Rama de integración y por defecto: `main`. El flujo está en el skill `git-flow`.
- Commits en Conventional Commits, sin líneas `Co-Authored-By` ni atribución a IA.
