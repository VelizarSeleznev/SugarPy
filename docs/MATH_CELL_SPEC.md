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
- Parser normalization keeps a natural math surface:
  - `x^2` normalizes to `x**2`
  - `2x` normalizes to `2*x`
  - `(x+1)(x-1)` normalizes to `(x+1)*(x-1)`
  - `x = 2` stays an equation form, not an `Eq(...)` helper string
- Comparison operators are intentionally not part of Math-cell syntax:
  - `==`, `!=`, `<=`, `>=` return a readable diagnostic telling the user to use single `=`
    for equations

## Namespace sharing
- Math cell resolves names from the current IPython namespace (`ip.user_ns`).
- Functions defined in Code cells can be called from Math cells.
- If a name is used as a call but is not callable in namespace, Math cell returns a readable error.

## Supported input kinds
1. Expression: `2x + 1`, `sin(30)`, `sqrt(2)`
2. Equation: `x^2 = 2`
3. Assignment: `a := 5`, `b := x^2 + 1`
4. Unpack assignment: `a0, b0 := solO[1]` (Python-style tuple/list unpack)
   Nested unpack is also supported: `(h1, k1), (h2, k2) := solutions`
5. Function assignment: `f(x) := x^2 + 1`, `dist(P,Q) := sqrt((P[0]-Q[0])^2 + (P[1]-Q[1])^2)`

Important distinction:
- `f := x^2 + 2x + 1` assigns one symbolic expression to the name `f`.
- `f(3)` only makes sense if `f` is already a callable object from Code or from a Math-cell function definition.
- To define a callable CAS helper in Math cells, use `f(x) := x^2 + 2x + 1`.
- Use plain `f := ...` when you want to reuse that expression as a symbolic object, for example `solve(f = 0, x)` or `expand(f)`.
- Inline equations are also accepted inside CAS calls, for example
  `solutions := solve((h-3)^2 + (k-38)^2 = r^2, (h-26)^2 + (k-25)^2 = r^2, (h, k))`.
- Direct ordered system forms are also supported, for example
  `solve(x^2 + y^2 = 25, y = 2*x + 1, (x, y))`.
- `Eq(...)` is also accepted when you need an explicit equation helper form.
  Assignments such as `line := Eq(y, 4 - x)` are stored internally in implicit `= 0`
  form, so they stay compatible with both `solve(...)` and `plot(...)`.

For assistant-generated multi-equation solves, prefer documented ordered forms such as:
- `solutions := solve((x^2 + y^2 = 25, y = 2*x + 1), (x, y))`
- `solutions := solve(eqA, eqB, (h, k))`

Assistant output should still prefer ordered system forms over set literals, for example:
- `eq1 := x^2 + y^2 = 25`
  `eq2 := y = 2*x + 1`
  `solutions := solve({eq1, eq2}, {x, y})`

That style is accepted, but ordered tuple/direct-argument forms remain the preferred assistant-safe SugarPy pattern.

You can also place multiple statements in one Math cell (one per line).
They run top-to-bottom and share the same Math namespace.

Statements can span multiple lines when parentheses/brackets are still open
(for example a multi-line `plot(...)` call).

## Built-in CAS helpers in Math cells
- `Eq(...)`
- `solve(...)`, `linsolve(...)`
- `simplify(...)`, `expand(...)`, `factor(...)`, `subs(...)`, `N(...)`
- `render_decimal(...)`, `render_exact(...)`, `set_decimal_places(...)`

## Assistant-safe subset
When the notebook assistant generates Math cells for teaching/demo flows, it should stay inside a narrow documented subset:
- statement types: expression, equation, assignment, unpack assignment, function assignment
- helper calls: `Eq(...)`, `solve(...)`, `linsolve(...)`, `simplify(...)`, `expand(...)`, `factor(...)`, `subs(...)`, `N(...)`, `render_decimal(...)`, `render_exact(...)`, `set_decimal_places(...)`, `plot(...)`
- verification style: explicit symbolic expressions or documented unpack assignment, not undocumented helper shortcuts

