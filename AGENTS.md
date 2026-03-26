# AGENTS.md

## Pi resource linking

- `~/.pi/agent/extensions` is already symlinked to this repo's `extensions/` directory.
- `~/.pi/agent/skills` is already symlinked to this repo's `skills/` directory.
- Any new extension added under `./extensions/` or any new skill added under `./skills/` is automatically available to Pi - recommend running `/reload` to test them.
- Do not create additional per-file or per-skill symlinks unless explicitly asked; adding the resource in this repo is enough.

## Scripts

- `npm run format` — Format the repo with Prettier.
- `npm run format:check` — Check formatting without rewriting files.
- `npm run typecheck` — Run `tsc --noEmit`.
- `npm run check` — Run formatting and typecheck validation.
