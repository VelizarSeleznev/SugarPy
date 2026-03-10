# Product Guide

## Purpose
SugarPy is a notebook-style teaching tool built on top of a local Jupyter kernel.
It combines:
- Python code execution.
- CAS-style Math cells for SymPy workflows.
- Stoichiometry table cells for chemistry exercises.
- Notebook import/export and recovery flows.
- A lightweight reference wiki for classroom use.

This document is the current product-level source of truth for user-facing features.
Use it together with:
- `docs/RUNBOOK.md` for setup and verification.
- `docs/ARCHITECTURE.md` for runtime boundaries and invariants.
- `docs/MATH_CELL_SPEC.md` for detailed Math cell semantics.

## Product shape

### Main entry points
- Notebook app: `/`
- Static quick-reference wiki: `/wiki`
- Local Jupyter backend in development: `http://localhost:8888`
- Local frontend in development: `http://localhost:5173`

### Cell types
- `Code`: Python editor with kernel execution.
- `Text`: Markdown editor with rendered preview.
- `Math`: CAS-style symbolic editor rendered as a Math card after execution.
- `Stoich`: chemistry stoichiometry table driven by a reaction equation and optional inputs.

## Notebook UI

### Header actions
- Notebook name field.
- `Run All` for all runnable cells from top to bottom.
- `Assistant` button for optional AI-powered notebook editing.
- Connection status pill.
- `⋮` menu for notebook, file, and reference actions.
- Header overlays dismiss on outside click or `Escape`.

### File actions
- `Save to Server`: writes an `.ipynb` file under `notebooks/` and refreshes server autosave.
- `Export PDF`
- `Download .ipynb`
- `Download .sugarpy`
- `Import`
- `New Notebook`

### Connection actions
- Connect to the Jupyter kernel manually if needed.
- Configure custom `Server URL` and `Token`.
- Reconnect behavior is automatic when the kernel drops and the UI can recover.

## Execution model

### Code cells
- Use CodeMirror 6 with Python support.
- `Shift+Enter` runs the cell.
- Execution count is global, Jupyter-style.
- Output renders below the cell.
- MIME-first rendering order:
  - Plotly MIME -> interactive graph.
  - LaTeX MIME -> KaTeX.
  - Plain text -> fallback text.
  - Error -> concise `ename: evalue`.

### Markdown cells
- Edit as Markdown.
- Render on blur.
- Clicking the rendered output returns to editing.

### Math cells
- Use CAS semantics instead of Python semantics.
- `=` means equation.
- `:=` means assignment.
- `^` is supported for powers.
- Implicit multiplication is supported, for example `2x` and `(x+1)(x-1)`.
- Multiple statements can be placed in one Math cell.
- Multi-line statements are supported while parentheses/brackets are open.
- Math cells share namespace with Code cells.
- Functions defined in Code cells can be called from Math cells.

### Math cell display behavior
- After execution, the editor collapses into a rendered Math card.
- Clicking the card reopens the raw CAS editor.
- Simple duplicate source previews are hidden to reduce clutter.
- Multi-statement cells render a symbolic trace with per-line grouping.
- Cell execution is guarded by a hard UI timeout; if the kernel stalls, SugarPy interrupts it and shows an explicit timeout error instead of leaving the cell spinning indefinitely.
- A compact shortcut row supports:
  - `^2`
  - `sqrt(...)`
  - `( )`
  - `=`
  - `:=`
  - `solve(...)`
  - `expand(...)`
  - `factor(...)`
  - `N(...)`
  - `plot(...)`

### Math modes
- Each notebook has defaults for:
  - `Degrees` / `Radians`
  - `Exact` / `Decimal`
- Each Math cell can override those defaults individually.
- Notebook save/import preserves both notebook defaults and per-cell overrides.
- Switching `Exact` / `Decimal` uses cached render payloads when available.
- Switching `Deg` / `Rad` reruns the Math evaluation for that cell.

## Plotting

