# pi stuff

Custom Pi extensions and skills for local experiments and workflow tweaks.

`extensions/` and `skills/` in this repo are already symlinked into `~/.pi/agent/`, so adding or editing files here makes them available to Pi without extra setup.

## Extensions

- `context.ts` — `/context` shows loaded context, extensions, skills, read files, and usage details.
- `files.ts` — `/files` browser with git status, session file references, reveal/open/edit/diff actions, plus shortcuts.
- `project-search.ts` — Adds an `rg`-backed `project_search` tool scoped to the current project.
- `session-breakdown.ts` — `/session-breakdown` shows interactive recent session usage and cost breakdowns.
- `session-title.ts` — Auto-titles sessions and adds `/retitle` and `/generate-title`; persists titles under `~/.pi/agent/session-titles/`.
- `summarize.ts` — Adds `/summarize`, which writes a resumable conversation summary to `SUMMARY-YYYYMMDD-HHMM.md`.
- `scratch.ts` — Scratch extension experiments, including `hello` and a sample `greet` tool.

## Skills

- `grill` — Asks clarifying questions one at a time until the goal is clear.
- `ts-setup` — Sets up Prettier formatting and TypeScript verification scripts.
- `clear-template` — Removes scaffold/demo cruft from freshly generated apps.
- `commit` — Creates focused git commits with short messages, split by logical change, while ignoring unrelated pre-existing changes by default.

## Scripts

- `npm run format` — Format the repo with Prettier.
- `npm run format:check` — Check formatting without rewriting files.
- `npm run typecheck` — Run `tsc --noEmit`.
- `npm run check` — Run formatting and typecheck validation.
