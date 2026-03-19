# Assistant Context Validation Verification

- Change class: runtime-critical assistant sandbox and validation flow
- Impacted runtime or execution paths:
  - assistant sandbox replay context selection
  - isolated validation for code and math draft steps
  - sandbox metadata returned to the assistant and preview UI
  - backend Docker-isolated assistant validation path
- Verification mapping:
  - sandbox replay preset execution and metadata -> `tests/backend/unit/test_server_extension.py`
  - general backend runtime safety/regressions -> `tests/backend/`
  - browser smoke notebook runtime behavior -> `web/e2e/notebook.spec.ts`
  - browser assistant sandbox replay flows -> `web/e2e/notebook.spec.ts`
- Regression tests added or updated:
  - `tests/backend/unit/test_server_extension.py`
- Commands run:
  - `./scripts/check backend`
  - `./scripts/ui-check.sh`
  - `cd web && npx playwright test e2e/notebook.spec.ts --grep "Assistant sandbox"`
