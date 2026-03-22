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

## Workflow

1. Check `git status --short` and the relevant diffs
2. Stage only the files or hunks from this session
3. If a file mixes unrelated work, use selective staging or ask
4. Commit each logical unit separately with a brief subject

## Avoid

- vague commit messages
- one big mixed commit
- staging pre-existing unrelated changes
