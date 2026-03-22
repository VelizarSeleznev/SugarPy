# Maple Export

## Purpose
SugarPy can export a normalized `.sugarpy` notebook to a narrow Maple worksheet `.mw` XML document.

This export is backend-owned:
- the frontend sends the current normalized SugarPy notebook payload,
- the Python backend translates it to a small Maple IR,
- the backend renders XML and returns a downloadable `.mw` attachment.

## MVP scope
The Maple exporter is intentionally narrow.

Supported first-class inputs:
- `markdown`
- `math`

Fallback-only inputs:
- `code`
- `stoich`
- `regression`

Fallback policy:
- unsupported SugarPy cells are not dropped
- unsupported cells become warning text plus plain text content when possible
- unsafe Math-cell syntax also degrades to warning/text instead of guessed Maple code

## Translation rules
Markdown mapping:
- `# Heading` -> Maple title block
- `## Heading` and `### Heading` -> Maple section block
- remaining Markdown paragraphs -> plain text block

Math mapping:
- SugarPy uses `mathOutput.normalized_source` when available
- if a Math cell has not been executed yet, the exporter also runs SugarPy's parser normalization before mapping to Maple input
- safe direct expressions/equations and a small helper subset become Maple input cells
- simple assignments `name := expr` and function assignments `f(x) := expr` are also exported as Maple input
- supported helper rewrite examples:
  - `integrate(...)` -> `int(...)`
  - `N(...)` -> `evalf(...)`
- exporter normalization also covers common SugarPy surface syntax such as:
  - implicit multiplication like `2g` -> `2*g`
  - power normalization like `x^2`
  - basic plot range normalization already understood by SugarPy parser
- unsupported helpers such as `render_decimal(...)`, `render_exact(...)`, `set_decimal_places(...)`, `subs(...)`, `Eq(...)`, and `linsolve(...)` stay as warning/text in MVP
- complex assignment forms such as unpack assignment still stay as warning/text in MVP

## Architecture
Backend implementation lives under `src/sugarpy/maple_export/`:
- `models.py`: IR dataclasses
- `translate.py`: deterministic SugarPy-to-IR mapping
- `render_mw.py`: deterministic XML renderer

API entrypoint:
- `POST /api/export/maple`

UI entrypoint:
- notebook menu action `Export Maple (.mw)`

## Validation
Current validation layers:
- backend unit tests for translation, fallback rules, and XML well-formedness
- golden-style fixture coverage for representative `.sugarpy` inputs and expected `.mw`
- browser export flow coverage through Playwright

Out of scope for this version:
- reverse import from `.mw`
- full Maple worksheet compatibility
- embedded plot objects
- 2-D math layout
- best-effort conversion for stoich/regression/custom widgets
