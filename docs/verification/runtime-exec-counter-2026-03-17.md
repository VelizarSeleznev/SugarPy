# Runtime Execution Counter Verification

- Change class: runtime-visible notebook execution-counter fix
- Impacted runtime or execution paths:
  - `web/src/ui/App.tsx`
  - `web/e2e/notebook.spec.ts`
- Verification mapping:
  - `web/src/ui/App.tsx` -> `web/e2e/notebook.spec.ts`
- Regression tests added:
  - `Notebook chrome: New Notebook resets execution numbering instead of reusing the last notebook count`
- Browser verification:
  - Covered by the non-assistant Playwright notebook suite during release
- Recovery paths covered:
  - Loading a notebook restores its highest existing execution count
  - Creating a fresh notebook resets the gutter counter instead of reusing the previous notebook's value
