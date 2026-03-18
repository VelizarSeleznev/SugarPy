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
- For Math-cell command/function changes, update `docs/MATH_CELL_SPEC.md` in the same change set.
- For UI changes, run `./scripts/ui-check.sh` (or `./scripts/test-all.sh`) and report the browser result.
- For assistant/LLM runtime changes, finish with one real browser validation against the live model path when credentials/services are available; do not rely only on mocked tests.
- For changes that must be visible on the demo server, deploy the updated code to `seggver` in the same work session and report the deployed URL or deployment status.
- Use the documented remote deploy command from `docs/DEPLOY_DEMO.md` / `docs/RUNBOOK.md`; do not stop after local file edits when the user expects a live server update.
- Do not mark work complete when script checks fail or UI console errors remain.

## Scope rules
- Keep diffs small and focused; avoid broad refactors unless explicitly requested.
- Keep project language consistent (English) across code, UI, docs, tests, and logs.

## Git workflow rules
- Do not do ongoing work directly on `master`.
- Start each task on a work branch with `./scripts/start-work.sh <name>` (branches use the `codex/` prefix and always start from refreshed `master`; already-merged stale branches are recreated automatically).
- Create checkpoints frequently for each completed logical slice with `./scripts/checkpoint.sh "message"`.
- Checkpoints must be pushed to GitHub, not kept only in local history.
- Release only from a work branch with `./scripts/release.sh`; this is the step that runs full checks, merges into `master`, triggers deployment, returns the repo to `master`, and cleans up the merged `codex/*` branch by default.
