# Verification Manifest

- Change class: runtime-critical notebook insertion-anchor fix for last active cell state
- Impacted runtime or execution paths:
  - `web/src/ui/App.tsx`
  - notebook active-cell state
  - header add-cell insertion flow
- Verification mapping:
  - `web/e2e/notebook.spec.ts` -> browser regression for outside-click active clearing and insertion below last active cell
  - `./scripts/ui-check.sh` -> smoke browser validation
  - `./scripts/test-all.sh` -> full project gate including runtime-specific checks
- Regression tests added:
  - `Notebook chrome: clicking outside the notebook clears the active cell chrome`
  - `Notebook chrome: add menu inserts below the last active cell after outside click`
- Browser verification:
  - `./scripts/ui-check.sh` passed on 2026-03-17
- Recovery paths covered:
  - first outside click clears only active toolbar state
  - second outside click clears remembered insertion anchor
