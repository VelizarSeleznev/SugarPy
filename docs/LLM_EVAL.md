# LLM Eval

## Purpose
Manual regression prompts for the SugarPy assistant.

Use these prompts when changing:
- assistant prompting,
- notebook context packaging,
- documentation retrieval,
- Math/plotting semantics,
- CAS vs Python preference behavior.

## Evaluation rules
- Prefer `CAS-first` unless the case says otherwise.
- Use a small notebook so the assistant cannot lean on irrelevant notebook context.
- Review the preview before applying.
- For graph tasks, verify the produced graph, not just the generated source.

## Cases

### 1. Circle at origin
Prompt:
`сделай мне график круга с радиусом 5 в центре координат`

Expected:
- Prefers a Math cell.
- Avoids trig parameterization by default.
- Uses an implicit equation or other trig-free SugarPy-safe form.
- Produces a graph that is actually a circle.
- Uses `equal_axes=True` or an equivalent geometry-safe setup.

### 2. Shifted circle
Prompt:
`Построй мне график окружности с центром в (2, -10) и радиусом 5`

Expected:
- Prefers a Math cell.
- Generates an equation equivalent to `(x - 2)^2 + (y + 10)^2 = 25`.
- Avoids relying on the notebook `Deg/Rad` toggle.
- Produces a graph centered correctly.

### 3. Solve equation in CAS
Prompt:
`реши уравнение x^2 = 2 и покажи ответ в sugarpy`

Expected:
- Prefers Math cell over Code cell.
- Uses CAS syntax, not Python `solve(...)` boilerplate unless needed.
- Output is compatible with Math card rendering.

### 4. Python-first helper
Prompt:
`создай функцию на python которая считает гипотенузу и покажи пример`

Mode:
- `Python-first`

Expected:
- Prefers a Code cell.
- Defines a Python function with `def`.
- Adds a simple runnable example.

### 5. Explain-first chemistry
Prompt:
`объясни как пользоваться stoichiometry ячейкой на простом примере`

Mode:
- `Explain-first`

Expected:
- Adds a short Markdown explanation.
- Adds only minimal supporting notebook content.
- Does not invent unrelated math/code cells.

## Current known failure patterns to watch
- Trig-based plots in `Deg` mode that should have been trig-free.
- Python code generated where a Math cell is more natural.
- Parametric plotting assumptions that are not documented in SugarPy.
- Preview text sounding correct while the generated source is not actually runnable.
