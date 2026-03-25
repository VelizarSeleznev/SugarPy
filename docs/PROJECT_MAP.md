# Project Map

## Purpose
SugarPy is a local notebook toolkit:
- Python package for math and chemistry helpers.
- React/Vite web UI for notebook-style interaction with a restricted SugarPy backend API.
- CAS-style Math cell parser/evaluator for teacher-friendly math input.

## Top-level layout
- `src/sugarpy/`: Python package code (startup hooks, chemistry/math helpers, catalog loading, restricted server API).
  - `server_extension.py` is now the thin API entrypoint; backend service modules live under `src/sugarpy/server/`.
  - Runtime backend helper implementations live in `src/sugarpy/runtime_manager_backends.py`.
  - Shared math parser helpers live in `src/sugarpy/math_parser_helpers.py`.
- `web/src/`: frontend app code.
  - Assistant orchestration still enters through `web/src/ui/utils/assistant.ts`, but shared assistant types/patch helpers now also live under `web/src/ui/assistant/`.
  - Cell definitions and the registry-backed notebook foundation live under `web/src/ui/cells/`.
  - Notebook document helpers and persistence hooks live under `web/src/ui/notebook/`.
  - Local preferences and theme infrastructure live under `web/src/ui/preferences/` and `web/src/ui/theme/`.
- `web/public/functions.json`: built-in function catalog for autocomplete and function library UI.
- `scripts/`: run/test/dev automation scripts.
- `deploy/`: demo deployment examples (Nginx + systemd).
- `notebooks/`: local notebooks.
- `artifacts/`, `output/`: generated outputs.

## Main user entry points
- Notebook app: `http://localhost:5173/`
- Standalone teacher wiki page: `http://localhost:5173/wiki`
- Demo notebook: `notebooks/CoreFeaturesDemo.ipynb`
- Visual math regression fixture: `notebooks/Roundabout_Visual_Check.sugarpy`
- Notebook UI uses a compact fixed top header, touch-friendly cell gestures, and inline
  insert controls for `Code | Text | Math`, plus secondary `More blocks` discovery for `Stoich` and `Regression`, and a desktop left-rail insert and drag rail for each cell.
- Code and Math cells share a CodeMirror editor layer with syntax highlighting, autocomplete,
  bracket matching, auto-closing pairs, and snippet-style function insertion tuned for notebook work.

## Key scripts
- `scripts/run-all.sh`: starts Jupyter backend and Vite dev server together.
- `scripts/launch.sh`: starts Jupyter server only.
- `scripts/test-all.sh`: full Python + frontend + UI checks.
- `scripts/ui-check.sh`: Playwright smoke UI checks (`@smoke`).
- `web/e2e/notebook.spec.ts`: browser E2E, including assistant regression coverage.
- `scripts/sync-functions.sh`: syncs user function file (`~/.sugarpy/user_functions.py`) into runtime location.
- `scripts/start-work.sh`: refreshes `master`, then creates or resumes a `codex/*` work branch; stale branches already merged into `master` are recreated from fresh `master`.
- `scripts/checkpoint.sh`: commits and pushes the current work branch to GitHub.
- `scripts/release.sh`: runs checks, merges the current work branch into `master`, pushes the release, leaves the repo on `master`, and cleans up merged `codex/*` branches by default.

## Specs
- Product-level feature inventory and AI assistant proposal: `docs/PRODUCT_GUIDE.md`.
- Math cell behavior and syntax: `docs/MATH_CELL_SPEC.md`.
- Notebook authoring guidelines (large tasks): `docs/ASSIGNMENT_GUIDELINES.md`.
- Testing policy and maintenance rules: `docs/TESTING_PRINCIPLES.md`.
- Demo deployment guide: `docs/DEPLOY_DEMO.md`.
- Current server deployment snapshot: `docs/DEPLOY_STATE.md`.

## External state
- User functions are loaded from `~/.sugarpy/user_functions.py`.
- Local dev runs a Jupyter-backed SugarPy API on `http://localhost:8888/sugarpy/api/` behind the Vite `/api` proxy.
