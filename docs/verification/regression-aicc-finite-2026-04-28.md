# Regression AICc Payload Verification

- Change class: regression-cell runtime payload and UI rendering stability.
- Regression tests added or updated:
  - `tests/backend/unit/test_regression.py` covers two-point linear fits whose AICc is undefined.
- Verification commands:
  - `./.venv/bin/pytest tests/backend/unit/test_regression.py -q`
  - `npm --prefix web run build`
  - `./scripts/ui-check.sh`
- Expected behavior:
  - Regression payloads use `null` for non-finite metrics before frontend delivery.
  - Regression summary and alternatives tolerate missing or legacy invalid numeric values without stopping the notebook render.
