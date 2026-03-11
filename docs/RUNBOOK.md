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
VITE_ASSISTANT_API_KEY=... \
VITE_ASSISTANT_MODEL=gpt-5.1-codex-mini \
./scripts/run-all.sh
```

If those env vars are not set, the assistant can still be configured from the in-app
assistant drawer and the values are stored locally in the browser.

Assistant UX notes:
- The assistant uses a chat-style drawer with a bottom composer.
- The default assistant flow is now teaching-first and step-streamed.
  - The assistant first shows a short outline of the planned steps.
  - It then inserts cells progressively instead of waiting for a final manual apply step.
  - Newly inserted assistant cells are marked as draft/validating/applied/failed in the notebook UI.
- Model and API key live under the collapsed `Settings` section.
- `Settings` also expose `Thinking level`.
- The available `Thinking level` values are filtered by model family:
  - `GPT-5.1 Codex mini`: `dynamic`, `low`, `medium`, `high`
  - `GPT-5.x / GPT-5 mini / GPT-5 nano`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Flash / Flash-Lite`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Pro`: `dynamic`, `low`, `high`
- Assistant requests use an inactivity timeout so a stalled model call fails with an explicit timeout instead of spinning forever.
- The default visible workflow is whole-notebook + auto mode; advanced scope/preference selectors are no longer shown in the main UI.
- Up to 5 recent chats are stored locally per notebook.
- A new notebook starts with a fresh assistant chat history.
- Assistant runs are persisted as JSON traces on the Jupyter contents side at:
  `notebooks/sugarpy-assistant-traces/<notebook-id>/<trace-id>.json`
- Those traces are intended for debugging stuck or failed assistant requests and include per-attempt HTTP telemetry, compact summaries of successful model responses, and compact summaries of any isolated sandbox executions.
- On the OpenAI path, the assistant consumes streaming Responses API events, refreshes the request timeout when new stream activity arrives, and stores stream-stage hints in trace/network telemetry so timeouts report the last observed stream event or activity instead of only a generic timeout.
- On the OpenAI path, final plan submission now prefers a `submit_plan` function call instead of depending only on a strict JSON text response.
- For direct geometry tasks such as finding circles from concrete points and a radius, the assistant is biased toward short Math-cell CAS workflows: write the point equations directly, call `solve(...)`, and derive the final circle equations from the returned centers instead of generating Python-heavy scaffolding.
- In `auto` mode, math requests are treated as Math-cell/CAS tasks by default. The assistant should stay out of Code cells unless the user explicitly asks for Python or SugarPy CAS clearly cannot express the task.
- For math/geometry/plotting requests, the assistant now inspects SugarPy references first, especially `math_cells` and `plotting`, before planning edits. Code is treated as a last-resort fallback after documented Math-cell workflows are considered.
- For teaching/demo Math requests, the assistant is constrained to a documented Math-cell subset from `docs/MATH_CELL_SPEC.md` instead of free-form SymPy-like helper invention.
- If a math request still produces a draft plan with Code cells, the assistant now retries planning with a stricter Math-cell-only constraint before showing the preview.
- For direct circle-from-points-and-radius prompts, if the model drafts a Math solution without `solve(...)`, SugarPy can replace that draft with a local CAS solve template instead of spending another slow model round on replanning.
- For code-cell drafts, the assistant may run an isolated validation step before showing the preview.
- Runnable assistant steps are validated before insertion.
  - Validation uses a fresh temporary Jupyter kernel, not the live notebook kernel.
  - Python code uses the existing sandbox presets.
  - Math cells now also run through isolated validation using SugarPy `render_math_cell(...)` semantics before they are inserted.
  - If a new Math step depends on earlier runnable cells, the validator replays those earlier Code/Math cells inside the temporary kernel first.
  - A sandbox timeout or runtime error is returned to the model as structured output and also blocks step insertion in the streamed apply flow.

Runtime server config without committing secrets:
- Create `notebooks/sugarpy-assistant-config.json` on the server or local Jupyter contents root.
- Example:
  ```json
  {
    "apiKey": "your-api-key",
    "model": "gpt-5.1-codex-mini"
  }
  ```
- This file is not tracked by git because `notebooks/` is ignored.
- The frontend will auto-load it and prefill the assistant.
- The shared server key is used automatically, but it is not copied into the visible settings field.
- The settings API-key input is treated as a user override.
- Important: this keeps the key out of GitHub, but not out of browser devtools. To fully hide the key, move model calls behind a backend proxy.

Recommended assistant models:
- `gpt-5.1-codex-mini`: default OpenAI path for notebook editing.
- `gpt-5-mini`: smaller GPT-5 option.
- `gpt-5-nano`: cheapest GPT-5 option.
- `gemini-3.1-flash-lite-preview`: Gemini fallback when you want the Google path.

Assistant regression checks:
- Browser regression coverage lives in `web/e2e/notebook.spec.ts`.
- Live assistant regression scenarios live in `web/e2e/assistant.live.spec.ts`.
- The targeted assistant suite can be run with:
  ```bash
  cd web && npx playwright test e2e/notebook.spec.ts --grep "Assistant"
  ```
- The live-model assistant suite can be run with:
  ```bash
  ASSISTANT_LIVE=1 ./scripts/assistant-live-check.sh
  ```
- Optional live assistant env vars:
  ```bash
  ASSISTANT_LIVE_API_KEY=... \
  ASSISTANT_LIVE_MODELS=gpt-5.1-codex-mini,gpt-5-mini \
  ASSISTANT_LIVE=1 ./scripts/assistant-live-check.sh
  ```
- If `ASSISTANT_LIVE_API_KEY` is omitted, the suite uses the shared runtime key/config already available to the app.
- This suite covers the OpenAI Responses payload contract, seeded notebook fixtures, degree-mode defaults, recent-error tool outputs, and the preview/apply assistant flow.
- It also covers isolated assistant sandbox validation, timeout/error reporting, and replay presets such as `imports-only` and `selected-cells`.

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
- The optional AI assistant is opened from the `Assistant` button in the header.
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
- The deployment workflow now expects a self-hosted runner on `seggver` with label `sugarpy-prod`.

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

Local deploy from a self-hosted runner or an interactive shell on `seggver`:
```bash
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-local.sh
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
