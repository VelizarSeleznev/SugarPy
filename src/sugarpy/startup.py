"""IPython startup helper to preload SugarPy and user functions."""

from __future__ import annotations

import numpy as np
from IPython.display import display
import sympy as sp
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


def _pick_implicit_symbols(expr: object) -> tuple[Symbol, Symbol] | None:
    free = getattr(expr, "free_symbols", None)
    if not free or len(free) < 2:
        return None
    by_name = {symbol.name: symbol for symbol in free}
    if "x" in by_name and "y" in by_name:
        return by_name["x"], by_name["y"]
    ordered = sorted(free, key=lambda item: item.name)
    return ordered[0], ordered[1]


def _normalize_curve(values: object, x_values: np.ndarray) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    if arr.shape == ():
        return np.full_like(x_values, float(arr))
    return np.where(np.isfinite(arr), arr, np.nan)


def _finite_values(values: np.ndarray) -> np.ndarray:
    arr = np.asarray(values, dtype=float)
    return arr[np.isfinite(arr)]


def _with_padding(lower: float, upper: float, pad_ratio: float = 0.08) -> list[float]:
    span = abs(upper - lower)
    if span == 0:
        span = max(abs(lower), 1.0)
    pad = span * pad_ratio
    return [float(lower - pad), float(upper + pad)]


def _real_float_values(items: object) -> list[float]:
    values: list[float] = []
    if isinstance(items, (list, tuple, set)):
        iterable = items
    else:
        iterable = [items]
    for item in iterable:
        value = complex(sp.N(item))
        if abs(value.imag) < 1e-9:
            values.append(float(value.real))
    return values


def _estimate_implicit_center_and_span(
    expr: object,
    x_symbol: Symbol,
    y_symbol: Symbol,
) -> tuple[tuple[float, float] | None, tuple[float, float] | None]:
    center: tuple[float, float] | None = None
    span: tuple[float, float] | None = None
    try:
        stationary = sp.solve(
            (sp.diff(expr, x_symbol), sp.diff(expr, y_symbol)),
            (x_symbol, y_symbol),
            dict=True,
        )
        for solution in stationary:
            xv = solution.get(x_symbol)
            yv = solution.get(y_symbol)
            if xv is None or yv is None:
                continue
            x_values = _real_float_values(xv)
            y_values = _real_float_values(yv)
            if x_values and y_values:
                center = (x_values[0], y_values[0])
                break
    except Exception:
        center = None

    if center is None:
        return None, None

    center_x, center_y = center
    try:
        x_roots = _real_float_values(sp.solve(sp.simplify(expr.subs(y_symbol, center_y)), x_symbol))
        y_roots = _real_float_values(sp.solve(sp.simplify(expr.subs(x_symbol, center_x)), y_symbol))
        if x_roots:
            half_width = max(abs(root - center_x) for root in x_roots)
        else:
            half_width = 0.0
        if y_roots:
            half_height = max(abs(root - center_y) for root in y_roots)
        else:
            half_height = 0.0
        span = (half_width, half_height)
    except Exception:
        span = None

    return center, span