Additional assistant-safe rules:
- Prefer plain `=` equation syntax over `Eq(...)` unless `Eq(...)` is specifically needed for a documented helper pattern.
- For systems of equations, prefer inline equations passed directly to `solve(...)` in an ordered form.
- Assigned equation forms such as `eq1 := a = b` and `eq1 := Eq(a, b)` are both supported, but ordered tuple/direct-argument solves are still preferred over set literals for deterministic output.
- Parser-level `normalized_source` is a normalized natural form for the written Math syntax.
  It is not a promise that SugarPy will expose internal helper forms such as `Eq(...)` or
  `lhs-rhs`.
- If `solve(...)` returns a container of points, it is fine to show that container directly before unpacking it.
- `subs(...)` is supported for post-processing symbolic results, but assistant output should not jump to it when a simpler direct symbolic expression or direct `solve(...)` result would be clearer.
- If both exact and decimal presentations are needed in one cell, wrap lines explicitly with `render_exact(...)` or `render_decimal(...)`.
- `render_decimal(...)` rounds by decimal places, not significant digits.

The assistant should avoid undocumented or out-of-scope constructs even if they might look SymPy-like, for example:
- arrow syntax like `x -> ...`
- `lambda`
- `map(...)`
- Python comprehensions / loops / `def` blocks

For multi-step teaching notebooks, prefer longer but simpler Math cells with nearby Markdown explanations over dense helper-heavy transformations.

Quick meaning:
- `expand(expr)` expands parentheses and products into a summed form.
  Example: `expand((x-1)(x+2))` -> `x^2 + x - 2`.
- `render_decimal(expr, places?)` renders the given expression in decimal form.
  - `places` means decimal places (digits after decimal point).
  - If omitted, uses the current default set by `set_decimal_places(...)`.
- `render_exact(expr)` renders the expression in exact symbolic form.
- `set_decimal_places(k)` sets default decimal places for future `render_decimal(expr)` calls.

Notes:
- These render helpers affect Math cell display behavior.
- `N(...)` itself does not do angle-unit conversion.
- `Deg` / `Rad` changes how trig helpers are interpreted before evaluation, including inverse trig helpers such as `acos(...)`.
- The same applies when those helpers are reached through the built-in `math.` namespace alias.
- If both styles are needed in one cell, wrap each line explicitly:
  - `render_exact(...)` for symbolic view
  - `render_decimal(...)` for numeric view
- `render_decimal(...)` rounds by decimal places (digits after `.`), not by significant digits.
- Math cells also provide a toolbar toggle (`Exact` / `Decimal`) for cell-level display mode.
- Function assignment in Math cells supports expression or equation right-hand side.
- Function definitions are shared through namespace and can be called from later Math/Code cells.
- Function definitions are lazy at declaration time: the right side is not eagerly evaluated on `:=`.
  This avoids expensive `solve(...)` execution and huge symbolic dumps while defining helper functions.
- When Math-cell syntax is malformed at the top level, SugarPy returns a structured parser
  diagnostic instead of leaking raw low-level parser errors.

## Container results
Some CAS helpers return containers (for example `solve(...)` returning a list of points).
Math cells render these containers as LaTeX so the result stays readable in the UI.

## Rendered card UI
After execution, a Math cell collapses into a rendered Math card instead of keeping the raw
CAS text permanently visible above a separate result area.

Expected behavior:
- The normalized source is shown as rendered math (KaTeX-style), preserving the written structure
  of the CAS input rather than showing a raw text blob.
- The result or trace is shown inside the same card.
- Tapping/clicking the card reopens the raw CAS editor.
- The editor provides a compact shortcut bar for common CAS inserts
  (`^2`, `sqrt(...)`, `solve(...)`, `expand(...)`, `N(...)`, `plot(...)`).
