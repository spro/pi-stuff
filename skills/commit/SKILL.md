---
name: commit
description: Makes clean git commits with short messages, split by logical change, and limited to current-session work by default.
---

# Commit

Use this skill when the user wants changes committed.

## Rules

- Keep commit messages short and pithy
- Split separate logical changes into separate commits
- Ignore changes outside the current session unless the user explicitly says to include them
- Prefer the minimum git inspection needed to make a safe commit

## Default procedure

1. Run `git status --short`
2. If the intended files are obvious, stage those paths directly
3. Only inspect diffs when scope is unclear or a file appears mixed
4. Commit each logical unit separately with a brief subject

