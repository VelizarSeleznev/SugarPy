# AGENTS.md

## Project overview
SugarPy is a student-friendly notebook experience with a custom web UI (React + Vite) connected to a local Jupyter Server kernel, plus a small Python package that provides math/chemistry helpers (including a reaction balancer) and a function catalog.

## How to run (one terminal)
- `./scripts/run-all.sh`
  - Starts the Jupyter Server backend and the web UI dev server in the same terminal.

## How to test (run all checks)
- `./scripts/test-all.sh`
  - Python: installs deps (if needed) and runs smoke tests for the chemistry balancer and catalog loader.
  - Frontend: installs npm deps, builds the web app, and runs `npm audit`.
  - UI: runs a headless browser check via `agent-browser` to ensure no console errors on load.

## Test commands (manual)
- Python deps: `source .venv/bin/activate && pip install -e ".[lab]"`
- Python smoke: `python - <<'PY' ... PY`
- Frontend deps: `cd web && npm install`
- Frontend build: `cd web && npm run build`
- Frontend audit: `cd web && npm audit --audit-level=moderate`

## Notes
- `scripts/launch.sh` runs a Jupyter Server with a fixed token (`sugarpy`) and CORS enabled for `http://localhost:5173`.
- User functions are stored in `~/.sugarpy/user_functions.py` and auto-loaded on kernel startup.
- **UI verification**: for any UI change, always check placement/visuals in the browser using `agent-browser` and report the result (screenshot or observation) before declaring work complete.
- **Quality gate**: before declaring work complete, run the maximum practical test set for this repo (including `./scripts/test-all.sh`), and do not claim completion if any errors remain in the UI or logs. Prefer spending extra time to ensure all parts work together.

## Language policy
- Default language is English.
- Do not mix languages in the project (code, UI, docs, tests, logs).
- If another language is introduced, it must be a full, end-to-end translation offered via a language selector; otherwise remove it or convert it to English.

## UI density
- Default UI is compact.
- Remove redundant titles/subtitles in cells and panels.
- Use placeholders instead of helper text.
- No default sample content in inputs.
- Extra explanations go into Markdown cells, not component chrome.
