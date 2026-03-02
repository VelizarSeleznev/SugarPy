# Math Cell Spec

## Purpose
The Math cell is a CAS-style layer over SymPy:
- natural math input for students and teachers,
- deterministic equation/assignment behavior,
- shared namespace with Code cells.

## Language rules
- `=` means equation (not assignment).
- `:=` means assignment.
- `^` is supported as exponent operator.
- Implicit multiplication is supported (`2x`, `(x+1)(x-1)`).

## Namespace sharing
- Math cell resolves names from the current IPython namespace (`ip.user_ns`).
- Functions defined in Code cells can be called from Math cells.
- If a name is used as a call but is not callable in namespace, Math cell returns a readable error.

## Supported input kinds
1. Expression: `2x + 1`, `sin(30)`, `sqrt(2)`
2. Equation: `x^2 = 2`
3. Assignment: `a := 5`, `b := x^2 + 1`

You can also place multiple statements in one Math cell (one per line).
They run top-to-bottom and share the same Math namespace.

Statements can span multiple lines when parentheses/brackets are still open
(for example a multi-line `plot(...)` call).

## Built-in CAS helpers in Math cells
- `Eq(...)`
- `solve(...)`, `linsolve(...)`
- `simplify(...)`, `expand(...)`, `factor(...)`, `N(...)`

Quick meaning:
- `expand(expr)` expands parentheses and products into a summed form.
  Example: `expand((x-1)(x+2))` -> `x^2 + x - 2`.

## Container results
Some CAS helpers return containers (for example `solve(...)` returning a list of points).
Math cells render these containers as LaTeX so the result stays readable in the UI.

## Trace rendering
When a Math cell contains multiple statements, the UI renders a trace:
each executed statement is shown alongside its resulting output steps. This makes it easier
to see how intermediate values (like `yline`) were produced.

## Plotting from Math cells
`plot(...)` can be called from Math cells. The Plotly graph renders under the Math cell output.

This enables multi-step symbolic workflows directly in Math cells, for example:
- `c1 := (x-5)^2 + (y-5)^2 - 36`
- `c2 := (x+1)^2 + (y-2)^2 - 36`
- `line := expand(c1 - c2)`
- `solve(Eq(line, 0), y)`
- `solve((Eq(c1, 0), Eq(c2, 0)), (x, y))`

## Output payload (render_math_cell)
- `ok`: success flag
- `kind`: `expression | equation | assignment`
- `steps`: rendered LaTeX steps
- `value`: final value/equation LaTeX or `null`
- `assigned`: assigned variable name for assignment
- `mode`: trig mode (`deg | rad`)
- `error`: readable error or `null`
- `warnings`: parser/eval warnings
- `normalized_source`: normalized input
- `equation_latex`: equation output for equation kind

Notes:
- If the expression still has free symbols, `value` is `null`.
- If CAS returns concrete containers (for example list of solutions), `value` is returned as a string representation.

## Out of scope for this version
- Function definitions in Math cells (`def`, `f(x) := ...`)
- Full Maple grammar compatibility
- Matrices, piecewise, units-specific syntax