- When the rendered source would duplicate the result verbatim (for example simple assignments
  like `A := [1, 2]`), the source preview is omitted and only the useful result remains visible.
- `Exact` / `Decimal` is a cell-level setting and updates the rendered output immediately from a
  cached exact/decimal render payload, without rerunning the Math cell.
- `Deg` / `Rad` is also stored per Math cell, so a notebook can mix degree-based and radian-based
  calculations in different cells.
- New Math cells inherit the notebook defaults for `Exact` / `Decimal` and `Deg` / `Rad`.
- Notebook save/import preserves both those notebook defaults and any per-cell Math overrides.

## Trace rendering
When a Math cell contains multiple statements, the rendered card shows a trace:
each executed statement is shown alongside its resulting output steps. This makes it easier
to see how intermediate values were produced without duplicating the full raw editor UI.

## Plotting from Math cells
`plot(...)` can be called from Math cells. The Plotly graph renders under the Math cell output.

Current plotting options:
- In Math cells, the preferred range syntax is Maple-style:
  `plot(expr, x = -6..6, y = -4..4, equal_axes=True)`.
- `xmin`, `xmax` set the initial visible x-range.
- `ymin`, `ymax` optionally pin the visible y-range.
- `equal_axes=True` locks one unit on x to one unit on y, which is useful for circles and geometry.
- `showlegend=True|False` overrides the default legend behavior.
- `title='...'` adds an optional title. If omitted, SugarPy keeps the plot header visually quiet.
- In Math cells, range sugar is also supported:
  `plot(circle1, circle2, x = -10..40, y = 0..60, equal_axes = True)`.
- Compatibility forms are also accepted:
  `plot(circle, (x, -8, 12), (y, 20, 40), equal_axes=True)` and
  `plot(circle, x, -8, 12, y, 20, 40, equal_axes=True)`.
- Use one range style per `plot(...)` call. Do not mix tuple forms like `(x, -8, 12)` with
  `xmin/xmax/ymin/ymax` kwargs in the same plot command.

Simple geometry workflow:
- You can store a circle or other geometric relation as an equation assignment such as
  `circle := (x-2)^2 + (y-30)^2 = 60`
- Or use an explicit helper form such as `line := Eq(y, 4 - x)`.
- SugarPy stores those assignments internally in `= 0` form for CAS work.
- After that, `plot(circle)` renders the implicit curve directly.
- Direct inline equation traces are also accepted in plot calls, for example
  `plot(y = 4 - x, y = x^2 - 3*x + 2, x = -1..4, y = -2..6, equal_axes=True)`.

Plot defaults:
- SugarPy uses the requested range as the authoritative starting view.
- For 1-2 traces, the legend is shown by default; for larger multi-branch plots it is hidden by default to reduce clutter.
- Double-clicking the graph resets back to that initial view.
- Geometric plots may widen the visible x-range slightly when `equal_axes=True` is active, so that the 1:1 aspect ratio can be preserved in the available screen space.
- Implicit plots (`f(x, y) = 0`) are rendered as extracted line paths instead of a filled contour layer, so closed curves stay visually stable.

This enables multi-step symbolic workflows directly in Math cells, for example:
- `c1 := (x-5)^2 + (y-5)^2 - 36`
- `c2 := (x+1)^2 + (y-2)^2 - 36`
- `line := expand(c1 - c2)`
- `solve(Eq(line, 0), y)`
- `solve((Eq(c1, 0), Eq(c2, 0)), (x, y))`
- `parabola := Eq(y, x^2 - 3*x + 2)`
- `line := y = 4 - x`
- `solve((parabola, line), (x, y))`
- `plot(parabola, line, x = -1..4, y = -2..6, equal_axes=True)`

## Output payload (render_math_cell)
`render_math_cell(source, mode='deg', render_mode='exact'|'decimal')`

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
- Python `def` blocks directly inside Math cells (use `f(args) := expr` form instead)
- Full Maple grammar compatibility
- Matrices, piecewise, units-specific syntax
