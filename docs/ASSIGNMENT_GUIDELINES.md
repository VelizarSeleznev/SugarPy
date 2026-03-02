# Assignment Authoring Guidelines (SugarPy)

This document defines how larger, multi-step tasks should look in SugarPy notebooks so that:
- students can follow what was done and why,
- teachers can keep solutions compact (few cells),
- CAS-first workflows remain reproducible and testable.

Project language rule: keep notebook text and docs in English. If the task statement is not English,
include it as a quoted block.

## Goals
A well-authored “big task” notebook should:
- use Math cells as the primary CAS interface (not Python glue),
- keep related steps grouped in 1-2 Math cells,
- show *what command ran* and *what output it produced* (CAS trace),
- include a numeric check (`N(...)`) and a visual confirmation (`plot(...)`) when applicable.

## Recommended structure (template)
1. Markdown cell
- Title
- Task statement (quoted)
- What the notebook will produce (symbolic answer, numeric approximation, plot)

2. Math cell: symbolic work (grouped)
- Define expressions using `:=`.
- Use CAS helpers (`expand`, `solve`, `simplify`, `factor`) instead of hand expansion.
- End the cell with the main symbolic result expression so it renders.

3. Math cell: numeric + plot (grouped)
- Convert symbolic results to decimals via `N(...)`.
- Plot the relevant objects as a sanity check.

Keep the total number of “solution” Math cells small. Prefer 2 Math cells for:
- (1) symbolic derivation
- (2) numeric confirmation + plot

## Math cell conventions
### Use assignments for intermediate results
Use `:=` for assignment and keep names descriptive:
- `c1 := ...`
- `c2 := ...`
- `line := expand(c2 - c1)`
- `sol := solve((c1, c2), (x, y))`

### Prefer “expression = 0” style solves
In SymPy, `solve(expr, x)` means solve `expr = 0` for `x`.
This avoids requiring `Eq(...)` in most workflows.

Examples:
- `solve(x^2 - 2, x)`
- `solve((c1, c2), (x, y))` where `c1` and `c2` are already “equal to zero” expressions.

### Group statements; minimize cells
A Math cell may contain multiple statements (top-to-bottom). The UI renders a trace:
- the statement you executed
- the resulting math output

This is the preferred way to keep large solutions readable without creating many small cells.

### Multi-line statements are allowed
Statements can span multiple lines when parentheses/brackets are still open.
This is primarily intended for long calls such as `plot(...)`.

Example:
- `plot(`
- `  sin(x),`
- `  xmin=-2,`
- `  xmax=2,`
- `  title='demo'`
- `)`

## Plotting guideline
When a task benefits from a visual check:
- include a plot in the “numeric + plot” Math cell,
- keep the plotted expressions close to the symbolic objects defined earlier,
- set `xmin`/`xmax` (and optionally `title`) so the default view is informative.

Note: for functions with restricted domain (e.g. `sqrt(...)`), values outside the domain may
produce `NaN` points. This is expected; the plot is still a valid visual check on the domain.

## Readability checklist
Before considering a notebook “done”:
- The task statement is present (quoted if non-English).
- The symbolic Math cell ends by outputting the symbolic answer.
- The numeric Math cell prints decimal approximations with `N(...)`.
- There is a plot for visual confirmation when applicable.
- The solution is readable with CAS trace (commands + outputs).
- The notebook can run top-to-bottom without manual edits.

## Regression examples
The repository includes demo notebooks that act as regression targets.
If Math cell parsing/rendering behavior changes, ensure these still run:
- `notebooks/CircleIntersections_CAS.sugarpy`
