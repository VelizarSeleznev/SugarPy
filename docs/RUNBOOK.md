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

## Common failures
- `uv is required but not installed`:
  Install `uv`, then rerun.
- `Port 8888 is already in use`:
  Stop the process using port 8888, then rerun.
- Jupyter not ready in `run-all.sh`:
  Check backend logs and confirm no port conflict.
