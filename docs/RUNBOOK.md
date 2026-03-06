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

## Notebook persistence (autosave + recovery)
- The UI now keeps a local autosave in browser `localStorage` for crash/reload recovery.
- The UI also writes a server autosave (`.sugarpy`) to:
  `notebooks/sugarpy-autosave/<notebook-id>.sugarpy`
- On startup, SugarPy restores the newest version between local autosave and server autosave.
- Manual **Save to Server** still writes an `.ipynb` file under `notebooks/` and also refreshes server autosave.
- Notebook actions are available from the top-right `⋮` menu in the fixed header.
- A `Run All` button in the fixed header executes all runnable cells top-to-bottom.
- New cells are created from the single bottom `+ Add Cell` control.
- On phone portrait touch devices, cell actions move to a fixed action bar above the virtual keyboard while editing.

## Open the standalone wiki page
- Open `http://localhost:5173/wiki`
- This page is static and does not require a kernel connection.

## Open the demo notebook
- Open `notebooks/CoreFeaturesDemo.ipynb` in Jupyter and run top-to-bottom.
- The notebook demonstrates the core Math + Code flow and optional chemistry helpers.
- For the native SugarPy experience (with Text/Code/Math/Stoich cells), import:
  `notebooks/CoreFeaturesDemo.sugarpy` from the SugarPy UI.
- Legacy files with `.sugarpy.json` are still supported on import.
- CAS-first circle intersection demo (2 Math cells + plot):
 - CAS-first circle intersection demo (2 Math cells + plot):
  `notebooks/CircleIntersections_CAS.sugarpy`

## Authoring guidelines for large tasks
See `docs/ASSIGNMENT_GUIDELINES.md` for the recommended structure and conventions
for multi-step CAS-first assignments.

## Demo deployment (single host, multi-user)
See `docs/DEPLOY_DEMO.md` for the reverse-proxy + Jupyter server demo setup.
See `docs/DEPLOY_STATE.md` for the current working deployment snapshot on server.

## Start backend only
```bash
./scripts/launch.sh
```

## Full verification (recommended before completion)
```bash
./scripts/test-all.sh
```

What it covers:
- Frontend install/build/audit.
- Backend pytest suite (`tests/backend/`).
- Playwright E2E suite (`web/e2e/`) including smoke checks.
- Testing standards and maintenance rules are defined in `docs/TESTING_PRINCIPLES.md`.

## Manual visual QA (Pinchtab)
After UI or rendering changes, perform a manual Pinchtab pass using the checklist in
`docs/TESTING_PRINCIPLES.md`.

## UI-only console check
```bash
./scripts/ui-check.sh
```
This runs Playwright smoke tests (`--grep @smoke`) without screenshot assertions.

## E2E notebook checks
```bash
cd web
npm run test:e2e
```

What it covers:
- SymPy LaTeX rendering in code cells.
- Plotly MIME rendering from kernel `display_data`.
- Runtime error rendering (`ename: evalue`) without React crash.
- Math cell equation rendering and Code->Math namespace sharing flow.

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
