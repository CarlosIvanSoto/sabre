# CLAUDE.md — sabre-client v0.3.0 (reimplementación)

Reimplementación desde cero de `sabre-client`, guiada **solo** por el wiki de diseño
`~/Obsidian/sabre-wiki`. Es un experimento: comprobar que un wiki con decisiones claras
basta para construir el SDK, y al final comparar el resultado con la implementación anterior.

## Regla de independencia (no negociable hasta la Fase 5)

- No leer el worktree principal `~/code/gales/sabre/sabre-client` ni la rama `main`
  (`git log main`, `git show main:...`, `git diff main`, etc.).
- No usar la versión publicada `sabre-client@0.2.4` ni su código como referencia.
- La comparación con `main` ocurre solo en el issue de la Fase 5 dedicado a ello.

## Fuente de verdad

- Diseño y decisiones: `~/Obsidian/sabre-wiki/wiki/sdk/` (ADRs en estado `decidido`).
- Plan y fases: `~/Obsidian/sabre-wiki/wiki/sdk/plan-tier-1.md`.
- Request/response y errores: `~/Obsidian/sabre-wiki/wiki/entities/` y `wiki/concepts/`.
- Si el wiki no responde algo, no se inventa: se pregunta al usuario o se abre un issue
  de tipo `decisión` o `fuente`.

## Seguimiento

- Las tareas son issues de GitHub (`CarlosIvanSoto/sabre`), milestone `v0.3.0 — Tier 1`,
  creados con la plantilla `.github/ISSUE_TEMPLATE/tarea.md`.
- Lo que se descubra al implementar vuelve al wiki, a la página de la entidad o del ADR
  afectado, siguiendo las convenciones de `sabre-wiki/CLAUDE.md`.

## Git

- Rama `rewrite-v0.3` (huérfana, sin historial común con `main`).
- Commits en Conventional Commits, sin líneas `Co-Authored-By` ni atribución a IA.
