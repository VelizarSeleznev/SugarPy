# SugarPy (Student MVP)

A minimal, student-friendly Jupyter toolkit with:
- A **Function Builder** widget for quick math functions.
- A **Chemistry Balancer** widget to balance reaction equations.

## Quick start

```bash
# Requires uv (https://astral.sh/uv)
UV_PROJECT_ENVIRONMENT=.venv uv sync --extra lab --frozen
source .venv/bin/activate
```

Run Jupyter server (kernel backend):

```bash
./scripts/launch.sh
```

Open the custom UI (frontend):

```bash
cd web
npm install
npm run dev
```

Then open `http://localhost:5173` and click **Connect Kernel**.

Or run everything at once:

```bash
./scripts/run-all.sh
```

Run full checks (includes UI console checks):

```bash
./scripts/test-all.sh
```

`./scripts/test-all.sh` uses `uv` for Python deps and `npm ci` for the web app.

UI checks use `agent-browser` in headless mode by default.

## Current UI/UX behavior (for future context)
- Code cells use CodeMirror 6 (Python). Shift+Enter runs the cell; Tab indents; Enter accepts autocomplete.
- Execution counter is global (Jupyter-like). Indicator appears in the left gutter as `[n]` and `[*]` while running.
- Output renders below the code cell.
- Markdown cells render on blur; click to edit. Shift+Enter (or Render button) toggles to rendered view.
- Insert controls appear on hover above/below each cell (“+ Code / + Text”).
- Cell menu (top-right) supports move up/down and delete.
- Function autocomplete combines library functions + any `def` executed in the session.
- Library functions are auto-loaded into the kernel on connect (no import needed).

## Function Library
- Built-in function list: `web/public/functions.json`
- Add your own functions to `~/.sugarpy/user_functions.py` (auto-loaded on startup).

## Example usage

```python
from sugarpy.chem import balance_equation
balance_equation("H2 + O2 -> H2O")
```

## Notes
- The chemistry parser supports common formulas with parentheses.
- The frontend reads `web/public/functions.json` for the function list.
