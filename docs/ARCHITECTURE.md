# Architecture

## System shape
- Frontend (`web/`) is a React + Vite app.
- Backend runtime is a local Jupyter Server launched from `scripts/launch.sh`.
- Python domain logic lives in `src/sugarpy/`.
- Restricted backend API and execution/storage enforcement live in `src/sugarpy/server_extension.py`.
- Assistant orchestration for model calls and structured notebook edits lives in `web/src/ui/utils/assistant.ts`.
  - OpenAI Responses requests use a stream-activity timeout: new SSE chunks reset the timer, but stalled streams are aborted.
- Shared assistant keys can be held server-side by the Jupyter extension in `src/sugarpy/server_extension.py`.
  - The frontend only learns provider availability and default model, not the server key value.
  - Assistant provider requests are proxied through SugarPy-owned backend routes instead of browser-to-provider direct calls when shared keys are configured.
  - Gemini uses the Google Generative Language API directly.
  - The experimental Groq path uses an OpenAI-compatible chat-completions adapter so it can be compared without changing the main OpenAI Responses flow.
- Assistant sandbox execution for isolated self-checks lives in `web/src/ui/utils/assistantSandbox.ts`.
  - Assistant plans are teaching-first: a short outline is shown in chat and then turned into a staged draft preview.
  - Runnable assistant draft steps are validated in isolation before the user can accept them.
  - The live notebook is not mutated until an explicit accept action applies the chosen draft steps.
- The frontend talks only to SugarPy-owned `/api/*` endpoints.
- The browser no longer uses Jupyter `ContentsManager` or browser-managed kernels for notebook execution/persistence.
- Frontend has two page entrypoints:
  - `/` for the notebook app (restricted backend runtime).
  - `/wiki` for the standalone documentation page (no kernel dependency).

## Runtime boundaries
- UI and backend API communicate over same-origin `/api/*`.
- Jupyter remains an internal runtime component behind the SugarPy API.
- Dev scripts pin Jupyter to:
  - Port: `8888`
  - Allowed origin: `http://localhost:5173`
- Startup hook imports from `sugarpy.startup` via `.ipython/profile_default/startup/00-sugarpy.py`.
- `sugarpy.startup` preloads `from sympy import *`, `numpy as np`, defines `x, y, z, t`,
  enables `init_printing()`, and provides a custom `plot()` that emits
  `application/vnd.plotly.v1+json` to frontend MIME output.
- Notebook execution is backend-owned and stateful per notebook.
  - Each notebook uses a backend-managed runtime session.
  - The default restricted deployment target is a Docker-backed runtime container with a per-notebook writable workspace and a readonly app mount.
  - Docker-backed runtimes are started with the same uid/gid as the host Jupyter service so workspace artifacts such as `kernel-connection.json` remain readable and removable by the backend.
  - Notebook Code/Math/Stoich execution reuses the same live kernel namespace until the runtime is restarted, deleted, or cleaned up for idleness.
  - Notebook execution timeouts are expressed in milliseconds at the API boundary and converted to seconds inside the backend executor.
  - If a live notebook execution times out, SugarPy treats that runtime as unsafe, restarts it, and returns an explicit timeout-recovery error so the next run starts from a clean kernel.
  - When a notebook gets a brand-new runtime after a cold start/crash/idle cleanup, SugarPy replays earlier runnable Code/Math cells once before the requested target cell so execution still follows notebook order.
  - If runtime recovery finds a live container but cannot attach to its connection file, SugarPy treats that runtime as broken and recreates it instead of surfacing a generic backend error.
  - Runtime control is exposed through SugarPy-owned API routes for status, interrupt, restart, and delete; the UI uses those routes instead of talking to kernels directly.
  - Docker-backed live runtimes isolate notebook execution from the server process and filesystem. If SugarPy falls back to an in-process runtime, restricted profiles still statically reject blocked Python imports/calls such as `os`, `subprocess`, `open`, and related shell/file escape paths.
- The assistant sandbox remains a separate backend-owned ephemeral execution path.
- Math cell evaluation pipeline:
  - `sugarpy.math_parser.parse_math_input` classifies input as expression/equation/assignment.
  - `sugarpy.math_parser.parse_sympy_expression` parses CAS input with `^` and implicit multiplication.
  - `sugarpy.math_cell.render_math_cell` evaluates with shared `ip.user_ns` namespace and returns normalized output payload (`kind`, `steps`, `value`, `error`).
  - `sugarpy.math_cell.display_math_cell` emits structured frontend payload via
    `application/vnd.sugarpy.math+json` (`display_data` channel).
  - `sugarpy.stoichiometry.display_stoichiometry` emits structured frontend payload via
    `application/vnd.sugarpy.stoich+json` (`display_data` channel).

## Data and catalogs
- Built-in function catalog: `web/public/functions.json`.
- User function extensions: `~/.sugarpy/user_functions.py`.
- `scripts/sync-functions.sh` keeps function definitions synchronized for runtime use.

## Invariants
- `./scripts/check all` is the primary project verification entrypoint.
- `./scripts/test-all.sh` is a compatibility wrapper around `./scripts/check all`.
- `./scripts/check all` gate order is: runtime-specific checks when required -> backend pytest -> frontend build/audit -> Playwright E2E.
- Default `./scripts/test-all.sh` runs the non-assistant E2E suite; set `SUGARPY_INCLUDE_ASSISTANT_E2E=1` to include assistant-heavy browser scenarios.
- Runtime-critical changes automatically trigger `./scripts/check runtime` during the full gate.
- UI changes must be validated by `./scripts/ui-check.sh` (or by `./scripts/test-all.sh`).
- Assistant changes should also be checked against the targeted browser suite in `web/e2e/notebook.spec.ts` when model payloads or notebook-context assembly change.
- Assistant sandbox invariants:
  - `run_code_in_sandbox` may execute Python or Math-cell validation only through backend-owned ephemeral kernels, never through shell access.
  - Default sandbox mode is `bootstrap-only` with a hard 5-second timeout.
  - Context replay is explicit via presets: `none`, `bootstrap-only`, `imports-only`, `selected-cells`, `full-notebook-replay`.
  - Sandbox execution must not mutate notebook state, outputs, autosave, or any shared live kernel namespace.
  - Draft state is chat-owned and separate from the live notebook state used for autosave, save, and export.
- CAS UI behavior for code cells is MIME-first:
  - `application/vnd.plotly.v1+json` -> interactive Plotly render.
  - `text/latex` -> KaTeX render (after stripping SymPy wrappers).
  - `text/plain` -> plain text fallback.
  - `error` -> concise `ename: evalue` output.
  - A trailing top-level `print(...)` call is treated as stdout-only and does not also render its `None` return value as the final expression output.
  - Backend execution truncates long stream text and large MIME payloads before returning them so pathological prints/plots do not grow unbounded in a single response.
- Math/Stoich transport contract is MIME-first (no stdout marker parsing):
  - `application/vnd.sugarpy.math+json` -> `cell.mathOutput`.
  - `application/vnd.sugarpy.stoich+json` -> `cell.stoichOutput`.
- Behavior/architecture changes must include matching updates in `docs/`.
- Keep project language in English across code, UI text, docs, tests, and logs.
- Math cell semantics are fixed:
  - `=` means equation.
  - `:=` means assignment.
