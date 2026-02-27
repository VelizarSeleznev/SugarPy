# Project Map

## Purpose
SugarPy is a local notebook toolkit:
- Python package for math and chemistry helpers.
- React/Vite web UI for notebook-style interaction with a local Jupyter kernel.

## Top-level layout
- `src/sugarpy/`: Python package code (startup hooks, chemistry/math helpers, catalog loading).
- `web/src/`: frontend app code.
- `web/public/functions.json`: built-in function catalog for autocomplete and function library UI.
- `scripts/`: run/test/dev automation scripts.
- `notebooks/`: local notebooks.
- `artifacts/`, `output/`: generated outputs.

## Key scripts
- `scripts/run-all.sh`: starts Jupyter backend and Vite dev server together.
- `scripts/launch.sh`: starts Jupyter server only.
- `scripts/test-all.sh`: full Python + frontend + UI checks.
- `scripts/ui-check.sh`: headless UI console-error check via `agent-browser`.
- `scripts/sync-functions.sh`: syncs user function file (`~/.sugarpy/user_functions.py`) into runtime location.

## External state
- User functions are loaded from `~/.sugarpy/user_functions.py`.
- Local Jupyter endpoint is `http://localhost:8888` with token `sugarpy` in dev scripts.
