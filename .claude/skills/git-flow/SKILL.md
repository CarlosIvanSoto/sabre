---
name: git-flow
description: Flujo de Git del proyecto guiado por issues — rama ligada a un issue, commits Conventional Commits, checks locales iguales al CI, push y Pull Request contra la rama de integración con la plantilla del repo. Usar cuando el usuario pida commitear, subir cambios, abrir un PR, empezar a trabajar en un issue o cerrar una tarea. Acepta como argumento el número de issue (ej. `/git-flow 12`).
---

# Flujo de Git guiado por issues

Una tarea = un issue = una rama = un PR = un commit en la rama de integración.

## Constantes del proyecto

- **Rama de integración (base):** `rewrite-v0.3`. Todas las ramas salen de aquí y todos los PR apuntan aquí.
  Nunca usar `main` como base, ni hacer `git diff main`, `git log main` o similares (regla de independencia de `CLAUDE.md`).
- **Repo:** `CarlosIvanSoto/sabre` · **Milestone:** `v0.3.0 — Tier 1`.
- **Checks locales (los mismos del CI):** `npm run check:portable && npm run typecheck && npm run build && npm test`.
- **Prohibido en commits y PR:** líneas `Co-Authored-By`, `Claude-Session`, "Generated with Claude" o cualquier atribución a IA.

## 0. Diagnóstico (siempre, antes de tocar nada)

```bash
git status --short
git branch --show-current
git fetch origin --prune
git log --oneline -5
```

Decide en qué situación estás:

| Situación | Qué hacer |
|---|---|
| En `rewrite-v0.3` con cambios sin commitear | Ir al paso 1 (identificar issue) y crear la rama; los cambios viajan con `git switch -c`. |
| En una rama de tarea | Seguir en ella; saltar al paso 3. |
| Cambios que mezclan varias tareas | Separarlos: solo entra a la rama lo que pertenece al issue. Lo demás se queda sin commitear y se avisa al usuario. |
| `origin/rewrite-v0.3` no existe | Avisar: la rama de integración debe publicarse primero (`git push -u origin rewrite-v0.3`) con confirmación explícita del usuario. |

## 1. Identificar el issue

