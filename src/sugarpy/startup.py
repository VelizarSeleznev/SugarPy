"""IPython startup helper to preload SugarPy and user functions."""

from __future__ import annotations

import numpy as np
from IPython.display import display
from sympy import *  # noqa: F401,F403
from sympy import Symbol, init_printing, lambdify, symbols

from sugarpy.user_library import load_user_functions

x, y, z, t = symbols("x y z t")
init_printing()


def _pick_plot_symbol(expressions: list[object], fallback: Symbol = x) -> Symbol:
    for expr in expressions:
        free = getattr(expr, "free_symbols", None)
        if free:
            return sorted(free, key=lambda item: item.name)[0]
    return fallback


def _normalize_curve(values: object, x_values: np.ndarray) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    if arr.shape == ():
        return np.full_like(x_values, float(arr))
    return np.where(np.isfinite(arr), arr, np.nan)


def plot(*args, **kwargs):
    """Render SymPy expressions via Plotly MIME output for the frontend."""
    if not args:
        raise ValueError("plot() expects at least one expression.")

    variable = kwargs.pop("var", None)
    if isinstance(args[0], Symbol) and len(args) > 1:
        variable = args[0]
        expressions = list(args[1:])
    else:
        expressions = list(args)

    if variable is None:
        variable = _pick_plot_symbol(expressions)

    start = float(kwargs.pop("xmin", kwargs.pop("start", -10.0)))
    end = float(kwargs.pop("xmax", kwargs.pop("end", 10.0)))
    samples = int(kwargs.pop("samples", kwargs.pop("num", 500)))
    title = str(kwargs.pop("title", "SymPy Plot"))
    overscan = float(kwargs.pop("overscan", 4.0))

    span = abs(end - start)
    if span == 0:
        span = 1.0
    samples = max(50, samples)
    base_step = span / max(samples - 1, 1)
    render_start = start - span * overscan
    render_end = end + span * overscan
    render_span = abs(render_end - render_start)
    render_samples = int(render_span / max(base_step, 1e-9)) + 1
    render_samples = max(samples, min(20000, render_samples))

    x_values = np.linspace(render_start, render_end, render_samples)
    traces = []
    for expr in expressions:
        fn = lambdify(variable, expr, "numpy")
        y_values = _normalize_curve(fn(x_values), x_values)
        traces.append(
            {
                "type": "scatter",
                "mode": "lines",
                "x": x_values.tolist(),
                "y": y_values.tolist(),
                "name": str(expr),
            }
        )

    figure = {
        "data": traces,
        "layout": {
            "title": {"text": title},
            "xaxis": {
                "title": str(variable),
                "fixedrange": False,
                "constrain": "none",
            },
            "yaxis": {"title": "f(x)"},
            "template": "plotly_white",
            "dragmode": "pan",
        },
    }
    display({"application/vnd.plotly.v1+json": figure}, raw=True)
    return figure


try:
    import math  # noqa: F401

    load_user_functions()
except Exception:
    # Fail silently so notebooks still start.
    pass
