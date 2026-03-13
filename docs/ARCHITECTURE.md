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
- Notebook execution is ephemeral and backend-owned.
  - Each execute request starts from a fresh server-side kernel, replays earlier runnable notebook cells, runs the target cell, and shuts the kernel down.
  - Restricted profiles statically reject blocked Python imports/calls such as `os`, `subprocess`, `open`, and related shell/file escape paths.
- The assistant sandbox uses the same backend-owned isolated execution path.
- Math cell evaluation pipeline:
  - `sugarpy.math_parser.parse_math_input` classifies input as expression/equation/assignment.
  - `sugarpy.math_parser.parse_sympy_expression` parses CAS input with `^` and implicit multiplication.
  - `sugarpy.math_cell.render_math_cell` evaluates with shared `ip.user_ns` namespace and returns normalized output payload (`kind`, `steps`, `value`, `error`).
  - `sugarpy.math_cell.display_math_cell` emits structured frontend payload via
    `application/vnd.sugarpy.math+json` (`display_data` channel).
  - `sugarpy.stoichiometry.display_stoichiometry` emits structured frontend payload via
    `application/vnd.sugarpy.stoich+json` (`display_data` channel).
  - Template-driven custom cells emit structured frontend payload via
    `application/vnd.sugarpy.custom+json` (`display_data` channel).

## Data and catalogs
- Built-in function catalog: `web/public/functions.json`.
- User function extensions: `~/.sugarpy/user_functions.py`.
- `scripts/sync-functions.sh` keeps function definitions synchronized for runtime use.

## Invariants
- `./scripts/test-all.sh` is the primary project verification entrypoint.
- `./scripts/test-all.sh` gate order is: frontend build -> backend pytest -> Playwright E2E.
- Default `./scripts/test-all.sh` runs the non-assistant E2E suite; set `SUGARPY_INCLUDE_ASSISTANT_E2E=1` to include assistant-heavy browser scenarios.
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
  - `text/plain` -> plain text fallback, including merged `stdout` for print-only runs.
  - `error` -> concise `ename: evalue` output.
- Math/Stoich/Custom transport contract is MIME-first (no stdout marker parsing):
  - `application/vnd.sugarpy.math+json` -> `cell.mathOutput`.
  - `application/vnd.sugarpy.stoich+json` -> `cell.stoichOutput`.
  - `application/vnd.sugarpy.custom+json` -> `cell.customCell.output`.
- Behavior/architecture changes must include matching updates in `docs/`.
- Keep project language in English across code, UI text, docs, tests, and logs.
- Math cell semantics are fixed:
  - `=` means equation.
  - `:=` means assignment.
