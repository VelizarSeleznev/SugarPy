# Architecture

## System shape
- Frontend (`web/`) is a React + Vite app.
- Backend runtime is a local Jupyter Server launched from `scripts/launch.sh`.
- Python domain logic lives in `src/sugarpy/`.
- The frontend talks to the local Jupyter server for execution and notebook behavior.

## Runtime boundaries
- UI and kernel communicate over localhost.
- Dev scripts pin Jupyter to:
  - Port: `8888`
  - Token: `sugarpy`
  - Allowed origin: `http://localhost:5173`
- Startup hook imports from `sugarpy.startup` via `.ipython/profile_default/startup/00-sugarpy.py`.
- `sugarpy.startup` preloads `from sympy import *`, `numpy as np`, defines `x, y, z, t`,
  enables `init_printing()`, and provides a custom `plot()` that emits
  `application/vnd.plotly.v1+json` to frontend MIME output.

## Data and catalogs
- Built-in function catalog: `web/public/functions.json`.
- User function extensions: `~/.sugarpy/user_functions.py`.
- `scripts/sync-functions.sh` keeps function definitions synchronized for runtime use.

## Invariants
- `./scripts/test-all.sh` is the primary project verification entrypoint.
- UI changes must be validated by `./scripts/ui-check.sh` (or by `./scripts/test-all.sh`).
- CAS UI behavior for code cells is MIME-first:
  - `application/vnd.plotly.v1+json` -> interactive Plotly render.
  - `text/latex` -> KaTeX render (after stripping SymPy wrappers).
  - `text/plain` -> plain text fallback.
  - `error` -> concise `ename: evalue` output.
- Behavior/architecture changes must include matching updates in `docs/`.
- Keep project language in English across code, UI text, docs, tests, and logs.