### Where plotting works
- Code cells can emit Plotly-backed graphs through the startup `plot(...)` helper.
- Math cells can call `plot(...)` directly.

### Plot options
- Preferred in Math cells: `x = a..b`, optionally `y = c..d`.
- `xmin`, `xmax`: initial visible x-range.
- `ymin`, `ymax`: optional initial y-range.
- `equal_axes=True`: preserve 1:1 scale for geometry.
- `showlegend=True|False`: override legend behavior.
- `title='...'`: optional title.

### Plot behavior
- The requested range is treated as the authoritative initial view.
- Plotly autoscale is intentionally disabled.
- Double-click resets back to the initial view.
- For implicit geometry, SugarPy can widen the visible range to preserve equal axes.

## Stoichiometry cells

### Purpose
Stoichiometry cells provide a worksheet-style chemistry table over a balanced reaction.

### Input and output
- Accept reaction input such as `H2 + O2 -> H2O`.
- Accept either `->` or `=`.
- Support common state suffixes like `(aq)`, `(s)`, `(l)`, `(g)`.
- Can preserve and display a LaTeX-like reaction form in the UI.
- Debounced recomputation updates the table after edits.

### Table behavior
- Shows balanced species with coefficients.
- Shows rows for:
  - `m (g)`
  - `M (g/mol)`
  - `n (mol)`
- User can type known values for mass or amount.
- Missing values are auto-computed from the limiting extent when possible.
- Mismatch highlighting appears when provided values are inconsistent.
- Blurring the reaction field can replace the input with the balanced reaction.

## Function library and autocomplete

### Built-in library
- Built-in function metadata is stored in `web/public/functions.json`.
- The same catalog is shipped in Python package data for runtime usage.

### User functions
- User-defined functions are loaded from `~/.sugarpy/user_functions.py`.
- Session-defined Python `def` names are added to autocomplete after execution.

### Autocomplete behavior
- Code cells combine built-in functions and session/user functions.
- Math cells expose a smaller CAS-oriented suggestion list.
- Code cells also support slash-style command discovery from the function catalog.

## AI assistant

### Current behavior
- The assistant is optional and opened from the header `Assistant` button.
- It uses a chat-style drawer with a composer at the bottom.
- It drafts notebook edits from a plain-language request.
- It shows a preview before anything is applied.
- The main chat UI keeps only the core controls visible.
- Assistant settings are collapsed under `Settings`.
- The main assistant flow now defaults to whole-notebook context and `Auto` output mode.
- The drawer keeps the last 5 chats per notebook in browser `localStorage`.
- Creating a new notebook starts with a fresh assistant history.
- Assistant runs are also traced for debugging.
- It supports:
  - `Apply`
  - `Apply and Run`
  - `Undo Last AI Change`
  - `Stop`
  - `New chat`

