# Testing Principles

## Purpose
Keep tests reliable, fast enough for daily use, and representative of real user flows.

## Single gatekeeper
- `./scripts/test-all.sh` is the required project gate.
- Gate order is fixed:
  1. Frontend build
  2. Backend pytest
  3. Playwright E2E

## Test pyramid for this project
- Backend unit tests:
  - Parser and pure logic contracts.
  - Deterministic and fast.
- Backend integration tests:
  - Namespace/session behavior and kernel-style interactions.
  - Must perform cleanup/teardown.
- Playwright E2E:
  - Critical notebook flows and regression checks.
  - No screenshot-based assertions.

## Determinism rules
- No random assertions without fixed seeds.
- Avoid timing races; use explicit waits on stable `data-testid` selectors.
- Avoid selectors coupled to visual/CSS implementation details.
- Integration tests must not leak shared state across tests.

## Failure policy
- Any failing check blocks completion.
- Unexpected `console.error` or `pageerror` in E2E is a test failure.
- `xfail(strict=True)` may be used only for explicit future specs; XPASS must fail the run.

## Test maintenance rules
- Behavior changes require test updates in the same change set.
- New user-facing behavior must include at least one automated test:
  - backend test for logic, and/or
  - e2e test for visible flow.
- Keep tests readable; prefer explicit expected values over vague truthy checks.

## Regression targets (large assignments)
Large, multi-step “assignment-style” workflows must be covered by at least one automated regression test.
Preferred approach:
- Keep a representative demo notebook under `notebooks/`.
- Add a backend integration test that executes the notebook’s Math cells end-to-end and asserts:
  - CAS trace is present (readability contract),
  - numeric confirmation (`N(...)`) yields decimals,
  - plot statements return a Plotly figure object.

Current regression example:
- `notebooks/CircleIntersections_CAS.sugarpy` (covered by `tests/backend/integration/test_notebook_examples.py`).

## Manual visual QA (Pinchtab)
Pinchtab is used for manual visual verification after UI/rendering changes.
Automation remains Playwright-first.

Required manual checklist:
- LaTeX: long fractions, roots, and brackets are not clipped.
- LaTeX: alignment and wrapping keep layout readable.
- Plotly: graph stays inside container and resizes correctly.
- Zoom/scroll interactions do not break notebook layout.
- Error rendering shows cell-level error UI while app remains responsive.
