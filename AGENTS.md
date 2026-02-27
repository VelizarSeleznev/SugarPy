# AGENTS.md

This file is a table of contents for contributors and agents.

## Read this first
- Project map: `docs/PROJECT_MAP.md`
- Run and test commands: `docs/RUNBOOK.md`
- Architecture and invariants: `docs/ARCHITECTURE.md`

## Fast path
- Run app: `./scripts/run-all.sh`
- Run full checks: `./scripts/test-all.sh`

## Required quality gates
- For behavior changes, update the relevant file under `docs/`.
- For UI changes, run `./scripts/ui-check.sh` (or `./scripts/test-all.sh`) and report the browser result.
- Do not mark work complete when script checks fail or UI console errors remain.

## Scope rules
- Keep diffs small and focused; avoid broad refactors unless explicitly requested.
- Keep project language consistent (English) across code, UI, docs, tests, and logs.
