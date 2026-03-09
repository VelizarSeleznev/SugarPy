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

Optional assistant env vars:
```bash
VITE_GEMINI_API_KEY=... \
VITE_GEMINI_MODEL=gemini-3.1-flash-lite-preview \
./scripts/run-all.sh
```

If those env vars are not set, the Gemini assistant can still be configured from the in-app
assistant drawer and the values are stored locally in the browser.

Recommended Gemini models:
- `gemini-3.1-flash-lite-preview`: default cheap/fast path.
- `gemini-3-flash-preview`: stronger general fallback.
- `gemini-3.1-pro-preview`: last-resort escalation model.

## Notebook persistence (autosave + recovery)
- The UI now keeps a lightweight local autosave in browser `localStorage` for crash/reload recovery.
- Local autosave stores notebook structure and cell source/state, but skips heavy runtime outputs so large plots do not exhaust browser storage.
- SugarPy keeps only the current local notebook snapshot; older local notebook autosaves are pruned automatically.
- The UI also writes a server autosave (`.sugarpy`) to:
  `notebooks/sugarpy-autosave/<notebook-id>.sugarpy`
- On startup, SugarPy restores the newest version between local autosave and server autosave.
- If browser storage is unavailable or full, SugarPy skips local autosave and continues with server autosave instead of failing to load.
- Manual **Save to Server** still writes an `.ipynb` file under `notebooks/` and also refreshes server autosave.
- Notebook actions are available from the top-right `⋮` menu in the fixed header.
- The optional Gemini assistant is opened from the `Assistant` button in the header.
- The `⋮` menu stores notebook defaults for new Math cells: `Degrees/Radians` and `Exact/Decimal`.
- A `Run All` button in the fixed header executes all runnable cells top-to-bottom.
- New notebooks open empty and show centered `Code | Text | Math` creation controls.
- New cells are created from the single bottom `+ Add Cell` control.
- Math cells collapse into rendered Math cards after execution; tap/click a card to reopen the raw CAS editor.
- Math editor includes a compact shortcut bar for common CAS inserts (`^2`, `sqrt`, `solve`, `expand`, `N`, `plot`).
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

## Git workflow
- Start new work on a branch, not on `master`:
  ```bash
  ./scripts/start-work.sh short-task-name
  ```
- Save progress often and push checkpoints to GitHub:
  ```bash
  ./scripts/checkpoint.sh "Describe the completed slice"
  ```
- Cut a release only when the branch is ready:
  ```bash
  ./scripts/release.sh
  ```

What the release command does:
- Requires a clean worktree.
- Runs `./scripts/test-all.sh` unless `SKIP_TESTS=1` is set.
- Pushes the current work branch to GitHub.
- Merges the branch into `master`.
- Pushes `master`, which triggers the deployment workflow.

## Update code on the demo server
When a change is intended to affect the live demo, do not stop at local edits.
Deploy the current repository state to `seggver` and report whether deployment succeeded.

Manual remote deploy:
```bash
DEPLOY_HOST=seggver \
DEPLOY_USER=sugarpy \
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_PORT=22 \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-remote.sh
```

After deploy:
- Confirm the frontend is reachable from `http://127.0.0.1:18081/` on the server.
- Confirm Jupyter health from `http://127.0.0.1:18081/jupyter/api/status?token=sugarpy`.
- Confirm the public Cloudflare URL is reachable and report `https://sugarpy.tech/`.
- Keep in mind that `/jupyter/` is currently public behind the same origin and uses a shared demo token.
- Deploys now build into `/opt/sugarpy/releases/<sha>` and then atomically switch `/opt/sugarpy/current`.

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
- Plotly zoom-out behavior is still finite-sample based:
  the graph is precomputed on an extended x-range and then transformed client-side. Very large zoom-out
  levels can still look less faithful than a true re-sampled plot.
- The Plotly toolbar autoscale action is intentionally disabled in the UI because SugarPy now treats
  the requested plot range (`xmin`/`xmax`, optionally `ymin`/`ymax`) as the authoritative initial view.
