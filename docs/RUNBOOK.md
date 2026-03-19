# Runbook

## Prerequisites
- `uv` installed (https://astral.sh/uv)
- Node.js + npm available for `web/`

## Canonical checks
Use these commands instead of ad hoc `uv run`, direct `pytest`, or manual Playwright command guessing:

```bash
./scripts/check backend
./scripts/check ui
./scripts/check runtime
./scripts/check all
```

Helpful targeted commands:
```bash
./scripts/check notebook-smoke
./scripts/check assistant-mocked
./scripts/check assistant-live
./scripts/doctor.sh
```

## Start everything (recommended)
```bash
./scripts/run-all.sh
```

What it does:
- Warns if the current checkout is an old merged work branch that is behind `master`.
- Syncs Python deps with `uv` into `.venv`.
- Syncs user functions.
- Starts the restricted SugarPy backend on `http://localhost:8888`.
- Starts Vite dev server for the UI (`http://localhost:5173`) with a `/api` proxy to the backend.

Optional assistant env vars:
```bash
VITE_ASSISTANT_API_KEY=... \
VITE_ASSISTANT_MODEL=gpt-5-mini \
./scripts/run-all.sh
```

Do not commit `web/.env.local`. It is intended only for local untracked overrides.

If those env vars are not set, the assistant can still be configured from the in-app
assistant drawer and the values are stored locally in the browser.

Assistant UX notes:
- The assistant uses a photo-first drawer with a secondary typed-chat section.
- The default assistant flow is now staged and teaching-first.
  - The assistant first inspects the notebook and builds a structured plan.
  - It then generates a draft preview with per-step validation results in the drawer.
  - The live notebook, autosave state, and export payload stay unchanged until `Accept all` or `Accept step`.
  - `Reject draft` discards the staged draft without resetting the chat.
  - Failed validation keeps the proposed draft visible and marks the affected step as blocked instead of hiding what the model tried to do.
- Model and API key live under the collapsed `Settings` section.
- `Settings` also expose `Thinking level`.
- The header primary assistant entry is `Import from photo`.
  - The drawer lets the user replace/cancel the image and add an optional import instruction before extraction.
  - The typed assistant is still available inside the drawer as a secondary flow.
  - Photo import currently uses the OpenAI path, so it requires either a browser OpenAI key override or a shared server OpenAI key.
- The available `Thinking level` values are filtered by model family:
  - `GPT-5.1 Codex mini`: `dynamic`, `low`, `medium`, `high`
  - `GPT-5.x / GPT-5 mini / GPT-5 nano`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Flash / Flash-Lite`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Pro`: `dynamic`, `low`, `high`
- Assistant requests use an inactivity timeout so a stalled model call fails with an explicit timeout instead of spinning forever.
- The default visible workflow is whole-notebook + auto mode; advanced scope/preference selectors are no longer shown in the main UI.
- Up to 5 recent chats are stored locally per notebook.
- A new notebook starts with a fresh assistant chat history.
- Assistant traces are now backend-owned and disabled by default in restricted deployments.
- When enabled, traces are persisted outside the public web root and are redacted before writing.
- On the OpenAI path, the assistant consumes streaming Responses API events, refreshes the request timeout when new stream activity arrives, and stores stream-stage hints in trace/network telemetry so timeouts report the last observed stream event or activity instead of only a generic timeout.
- On the OpenAI path, final plan submission now prefers a `submit_plan` function call instead of depending only on a strict JSON text response.
- For direct geometry tasks such as finding circles from concrete points and a radius, the assistant is biased toward short Math-cell CAS workflows: write the point equations directly, call `solve(...)`, and derive the final circle equations from the returned centers instead of generating Python-heavy scaffolding.
- In `auto` mode, math requests are treated as Math-cell/CAS tasks by default. The assistant should stay out of Code cells unless the user explicitly asks for Python or SugarPy CAS clearly cannot express the task.
- For math/geometry/plotting requests, the assistant now inspects SugarPy references first, especially `math_cells` and `plotting`, before planning edits. Code is treated as a last-resort fallback after documented Math-cell workflows are considered.
- For teaching/demo Math requests, the assistant is constrained to a documented Math-cell subset from `docs/MATH_CELL_SPEC.md` instead of free-form SymPy-like helper invention.
- If a math request still produces a draft plan with Code cells, the assistant now retries planning with a stricter Math-cell-only constraint before showing the preview.
- For direct circle-from-points-and-radius prompts, if the model drafts a Math solution without `solve(...)`, SugarPy can replace that draft with a local CAS solve template instead of spending another slow model round on replanning.
- For code-cell drafts, the assistant may run an isolated validation step before showing the preview.
- Runnable assistant draft steps are validated before acceptance.
  - Validation uses a fresh backend-owned temporary runtime, not a browser-managed live kernel.
  - Python code uses explicit sandbox context presets and may retry with stronger replay context when isolated validation fails.
  - Math cells now also run through isolated validation using SugarPy `render_math_cell(...)` semantics before they are accepted.
  - Restricted deployments require Docker-backed sandbox isolation; if Docker is unavailable, assistant validation returns an explicit unavailable error instead of falling back to host execution.
  - Validation may replay notebook cells and earlier draft cells inside the sandbox only; the live notebook runtime is still untouched until apply/run.
  - A sandbox timeout or runtime error is surfaced in the preview and blocks acceptance for that step.

Runtime server config for restricted deployments:
- SugarPy now supports a backend-side assistant proxy for shared server keys.
- Preferred server env vars:
  ```bash
  SUGARPY_ASSISTANT_OPENAI_API_KEY=...
  SUGARPY_ASSISTANT_GEMINI_API_KEY=...
  SUGARPY_ASSISTANT_MODEL=gpt-5.1-codex-mini
  ```
- Non-root fallback: the Jupyter extension also reads `~/.config/sugarpy/assistant.env` for the same keys.
- Store shared assistant keys only in server-owned env files such as `/etc/sugarpy/assistant.env`.
- When one of those keys is present, the frontend auto-detects the shared provider and sends assistant model calls through the backend proxy instead of sending the key to the browser.
- The browser must never read keys from `notebooks/` or any public contents path.
- The settings API-key input is treated as a user override for local/dev use only.

Recommended assistant models:
- `gpt-5-mini`: default OpenAI path for notebook editing.
- `gpt-5.1-codex-mini`: optional Codex-path fallback for comparison and live regression.
- `gpt-5-nano`: cheapest GPT-5 option.
- `gemini-3.1-flash-lite-preview`: Gemini fallback when you want the Google path.
- `moonshotai/kimi-k2-instruct-0905`: experimental Groq OpenAI-compatible path for live comparison, not the default flow.

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
  ASSISTANT_LIVE_MODELS=gpt-5-mini,gpt-5.1-codex-mini,gemini-3.1-flash-lite-preview,moonshotai/kimi-k2-instruct-0905 \
  ASSISTANT_LIVE=1 ./scripts/assistant-live-check.sh
  ```
- Provider-specific live keys are also supported:
  ```bash
  ASSISTANT_LIVE_OPENAI_API_KEY=... \
  ASSISTANT_LIVE_GEMINI_API_KEY=... \
  ASSISTANT_LIVE_GROQ_API_KEY=... \
  ASSISTANT_LIVE_MODELS=gpt-5-mini,gpt-5.1-codex-mini,gemini-3.1-flash-lite-preview,moonshotai/kimi-k2-instruct-0905 \
  ASSISTANT_LIVE=1 ./scripts/assistant-live-check.sh
  ```
- If `ASSISTANT_LIVE_API_KEY` is omitted, the suite uses the shared runtime key/config already available to the app.
- If `ASSISTANT_LIVE_API_KEY` is set, it overrides the provider-specific live-key env vars.
- This suite covers the OpenAI Responses payload contract, seeded notebook fixtures, degree-mode defaults, recent-error tool outputs, and the staged preview plus accept/reject flow.
- It also covers isolated assistant sandbox validation, timeout/error reporting, reject-without-mutation checks, and partial `Accept step` behavior when a draft contains multiple validated steps.

## Notebook persistence (autosave + recovery)
- The UI now keeps a lightweight local autosave in browser `localStorage` for crash/reload recovery.
- Local autosave stores notebook structure and cell source/state, but skips heavy runtime outputs so large plots do not exhaust browser storage.
- SugarPy keeps only the current local notebook snapshot; older local notebook autosaves are pruned automatically.
- The UI also writes a backend-owned server autosave (`.sugarpy`) outside the public web root.
- On startup, SugarPy restores the newest version between local autosave and server autosave.
- If browser storage is unavailable or full, SugarPy skips local autosave and continues with server autosave instead of failing to load.
- Manual **Save to Server** now writes the normalized SugarPy notebook document through the backend API and refreshes server autosave.
- Notebook actions are available from the top-right `⋮` menu in the fixed header.
- The `⋮` menu now closes immediately after actions fire and scrolls internally on smaller screens instead of extending off-screen.
- On narrow layouts, the header action row collapses to compact square icon buttons instead of stretching full-width labels.
- On desktop, `Run All` and `Import from photo` keep both icon + text; on narrower layouts they collapse to icon-only square buttons.
- The `⋮` menu also includes `Clear Outputs`, which removes current code/math/stoich runtime results without deleting cells or notebook content.
- The optional AI assistant is opened from the `Import from photo` button in the header, with typed chat inside the drawer.
- The `⋮` menu stores notebook defaults for new Math cells: `Degrees/Radians` and `Exact/Decimal`.
- The header `Run All` control becomes a `Stop Runtime` toggle while cells are running.
- A running code or math cell also swaps its left gutter `Run cell` button to `Stop cell`, using the same runtime interrupt path as the header control.
- The `⋮` menu still exposes `Stop Runtime`, `Restart Notebook Runtime`, and `Delete Notebook Runtime` for explicit runtime control.
- If an interrupt cannot bring the Docker-backed kernel back to a responsive state, SugarPy escalates to a runtime restart and shows a warning banner that previous outputs may be stale.
- The “fresh runtime started” notice is suppressed for the very first execution in a brand new notebook; it is reserved for recovery/reset cases where older outputs could be stale.
- A notebook execution timeout now forces a runtime restart for safety; after that, rerun any setup cells you still need in the live namespace or use `Run All`.
- Idle live runtimes are culled in the background by the Jupyter extension, so abandoned tabs do not need a follow-up runtime request before their containers are removed. The default idle timeout is 30 minutes unless `SUGARPY_RUNTIME_IDLE_TIMEOUT_S` is overridden.
- On the very first browser launch with no restored notebook, SugarPy seeds a one-time `SugarPy Quick Start` notebook with CAS-first examples and lightweight coachmarks.
- The quick-start notebook now calls out the essential controls early: `+` for new blocks, `Shift+Enter` to run the current Code/Math cell, `⋮ > New Notebook` for a blank reset, and long-press drag on touch devices.
- After that first-run seed, later `New Notebook` actions still open empty and show centered `Code | Text | Math` creation controls.
- The same `Code | Text | Math` choices also appear in the header `+` menu and the divider insert menu.
- On desktop, each cell exposes a left-side `+` insert rail with searchable block insertion; it inserts below by default and supports `Alt`/`Option` for above insertion.
- On desktop, the same left rail also exposes a drag handle for reordering. The drag preview shows a ghost card plus a blue insertion bar.
- On touch devices, a long press on the cell shell starts the same reorder flow.
- On wide touch layouts such as iPad, the left drag handle also starts reorder directly on touch/pen input without triggering text selection, while active editors still allow normal text selection/copy.
- Press `Esc` while dragging to cancel and keep the cell in place.
- New cells are inserted below the currently selected cell when created from the header `+` control.
- If focus leaves the notebook, SugarPy keeps the last clicked cell as the insertion anchor with a soft highlight until the user clicks outside again to clear it.
- Math cells collapse into rendered Math cards after execution; tap/click a card to reopen the raw CAS editor.
- Math editor includes a compact shortcut bar for common CAS inserts (`^2`, `sqrt`, `solve`, `expand`, `N`, `plot`).
- The same compact selected-cell action bar is used across desktop and touch layouts.

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
  - The script now always refreshes from the latest `master` first.
  - If a matching `codex/*` branch was already merged earlier, the script deletes that stale branch and recreates it from fresh `master` instead of switching back to old branch state.
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
- Leaves the repo checked out on updated `master` after the merge.
- By default, deletes the merged local/remote `codex/*` work branch so the next task starts clean. Set `KEEP_WORK_BRANCH=1` if you intentionally want to keep it.
- The deployment workflow now expects a self-hosted runner on `seggver` with label `sugarpy-prod`.

## Update code on the demo server
When a change is intended to affect the live demo, do not stop at local edits.
The default production path is:
1. finish work on a branch
2. run `./scripts/release.sh`
3. let the push to `master` trigger GitHub Actions deploy on `seggver`

Use manual deploy commands only as a fallback for emergency/manual roll-forward cases,
or when you intentionally need to deploy branch state that has not been released to `master`.

Fallback manual remote deploy:
```bash
DEPLOY_HOST=seggver \
DEPLOY_USER=sugarpy \
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_PORT=22 \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-remote.sh
```

Fallback local deploy from a self-hosted runner or an interactive shell on `seggver`:
```bash
DEPLOY_PATH=/opt/sugarpy/current \
DEPLOY_JUPYTER_TOKEN=sugarpy \
./scripts/deploy-local.sh
```

After deploy:
- Confirm the frontend is reachable from `http://127.0.0.1:18081/` on the server.
- Confirm Jupyter health from `http://127.0.0.1:8888/jupyter/api/status?token=sugarpy`.
- Confirm the public Cloudflare URL is reachable and report `https://sugarpy.tech/`.
- The public edge serves only `/` and `/api/*`; `/jupyter/` remains internal-only behind the backend runtime.
- Deploys now build into `/opt/sugarpy/releases/<sha>` and then atomically switch `/opt/sugarpy/current`.

## Start backend only
```bash
./scripts/launch.sh
```

## Full verification (recommended before completion)
```bash
./scripts/check all
```

What it covers:
- Frontend install/build/audit.
- Backend tests.
- Full non-assistant notebook E2E by default.
- Runtime-specific gates automatically when runtime-critical files changed.
- Backend pytest suite (`tests/backend/`).
- Playwright E2E suite (`web/e2e/`) excluding assistant-heavy scenarios by default.
- Set `SUGARPY_INCLUDE_ASSISTANT_E2E=1` to include assistant browser scenarios in the same run.
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
