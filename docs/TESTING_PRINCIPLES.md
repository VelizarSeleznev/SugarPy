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

## Coverage matrix requirement
Before implementation, list all impacted user paths and explicitly map each path to a verification method.

Required path categories:
- Happy path.
- Alternative path(s).
- Error/recovery path(s) (for example reconnect/retry/cancel).
- Empty-state path(s).
- Mobile-specific path(s) when UI behavior differs from desktop.

Required mapping format:
- `path -> auto test` (preferred), or
- `path -> manual check` (only when automation is impractical).

Work is not complete until every impacted path is mapped and verified.

## Regression gate for UI and flow refactors
For UI or execution-flow changes, completion requires all of:
- Frontend build success.
- Targeted E2E coverage for changed paths.
- Project smoke/full gate (`./scripts/ui-check.sh` or `./scripts/test-all.sh`).
- Browser result report (including console/page errors status).

## Assistant and LLM validation
For assistant, agent, streaming, or model-integration changes, mocked tests are necessary but not sufficient.

Required completion rules:
- Keep mocked/unit/integration coverage for deterministic regression protection.
- Run a real browser notebook flow at the end of the task when runtime credentials and services are available.
- The real run must exercise the changed assistant path with a live model response, not mocked network fixtures.
- Do not treat build success, mocked Playwright success, or trace-shape checks as proof that live assistant behavior works.
- Report the result of the live run separately from mocked test results.

If the live run fails:
- Inspect the latest assistant trace and identify the actual failure stage.
- Report whether the failure happened before response creation, during streaming, during tool/function-call generation, during sandbox execution, or during preview/apply.
- Do not claim the assistant flow is fixed if only mocked coverage passes.

## Refactor safety checks (dangling references)
After removing or renaming state/props/handlers/selectors:
- Search for stale references (`rg`) and resolve all unintended matches.
- Update affected tests/selectors in the same change.
- Do not rely on runtime discovery of missing symbols.

## Bug-to-test rule
Every production bug must produce a regression test:
- First add a failing/representative test for the reproduced scenario.
- Then implement the fix.
- Keep the test to prevent recurrence.

For assistant/runtime bugs, pair that regression test with a final live-browser verification when possible.

## Context discipline for contributors and agents
When working in this repository, keep testing policy in active context:
- Read `docs/TESTING_PRINCIPLES.md` before significant UI/flow edits.
- If a required guideline is missing from context or docs, add it as part of the same change.
- Do not mark work complete if coverage mapping or regression gate evidence is missing.

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
