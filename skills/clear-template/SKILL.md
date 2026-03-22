---
name: clear-template
description: Removes starter cruft from freshly scaffolded apps such as create-next-app and create-vite. Use when a new project still contains demo copy, sample assets, placeholder styles, boilerplate tests, or template-specific branding and should be reduced to a clean minimal starting point.
---

# Clear Template

Use this skill when the user wants a newly generated app cleaned up after scaffolding.

## Goals

Turn the generated project into a minimal, neutral starting point without changing its core stack.

Typical cleanup includes:

1. Remove demo text, logos, placeholder images, and template branding
2. Replace showcase/example UI with a minimal app shell
3. Delete unused sample components, styles, tests, and assets that only exist for the template
4. Keep the existing framework, tooling, package manager, and project structure unless the user asks otherwise
5. Leave the project in a runnable state

## Workflow

### 1) Inspect before changing anything

Read the files that define the current app entrypoints and styling. For example:

- `package.json`
- Framework entry files such as:
    - Next.js App Router: `app/page.*`, `app/layout.*`, `app/globals.css`
    - Next.js Pages Router: `pages/index.*`, `pages/_app.*`
    - Vite React: `src/App.*`, `src/main.*`, `src/index.css`, `src/App.css`
    - Vite Vue: `src/App.vue`, `src/main.*`, relevant CSS files
    - Vite Svelte: `src/App.svelte`, `src/app.css`, `src/main.*`
- Any obvious template-only assets and components referenced by those files

Also inspect the directory tree for template artifacts such as:

- `public/` or `src/assets/` logos
- sample components
- boilerplate test files
- generated README content that is purely template boilerplate

### 2) Identify what is cruft vs. what is foundational

Remove files only when they are clearly template/demo material.

Keep:

- framework configuration
- TypeScript/JS config
- build tooling
- lint/format setup
- routing/layout structure required by the framework
- useful aliases or path config

Do not remove something just because it is unused unless you verify it is template-generated or the user asked for aggressive cleanup.

### 3) Replace the app with a minimal neutral shell

Prefer a very small default UI.

Examples:

- A single page with the project name or a simple heading like `Welcome`
- Minimal explanatory text only if helpful
- Basic accessible structure

Guidelines:

- Preserve the framework conventions already in use
- Keep imports minimal
- Remove unnecessary state, logos, counters, and tutorial links
- Simplify CSS to only what supports the minimal shell
- If the template uses utility CSS such as Tailwind, keep the utility setup and simplify the markup instead of replacing the styling system

### 4) Clean related assets and files

After simplifying the entry UI, remove now-unused template files, for example:

- logo SVGs
- sample images
- starter components
- example test files tied to removed UI
- unused CSS files

Update imports/references so there are no dangling references.

### 5) Validate

After edits:

- read back changed files to confirm them
- run the project checks that make sense for the repo if available, such as:
    - install-free validation commands already present in the repo
    - `npm run lint`
    - `npm run check`
    - `npm run build`
- if there is no obvious validation script, at least ensure imports and file references are internally consistent

Report any failures clearly.

## Framework-specific notes

### create-next-app

Common cruft to remove:

- default hero content in `app/page.tsx` or `pages/index.tsx`
- starter `next.svg`, `vercel.svg`, or similar assets
- excessive default styles that only support the starter screen
- template metadata text if the user wants a neutral app

### create-vite

Common cruft to remove:

- `Vite + <framework>` demo heading
- rotating logos
- starter counter state
- `App.css` styles for the demo card
- framework-specific sample assets in `src/assets`

## Summary expectations

When done, summarize:

- which files were changed
- which files were deleted
- what validation commands were run
- any remaining template material you intentionally left in place
