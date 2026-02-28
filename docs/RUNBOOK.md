# Runbook

## Prerequisites
- `uv` installed (https://astral.sh/uv)
- Node.js + npm available for `web/`

## Start everything (recommended)
```bash
./scripts/run-all.sh
```

What it does:
- Syncs Python deps with `uv` into `.venv`.
- Syncs user functions.
- Starts Jupyter Server on `http://localhost:8888`.
- Starts Vite dev server for the UI (`http://localhost:5173`).

## Start backend only
```bash
./scripts/launch.sh
```

## Full verification (recommended before completion)
```bash
./scripts/test-all.sh
```

What it covers:
- Python smoke checks (`chem`, catalog loader, math/stoichiometry helpers).
- Frontend install/build/audit.
- UI headless console check with `agent-browser`.

## UI-only console check
```bash
./scripts/ui-check.sh
```

## E2E notebook checks
```bash
cd web
npm run test:e2e
```

What it covers:
- SymPy LaTeX rendering in code cells.
- Plotly MIME rendering from kernel `display_data`.
- Runtime error rendering (`ename: evalue`) without React crash.

## Common failures
- `uv is required but not installed`:
  Install `uv`, then rerun.
- `Port 8888 is already in use`:
  `run-all.sh` now auto-stops existing listeners on ports 8888/5173 before restart.
  If this still fails, stop blocking processes manually and rerun.
- Jupyter not ready in `run-all.sh`:
  Check backend logs and confirm no port conflict.

## Known limitations
- Plotly zoom-out behavior is still imperfect for some functions (for example wide parabola views):
  the graph is precomputed on a finite x-range and then transformed client-side. At larger zoom-out
  levels this can look visually distorted compared to expected behavior.
- The Plotly toolbar autoscale action is intentionally disabled in the UI because it can collapse
  the visible range to a misleading cut view in the current implementation.
