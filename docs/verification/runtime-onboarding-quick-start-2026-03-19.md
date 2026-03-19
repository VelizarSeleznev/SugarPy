# Runtime Verification: onboarding quick-start refinement

- Date: 2026-03-19
- Change class: runtime-adjacent notebook onboarding UX
- Branch: `codex/first-run-cas-intro`
- Commits:
  - `6f43cae` Add first-run CAS onboarding notebook
  - `ccad7d4` Refine onboarding controls and coachmarks

## What changed
- Added a one-time frontend-seeded `SugarPy Quick Start` notebook for first-run users.
- Added coachmarks for `+`, `⋮`, drag/reorder, and rendered Math-card reopening.
- Moved critical control explanations into the first onboarding cells:
  - `Shift+Enter` to run the current Code/Math cell
  - `⋮ > New Notebook` for a blank notebook
  - touch long-press drag for mobile reorder
- Replaced the trig-sensitive onboarding plot with a degree/radian-neutral parabola plot.

## Verification run
- `bash -lc "cd '/Users/velizard/PycharmProjects/Gymnasium/SugarPy/web' && npm ci && npm run build"`
- `PLAYWRIGHT_REUSE_EXISTING=1 ./scripts/ui-check.sh`
- `bash -lc "cd '/Users/velizard/PycharmProjects/Gymnasium/SugarPy/web' && npm ci && PLAYWRIGHT_REUSE_EXISTING=1 npm run test:e2e -- --grep 'Notebook first-run onboarding'"`

## Browser result
- Chromium smoke UI passed.
- All first-run onboarding browser scenarios passed:
  - intro notebook is seeded on first launch
  - onboarding is skipped after being seen
  - existing stored notebook restore wins over onboarding
  - rendered Math-card coachmark appears after running the intro Math cell
  - touch/iPad onboarding remains visible and dismissible

## Notes
- Direct ad hoc `npm run test:e2e` invocations were inconsistent unless run through the same shell style as the project scripts; the successful verification commands above reflect the working invocation.
