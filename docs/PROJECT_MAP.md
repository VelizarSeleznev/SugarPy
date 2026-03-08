# Project Map

## Purpose
SugarPy is a local notebook toolkit:
- Python package for math and chemistry helpers.
- React/Vite web UI for notebook-style interaction with a local Jupyter kernel.
- CAS-style Math cell parser/evaluator for teacher-friendly math input.

## Top-level layout
- `src/sugarpy/`: Python package code (startup hooks, chemistry/math helpers, catalog loading).
- `web/src/`: frontend app code.
- `web/public/functions.json`: built-in function catalog for autocomplete and function library UI.
- `scripts/`: run/test/dev automation scripts.
- `deploy/`: demo deployment examples (Nginx + systemd, including cloudflared service).
- `notebooks/`: local notebooks.
- `artifacts/`, `output/`: generated outputs.

## Main user entry points
- Notebook app: `http://localhost:5173/`
- Standalone teacher wiki page: `http://localhost:5173/wiki`
- Demo notebook: `notebooks/CoreFeaturesDemo.ipynb`
- Notebook UI uses a fixed top header and a single bottom `+ Add Cell` entry point
  (`Code | Text | Math | Stoich`).
- Code cells include an in-cell language selector (`Python`, `C`, `Go`, `PHP`) for authoring.
  Runtime execution currently applies to Python code cells.

## Key scripts
- `scripts/run-all.sh`: starts Jupyter backend and Vite dev server together.
- `scripts/launch.sh`: starts Jupyter server only.
- `scripts/test-all.sh`: full Python + frontend + UI checks.
- `scripts/ui-check.sh`: Playwright smoke UI checks (`@smoke`).
- `scripts/sync-functions.sh`: syncs user function file (`~/.sugarpy/user_functions.py`) into runtime location.

## Specs
- Math cell behavior and syntax: `docs/MATH_CELL_SPEC.md`.
- Notebook authoring guidelines (large tasks): `docs/ASSIGNMENT_GUIDELINES.md`.
- Testing policy and maintenance rules: `docs/TESTING_PRINCIPLES.md`.
- Demo deployment guide: `docs/DEPLOY_DEMO.md`.
- Current server deployment snapshot: `docs/DEPLOY_STATE.md`.

## External state
- User functions are loaded from `~/.sugarpy/user_functions.py`.
- Local Jupyter endpoint is `http://localhost:8888` with token `sugarpy` in dev scripts.