- Si viene como argumento, úsalo. Si no, deducirlo del nombre de la rama (`feat/12-...` → #12) o preguntar al usuario mostrando candidatos:
  `gh issue list --milestone "v0.3.0 — Tier 1" --state open`
- Leerlo: `gh issue view <N> --json number,title,body,labels,milestone`.
- **Sin issue no hay rama.** Si el trabajo no tiene issue, proponer crearlo con la plantilla `.github/ISSUE_TEMPLATE/tarea.md` (título `[Fx.y] ...`, etiquetas `tier-1`, `fase-x`, `tipo: ...`, milestone) y esperar confirmación del usuario.
- Si el issue tiene la etiqueta `bloqueado`, avisar antes de continuar.
- Los issues `tipo: decisión` y `tipo: fuente` se cierran en el wiki, no en este repo. Solo llevan rama si además tocan código o docs del repo.

## 2. Crear la rama

Formato: `<tipo>/<issue>-<slug-kebab-case>` (slug corto, 2–5 palabras, sin acentos).

| Tipo de cambio | Prefijo |
|---|---|
| Funcionalidad nueva (`tipo: implementación`) | `feat/` |
| Corrección de un error | `fix/` |
| Reestructuración sin cambio de comportamiento | `refactor/` |
| Solo tests | `test/` |
| Documentación (README, CHANGELOG, comentarios) | `docs/` |
| Tooling, CI, dependencias, config | `chore/` · `ci/` · `build/` |

Ejemplos: `feat/7-auth-token-cache`, `fix/21-shape-error-gateway`, `chore/3-ci-node18`.

```bash
git switch rewrite-v0.3 && git pull --ff-only   # solo si no hay cambios pendientes
git switch -c feat/7-auth-token-cache
```

Si ya hay cambios sin commitear en `rewrite-v0.3`, crear la rama directamente con `git switch -c` (no hacer pull antes).

## 3. Commits

Agrupar por unidad lógica (un commit debe compilar y tener sentido solo). Agregar archivos explícitamente por ruta, nunca `git add -A` / `git add .` a ciegas. Revisar `git diff --staged` antes de cada commit; nunca incluir `.env`, credenciales ni datos reales de pasajeros.

Formato Conventional Commits:

```
<tipo>(<scope>): <resumen en imperativo, minúscula, sin punto, ≤ 72 caracteres>

<cuerpo: qué cambia y POR QUÉ, con referencia a la página del wiki
o ADR que lo fija cuando aplique. Líneas de ≤ 72 caracteres.>

Refs #<issue>
```

- **tipo:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`, `perf`.
- **scope:** el módulo afectado de `src/` (ej. `auth`, `shopping`, `booking`, `http`, `errors`), o `ci`, `deps`, `wiki` cuando no es código. Omitirlo si el cambio es transversal.
- **Footer:** `Refs #N` en los commits intermedios. El cierre (`Closes #N`) va en el PR, no en los commits.
- **Cambio incompatible:** `feat(auth)!: ...` y footer `BREAKING CHANGE: <explicación>`.
- Usar heredoc para que el formato no se rompa:

```bash
git commit -F - <<'EOF'
feat(auth): cachear el token hasta 60 s antes de su expiración

El ADR de auth fija renovación anticipada para evitar 401 en vuelo
(wiki/sdk/adr-auth.md).

Refs #7
EOF
```

## 4. Verificar antes de subir

```bash
npm run check:portable && npm run typecheck && npm run build && npm test
```

Si algo falla: corregir y hacer otro commit (o `git commit --amend` si la rama aún no se ha subido). **No subir con checks en rojo.** Si el fallo no es de esta tarea, informar al usuario y no tocarlo.

Revisar también la definición de terminado del issue (checklist en su cuerpo) y anotar qué queda pendiente.

## 5. Confirmar con el usuario

Antes de cualquier acción remota, mostrar un resumen corto y esperar el visto bueno:

- rama y base
- lista de commits (`git log --oneline rewrite-v0.3..HEAD`)
- resultado de los checks
- título del PR propuesto

## 6. Push

```bash
git push -u origin <rama>
```

- Nunca hacer push directo a `rewrite-v0.3` ni a `main`.
- Si hay que reescribir la rama ya subida (rebase sobre la base), usar solo `git push --force-with-lease`, nunca `--force`.

## 7. Pull Request

Título = el mensaje del futuro squash commit, en Conventional Commits con el código de tarea:
`feat(auth): cache de token de sesión [F1.2]`

```bash
gh pr create \
  --base rewrite-v0.3 \
  --head <rama> \
  --title "<tipo>(<scope>): <resumen> [Fx.y]" \
  --milestone "v0.3.0 — Tier 1" \
  --label "<las etiquetas tier-1 / fase-x / tipo del issue, sin 'bloqueado'>" \
  --assignee @me \
  --body-file <archivo temporal en el scratchpad>
```

El cuerpo sigue `.github/pull_request_template.md` y se llena de verdad:

- `Closes #N` en la primera línea (cierra el issue al hacer merge).
- **Resumen:** qué problema resuelve, en 2–3 frases.
- **Cambios:** lista de lo que cambia, agrupada por módulo.
- **Referencias del wiki:** las mismas páginas del issue, más las que se hayan usado.
- **Cómo se probó:** los checks del paso 4 y cualquier prueba adicional.
- **Definición de terminado:** copiar el checklist del issue y marcar lo cumplido; explicar lo que no.
- **Hallazgos para el wiki:** qué se anotó y en qué página, o "Sin hallazgos".
- **Notas para revisión:** decisiones discutibles, deuda que queda, por dónde empezar a leer.

Al terminar, devolver al usuario la URL del PR.

## 8. Merge y limpieza (cuando el usuario lo pida)

Estrategia: **squash merge** → un commit por issue en `rewrite-v0.3`, con el título del PR como mensaje.

```bash
gh pr checks <PR> --watch          # esperar CI en verde
gh pr merge <PR> --squash --delete-branch
git switch rewrite-v0.3 && git pull --ff-only
git branch -d <rama>               # si sigue existiendo en local
```

Si la base avanzó mientras el PR estaba abierto: `git fetch origin && git rebase origin/rewrite-v0.3`, repetir checks y `git push --force-with-lease`.

Después del merge, verificar que el issue quedó cerrado y, si hubo hallazgos, que están en la página correspondiente del wiki.

## Reglas que no se rompen

- Nada de commits sin issue asociado.
- Nada de push directo a `rewrite-v0.3` o `main`; todo entra por PR.
- Nada de `--force` (solo `--force-with-lease`, y solo en ramas propias).
- Nada de `--no-verify` para saltarse hooks.
- Nada de `git stash` sin etiqueta: el stash se comparte con otros worktrees. Para apartar trabajo, usar un commit WIP en la rama.
- Nada de atribución a IA en commits, PR ni comentarios.
- Push, creación de PR y merge requieren confirmación del usuario en cada ejecución.