def _make_implicit_trace(
    expr: object,
    x_symbol: Symbol,
    y_symbol: Symbol,
    x_range: list[float],
    y_range: list[float],
    samples: int,
) -> dict[str, object]:
    x_values = np.linspace(x_range[0], x_range[1], samples)
    y_values = np.linspace(y_range[0], y_range[1], samples)
    xx, yy = np.meshgrid(x_values, y_values)
    fn = lambdify((x_symbol, y_symbol), expr, "numpy")
    z_values = np.asarray(fn(xx, yy), dtype=float)
    z_values = np.where(np.isfinite(z_values), z_values, np.nan)
    return {
        "type": "contour",
        "x": x_values.tolist(),
        "y": y_values.tolist(),
        "z": z_values.tolist(),
        "name": str(expr),
        "hovertemplate": "x=%{x:.6g}<br>y=%{y:.6g}<extra>%{fullData.name}</extra>",
        "contours": {"start": 0, "end": 0, "size": 1, "coloring": "lines"},
        "line": {"width": 2.5},
        "showscale": False,
    }


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

    has_explicit_xmin = "xmin" in kwargs or "start" in kwargs
    has_explicit_xmax = "xmax" in kwargs or "end" in kwargs
    has_explicit_ymin = "ymin" in kwargs
    has_explicit_ymax = "ymax" in kwargs
    start = float(kwargs.pop("xmin", kwargs.pop("start", -10.0)))
    end = float(kwargs.pop("xmax", kwargs.pop("end", 10.0)))
    ymin = kwargs.pop("ymin", None)
    ymax = kwargs.pop("ymax", None)
    samples = int(kwargs.pop("samples", kwargs.pop("num", 500)))
    title = str(kwargs.pop("title", "")).strip()
    overscan = float(kwargs.pop("overscan", 1.0))
    has_explicit_equal_axes = "equal_axes" in kwargs
    equal_axes = bool(kwargs.pop("equal_axes", False))
    show_legend = kwargs.pop("showlegend", None)

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

    traces = []
    implicit_items: list[tuple[object, Symbol, Symbol]] = []
    explicit_items: list[object] = []
    for expr in expressions:
        implicit_symbols = _pick_implicit_symbols(expr)
        if implicit_symbols is not None and not isinstance(expr, Symbol):
            implicit_items.append((expr, implicit_symbols[0], implicit_symbols[1]))
        else:
            explicit_items.append(expr)

    x_values = np.linspace(render_start, render_end, render_samples)
    visible_y_min: float | None = None
    visible_y_max: float | None = None
    visible_mask = (x_values >= start) & (x_values <= end)
    for expr in explicit_items:
        fn = lambdify(variable, expr, "numpy")
        y_values = _normalize_curve(fn(x_values), x_values)
        visible_values = _finite_values(y_values[visible_mask])
        if visible_values.size:
            current_min = float(np.min(visible_values))
            current_max = float(np.max(visible_values))
            visible_y_min = current_min if visible_y_min is None else min(visible_y_min, current_min)
            visible_y_max = current_max if visible_y_max is None else max(visible_y_max, current_max)
        traces.append(
            {
                "type": "scatter",
                "mode": "lines",
                "x": x_values.tolist(),
                "y": y_values.tolist(),
                "name": str(expr),
                "line": {"width": 2.5},
                "hovertemplate": "%{y:.6g}<extra>%{fullData.name}</extra>",
            }
        )

    x_range = [float(start), float(end)]
    if implicit_items:
        implicit_equal_axes = True if not has_explicit_equal_axes and equal_axes is False else equal_axes
        equal_axes = implicit_equal_axes
        if len(implicit_items) == 1:
            implicit_expr, x_symbol, y_symbol = implicit_items[0]
            center, span = _estimate_implicit_center_and_span(implicit_expr, x_symbol, y_symbol)
            if center is not None:
                center_x, center_y = center
                half_width, half_height = span if span is not None else (0.0, 0.0)
                if not has_explicit_xmin and not has_explicit_xmax and half_width > 0:
                    width = max(half_width * 2.3, abs(end - start) or 1.0)
                    x_range = [center_x - width / 2, center_x + width / 2]
                if ymin is None and ymax is None:
                    vertical_span = max(half_height * 2.3, abs(x_range[1] - x_range[0]), 2.0)
                    y_range = [center_y - vertical_span / 2, center_y + vertical_span / 2]
                else:
                    y_lower = float(ymin) if ymin is not None else center_y - max(half_height * 1.2, 1.0)
                    y_upper = float(ymax) if ymax is not None else center_y + max(half_height * 1.2, 1.0)
                    y_range = _with_padding(y_lower, y_upper)
            else:
                y_lower = float(ymin) if ymin is not None else x_range[0]
                y_upper = float(ymax) if ymax is not None else x_range[1]
                y_range = _with_padding(y_lower, y_upper)
        else:
            y_lower = float(ymin) if ymin is not None else x_range[0]
            y_upper = float(ymax) if ymax is not None else x_range[1]
            y_range = _with_padding(y_lower, y_upper)

        implicit_samples = max(140, min(320, int(np.sqrt(max(samples, 50))) * 18))
        for implicit_expr, x_symbol, y_symbol in implicit_items:
            traces.append(_make_implicit_trace(implicit_expr, x_symbol, y_symbol, x_range, y_range, implicit_samples))
    elif ymin is not None or ymax is not None:
        y_lower = float(ymin) if ymin is not None else float(visible_y_min if visible_y_min is not None else -1.0)
        y_upper = float(ymax) if ymax is not None else float(visible_y_max if visible_y_max is not None else 1.0)
        y_range = _with_padding(y_lower, y_upper)
    elif visible_y_min is not None and visible_y_max is not None:
        y_range = _with_padding(visible_y_min, visible_y_max)
    else:
        y_range = [-1.0, 1.0]

    if show_legend is None:
        show_legend = len(traces) <= 2

    figure = {
        "data": traces,
        "layout": {
            "title": {"text": title} if title else {},
            "xaxis": {
                "title": str(variable),
                "fixedrange": False,
                "constrain": "none",
                "range": x_range,
                "showline": True,
                "linewidth": 1,
                "linecolor": "#94a3b8",
                "mirror": False,
                "gridcolor": "#dbe7f3",
                "zeroline": True,
                "zerolinecolor": "#64748b",
                "zerolinewidth": 1.2,
                "ticks": "outside",
                "tickcolor": "#94a3b8",
            },
            "yaxis": {
                "title": "f(x)",
                "range": y_range,
                "showline": True,
                "linewidth": 1,
                "linecolor": "#94a3b8",
                "gridcolor": "#dbe7f3",
                "zeroline": True,
                "zerolinecolor": "#64748b",
                "zerolinewidth": 1.2,
                "ticks": "outside",
                "tickcolor": "#94a3b8",
                **({"scaleanchor": "x", "scaleratio": 1} if equal_axes else {}),
            },
            "showlegend": bool(show_legend),
            "template": "plotly_white",
            "dragmode": "pan",
            "hovermode": "closest",
            "paper_bgcolor": "#ffffff",
            "plot_bgcolor": "#fbfdff",
            "colorway": ["#2563eb", "#ea580c", "#16a34a", "#dc2626", "#7c3aed", "#0f766e"],
            "font": {"family": "Georgia, 'Times New Roman', serif", "color": "#1f2937", "size": 14},
            "legend": {
                "orientation": "h",
                "x": 0,
                "y": 1.14,
                "xanchor": "left",
                "yanchor": "bottom",
                "bgcolor": "rgba(255,255,255,0.92)",
                "bordercolor": "#dbe7f3",
                "borderwidth": 1,
            },
            "margin": {"l": 56, "r": 24, "t": 56, "b": 48},
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
