# Runtime Docker-Only / No-Replay Verification

- Change class: runtime-critical assistant/runtime hardening
- Impacted runtime or execution paths:
  - live notebook cold-start behavior
  - restricted runtime backend selection
  - assistant sandbox isolation path
  - timeout recovery messaging and fresh-runtime signaling
- Verification mapping:
  - runtime backend selection and unavailable reporting -> `tests/backend/unit/test_runtime_manager.py`
  - live execution fresh-runtime / no-replay behavior -> `tests/backend/unit/test_server_extension.py`
  - runtime reliability after timeout / restart / delete -> `tests/backend/integration/test_runtime_reliability.py`
  - runtime-control browser flows -> `web/e2e/runtime-controls.spec.ts`
- Regression tests added or updated:
  - `tests/backend/unit/test_runtime_manager.py`
  - `tests/backend/unit/test_server_extension.py`
  - `tests/backend/integration/test_runtime_reliability.py`
- Commands run:
  - `./scripts/check runtime`