### Model integration
- Assistant models run directly from the frontend via either the OpenAI Responses API or the Google Generative Language API.
- The UI stores assistant settings in browser `localStorage`.
- The assistant drawer provides preset model choices and also allows a custom model id.
- The model defaults to `gpt-5.1-codex-mini`.
- Assistant settings also expose a `Thinking level` selector.
- SugarPy now normalizes the available `thinkingLevel` options per model family:
  - `GPT-5.1 Codex mini`: `dynamic`, `low`, `medium`, `high`
  - `GPT-5.x / GPT-5 mini / GPT-5 nano`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Flash / Flash-Lite`: `dynamic`, `minimal`, `low`, `medium`, `high`
  - `Gemini 3 Pro`: `dynamic`, `low`, `high`
- Model requests also use a hard per-request timeout so the UI does not wait indefinitely on a hung model call.
- The API key can be pasted into the assistant drawer.
- If `notebooks/sugarpy-assistant-config.json` exists on the connected Jupyter server, the app auto-loads `apiKey` and optional `model` from that runtime file.
- A server-provided shared key is used implicitly and is not copied into the visible settings field.
- The settings input acts as a user override key, not as a mirror of the shared server key.
- Do not commit that config file to git.
- Because the models are still called directly from the browser, a server-provided key is hidden from GitHub history but not from an authenticated browser session. Full key secrecy requires a backend proxy.
- Each assistant run is persisted as a JSON trace under `notebooks/sugarpy-assistant-traces/<notebook-id>/<trace-id>.json`.
- Trace payloads include prompt, model, thinking level, activity timeline, low-level HTTP attempt telemetry, compact summaries of successful model responses (tool calls plus returned text), compact summaries of isolated sandbox executions, final status, error text if any, and a compact notebook context summary.
- On the OpenAI Responses path, trace telemetry now also records stream progress hints so a timeout can say which stream event was last observed before the request stalled.
- On the OpenAI path, final notebook planning now prefers a native function-call submission (`submit_plan`) instead of relying only on a strict JSON text response.
- Recommended models:
  - `gpt-5.1-codex-mini`: default OpenAI path for notebook editing.
  - `gpt-5-mini`: smaller GPT-5 option.
  - `gpt-5-nano`: cheapest GPT-5 option.
  - `gemini-3.1-flash-lite-preview`: Gemini fallback.
- Manual evaluation prompts live in `docs/LLM_EVAL.md`.
- Browser-side assistant regression coverage lives in `web/e2e/notebook.spec.ts`.
- The current regression suite covers:
  - OpenAI Responses payload contract
  - seeded whole-notebook manifest capture
  - `deg` notebook defaults flowing into planning
  - recent-error tool-output flow
  - preview/apply-run assistant flow

### Safety model
- The assistant reads notebook context through a constrained inspection tool loop.
- For Python code-cell drafts, the assistant may also run an isolated self-check in a temporary kernel before the preview is shown.
- The isolated self-check never mutates the live notebook and defaults to a 5-second `bootstrap-only` sandbox run.
- Sandbox context is explicit rather than implicit. The supported presets are:
  - `none`
  - `bootstrap-only`
  - `imports-only`
  - `selected-cells`
  - `full-notebook-replay`
- It returns a structured change set instead of mutating notebook state directly.
- The app applies the proposed operations locally and keeps an undo snapshot for rollback.
- The assistant is instructed to prefer SugarPy-native, directly executable representations over mathematically equivalent but less compatible forms.
  Example: for geometry plotting, prefer implicit equations plus `plot(...)` over parametric helper functions unless the user explicitly asks for parametric form.
- In the default `Auto` mode, the assistant now behaves CAS-first by default.
  - For math, symbolic manipulation, equations, and graphing, it should prefer Math cells.
  - It should use Code cells mainly for non-math tasks, clearly unsupported CAS workflows, or explicit Python requests.
- `CAS-first` strengthens that preference and tells the assistant to favor Math cells and CAS-native syntax over Python when both are possible.
- The assistant is also instructed to respect SugarPy `Deg/Rad` behavior and avoid trig-dependent notebook edits when a trig-free representation is available.
- The assistant is instructed to distinguish plain assignments like `f := x^2 + 1` from callable function definitions like `f(x) := x^2 + 1`.
- Follow-up messages in the same chat reuse a compact conversation history so the assistant can refine the previous proposal instead of starting from zero each time.
- While the assistant is working, the drawer shows live progress with inspection/tool activity plus a running `Thinking ... Ns` indicator even before the first tool result comes back.
- Validation activity also reports sandbox steps such as `Running isolated check`, `Replaying imports`, and `Timed out after 5s`.

## Persistence and recovery

### Notebook formats
- Native SugarPy format: `.sugarpy`
- Legacy import support: `.sugarpy.json`
- Standard notebook format: `.ipynb`

### Autosave layers
- Lightweight local autosave in browser `localStorage` for notebook structure and cell source/state.
- SugarPy retains only the current local notebook snapshot and prunes older local notebook autosaves.
- Server autosave in `notebooks/sugarpy-autosave/<notebook-id>.sugarpy`.

### Restore policy
- On startup, SugarPy restores the newer snapshot between local and server autosave.
- Autosave is refreshed during editing and on browser lifecycle events.
- Local autosave intentionally skips heavy runtime outputs so large plots do not exceed browser quota.
- If browser storage is full or unavailable, SugarPy continues without local autosave and relies on server autosave.

### Serialization details
- `.sugarpy` preserves SugarPy-specific cell types and state directly.
- `.ipynb` stores SugarPy cell metadata in notebook/cell metadata so Math and Stoich cells can round-trip.

## Mobile and touch behavior
- Touch editing is supported.
- On touch devices, cell actions can be exposed via swipe interactions.
- On phone portrait with the keyboard open, a fixed mobile action bar appears for the active cell.
- The mobile bar can include:
  - Run
  - Math mode toggles
  - Move up
  - Move down
  - Delete

## Wiki page
- `/wiki` is a static reference page with no kernel dependency.
- It focuses on classroom-friendly Math and plotting reminders.
- It is intentionally narrower than the full notebook product and should not be treated as full product documentation.

## Current limitations
- Math cells are not full Python and do not support arbitrary `def` blocks.
- Plot behavior is optimized for stable classroom views rather than full dynamic resampling.
- The wiki is incomplete relative to the full app.
- Product documentation outside this file is still being normalized.

## LLM Assistant Proposal

### Product goal
Add an optional AI assistant that can translate plain-language intent into notebook edits without making the core notebook experience feel AI-first.

### Non-goals
- Do not force AI into the default notebook flow.
- Do not let the model write directly into notebook state without a reversible transaction.
- Do not rely on free-form text diffs against the notebook DOM.

### UX principles
- AI must be opt-in.
- AI actions must be previewable.
- Every AI edit must be undoable.
- The notebook must remain fully usable with AI disabled.
- The assistant must operate on notebook primitives, not arbitrary text blobs.

### Recommended rollout shape

#### 1. Opt-in assistant surface
- Add an `Assistant` button in the header or `⋮` menu.
- Keep it collapsed by default.
- Allow workspace-level setting:
  - `Off`
  - `Ask before applying`
  - `Enabled`
- Make the value easy to change so users never feel trapped in an AI workflow.

#### 2. Safe task scope
Start with narrow high-value jobs:
- Create a new notebook from a plain-language prompt.
- Insert a Code, Math, Text, or Stoich cell at a chosen position.
- Rewrite a selected cell.
- Explain an error and propose a fix.
- Generate a worked symbolic example.
- Convert a plain chemistry exercise into a Stoich cell plus explanation.

Avoid early support for broad autonomous notebook rewrites.

### Model strategy
- Use a cheap fast model for intent parsing and simple drafting, such as Gemini Flash / Flash-Lite class models.
- Keep the option to swap providers behind one backend adapter.
- Use a stronger model only as an explicit fallback for harder tasks.

Recommended split:
- `intent model`: small/cheap, always-on candidate.
- `repair/escalation model`: optional, invoked only when the first pass fails validation.

### Why an MCP-like tool layer is the right shape
The model should not emit raw notebook JSON or patch the React state directly.
Instead, give it a constrained notebook tool API.

Recommended tool surface:
- `get_notebook_summary()`
- `list_cells()`
- `get_cell(cell_id)`
- `insert_cell(index, type, source, metadata?)`
- `update_cell(cell_id, source?, metadata?)`
- `move_cell(cell_id, target_index)`
- `delete_cell(cell_id)`
- `set_notebook_defaults(trig_mode?, render_mode?)`
- `run_cell(cell_id)`
- `run_cells(cell_ids[])`
- `get_last_error(cell_id?)`
- `create_change_set(title)`
- `append_change(change_set_id, operation)`
- `preview_change_set(change_set_id)`
- `apply_change_set(change_set_id)`
- `rollback_change_set(change_set_id)`

This gives three important properties:
- The assistant edits stable notebook primitives.
- The UI can show a human-readable preview before apply.
- Undo/redo can be built on the same change-set model.

### Change application model

#### Proposed unit: change set
Every assistant action should produce a change set instead of directly mutating notebook state.

Each change set should contain:
- intent summary
- targeted cells
- ordered operations
- generated sources
- validation results
- execution results, if run

#### Apply flow
1. User writes a plain-language request.
2. Model reads notebook summary and relevant cells.
3. Model produces structured operations.
4. UI renders a preview:
   - cells to add
   - cells to edit
   - cells to delete or move
5. User chooses:
   - `Apply`
   - `Apply and Run`
   - `Discard`
6. The applied change set is pushed onto an undo stack.

#### Undo / rollback
- Keep a full notebook snapshot before apply.
- Also keep the structured change set.
- Support:
  - one-click `Undo AI change`
  - session-level `History`
  - diff-like preview between pre-change and post-change notebook states

This is the minimum needed so users do not feel that AI can quietly ruin a worksheet.

### Validation strategy
Before an AI change is offered to the user:
- Validate notebook operations structurally.
- Validate cell types and metadata.
- Reject invalid Math defaults and invalid cell references.

After apply, optionally run lightweight checks:
- syntax sanity for Code cells
- parser sanity for Math cells
- reaction parse sanity for Stoich cells

If validation fails:
- show a repair suggestion
- do not silently apply partial notebook corruption

### UI proposal

#### Minimal first version
- Right-side assistant drawer.
- Input box for natural-language requests.
- Context chips:
  - `Whole notebook`
  - `Selected cell`
  - `Selection + neighbors`
- Preview panel listing proposed changes.
- Buttons:
  - `Apply`
  - `Apply and Run`
  - `Undo`

#### Important anti-annoyance details
- No auto-popup on first load.
- No assistant watermark inside every cell.
- No background generations while typing unless explicitly enabled.
- Do not inject chat transcript into notebook content by default.

### Documentation strategy for the assistant
Current documentation is too fragmented to serve as reliable model context.
Before shipping AI editing, create a compact docs pipeline:

#### 1. One canonical product doc
- `docs/PRODUCT_GUIDE.md` for user-facing feature truth.

#### 2. Stable machine-readable specs
Add narrow JSON or Markdown specs for:
- cell types and metadata
- notebook serialization contract
- Math cell constraints
- Stoich cell payload shape
- assistant tool contract

Suggested files:
- `docs/specs/notebook_schema.md`
- `docs/specs/assistant_tools.md`
- `docs/specs/stoich_contract.md`

#### 3. Curated retrieval context
When the assistant runs, feed only:
- product guide summary
- notebook schema
- math spec excerpt
- current notebook summary
- selected cells

Do not dump the whole repo into model context.

### Recommended implementation phases

#### Phase 0: Documentation and contracts
- Consolidate feature docs.
- Freeze notebook operation primitives.
- Document serialization and cell metadata.

#### Phase 1: Local no-LLM command layer
- Implement structured notebook operations in the frontend/backend boundary.
- Add change sets, preview, apply, rollback, and undo.
- This de-risks the architecture before any model call.

#### Phase 2: AI draft mode
- Add assistant drawer.
- Let the model propose operations only.
- User must confirm before apply.

#### Phase 3: AI apply-and-run mode
- Add optional execution after apply.
- Capture outputs/errors back into the assistant panel.

#### Phase 4: Smart repair
- If a generated cell fails, let the assistant propose a revised change set instead of editing live state blindly.

### Recommendation
The best version of AI for SugarPy is not a chat bot glued onto the UI.
It is a small, optional notebook operator that:
- understands plain-language intent,
- edits cells through constrained tools,
- previews every change,
- and can always roll back cleanly.

That keeps the product useful for people who want direct control, while making the “just tell it what to do” workflow genuinely faster for the people who want it.
