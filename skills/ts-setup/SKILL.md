---
name: ts-setup
description: Sets up a TypeScript repository with Prettier formatting and package.json scripts. Use when a repo needs Prettier installed, a standard Prettier config added, a format script created, and a check script that runs formatting plus a TypeScript type check.
---

# TypeScript Repo Setup

Use this skill when the user wants a TypeScript project bootstrapped or normalized with formatting and basic verification scripts.

## Goals

Make these changes in the target repository:

1. Install `prettier` as a dev dependency
2. Add a Prettier config with:
   - `tabWidth: 4`
   - `useTabs: false`
   - `trailingComma: "all"`
   - `semi: false`
3. Add a `format` script to `package.json` that runs Prettier in write mode
4. Add a `check` script to `package.json` that runs `format` and then a TypeScript type check

## Workflow

### 1) Inspect the repo first

Before changing anything:

- Read `package.json`
- Check for a TypeScript config such as `tsconfig.json`
- Detect the package manager from lockfiles:
  - `package-lock.json` → npm
  - `pnpm-lock.yaml` → pnpm
  - `yarn.lock` → yarn
  - `bun.lock` or `bun.lockb` → bun
- Check whether a Prettier config already exists:
  - `.prettierrc`
  - `.prettierrc.json`
  - `.prettierrc.yml`
  - `.prettierrc.yaml`
  - `.prettierrc.js`
  - `.prettierrc.cjs`
  - `prettier.config.js`
  - `prettier.config.cjs`
  - `package.json` `prettier` field

If the repo does not appear to be a TypeScript repo, stop and ask the user before continuing.

### 2) Install Prettier

Use the detected package manager.

- npm: `npm install -D prettier`
- pnpm: `pnpm add -D prettier`
- yarn: `yarn add -D prettier`
- bun: `bun add -d prettier`

If no lockfile exists, default to npm unless the user indicates otherwise.

### 3) Add or update the Prettier config

Prefer creating `.prettierrc.json` unless the repo already uses another Prettier config format. If an existing config is present, update it instead of creating a second config.

Use exactly this configuration:

```json
{
    "tabWidth": 4,
    "useTabs": false,
    "trailingComma": "all",
    "semi": false
}
```

Do not create conflicting duplicate Prettier configs.

### 4) Update `package.json` scripts

Ensure `package.json` has these scripts:

```json
{
    "format": "prettier . --write",
    "check": "npm run format && tsc --noEmit"
}
```

Adjust the `check` script for the detected package manager:

- npm: `npm run format && tsc --noEmit`
- pnpm: `pnpm format && tsc --noEmit`
- yarn: `yarn format && tsc --noEmit`
- bun: `bun run format && tsc --noEmit`

Rules:

- Preserve existing unrelated scripts
- Overwrite existing `format` and `check` only if needed to match the requested behavior
- Keep `tsc --noEmit` as the type-check step
- Do not add `npx`/`pnpm exec`/`yarn dlx` if `tsc` is already expected to resolve from project dependencies

If `typescript` is not present in dependencies or devDependencies, stop and ask the user whether it should be installed before adding the `check` script.

### 5) Validate

After edits:

- Read back the changed files to confirm the updates
- If appropriate, run the new `format` script
- If TypeScript is installed, run the `check` script
- Report any failures clearly

## Implementation notes

- Use `read` before editing files
- Use `edit` for surgical changes and `write` only for new files or complete rewrites
- Keep JSON formatting valid when changing `package.json`
- Prefer minimal changes
- Summarize exactly what files were changed and what commands were run
