"""IPython startup helper to preload SugarPy and user functions."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from IPython.display import display
import sympy as sp
from contourpy import contour_generator
from sympy import *  # noqa: F401,F403
from sympy import Symbol, init_printing, lambdify, symbols

from sugarpy.math_parser import canonicalize_equation
from sugarpy.user_library import load_user_functions

x, y, z, t = symbols("x y z t")
init_printing()


@dataclass(frozen=True)
class SugarPyPointSeries:
    x: tuple[float, ...]
    y: tuple[float, ...]
    name: str = "points"
    x_label: str = "x"
    y_label: str = "y"


def _point_float(value: object) -> float:
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    return float(value)


def points(
    x: object,
    y: object | None = None,
    *,
    name: str = "points",
    x_label: str = "x",
    y_label: str = "y",
) -> SugarPyPointSeries:
    """Create a reusable x/y point series for plot(...)."""
    if y is None:
        if not isinstance(x, (list, tuple)):
            raise ValueError("points() expects x/y arrays or a list of point pairs.")
        pairs = list(x)
        try:
            x_values = [
                _point_float(pair.get("x") if isinstance(pair, dict) else pair[0])
                for pair in pairs
            ]
            y_values = [
                _point_float(pair.get("y") if isinstance(pair, dict) else pair[1])
                for pair in pairs
            ]
        except Exception as exc:
            raise ValueError("points() pair input must contain numeric x/y values.") from exc
    else:
        if not isinstance(x, (list, tuple)) or not isinstance(y, (list, tuple)):
            raise ValueError("points() expects x and y to be lists or tuples.")
        if len(x) != len(y):
            raise ValueError("points() expects x and y to have the same length.")
        x_values = [_point_float(value) for value in x]
        y_values = [_point_float(value) for value in y]
    if not x_values:
        raise ValueError("points() expects at least one point.")
    return SugarPyPointSeries(
        x=tuple(x_values),
        y=tuple(y_values),
        name=str(name or "points"),
        x_label=str(x_label or "x"),
        y_label=str(y_label or "y"),
    )


def _plot_range_kwargs_from_symbol(name: str, start: object, end: object) -> dict[str, float | Symbol]:
    if name == "x":
        return {"xmin": float(start), "xmax": float(end)}
    if name == "y":
        return {"ymin": float(start), "ymax": float(end)}
    return {"var": Symbol(name), "start": float(start), "end": float(end)}


def _extract_positional_plot_options(expressions: list[object]) -> tuple[list[object], dict[str, float | Symbol]]:
    filtered: list[object] = []
    extracted: dict[str, float | Symbol] = {}
    idx = 0
    while idx < len(expressions):
        expr = expressions[idx]
        if isinstance(expr, (tuple, list, sp.Tuple)) and len(expr) == 3:
            target, start, end = expr
            if isinstance(target, Symbol):
                extracted.update(_plot_range_kwargs_from_symbol(target.name, start, end))
                idx += 1
                continue
        if isinstance(expr, Symbol) and idx + 2 < len(expressions):
            start = expressions[idx + 1]
            end = expressions[idx + 2]
            if expr.name in {"x", "y"}:
                try:
                    extracted.update(_plot_range_kwargs_from_symbol(expr.name, start, end))
                    idx += 3
                    continue
                except Exception:
                    pass
        filtered.append(expr)
        idx += 1
    return filtered, extracted


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


def _positive_finite_values(values: np.ndarray) -> np.ndarray:
    arr = _finite_values(values)
    return arr[arr > 0]


def _with_padding(lower: float, upper: float, pad_ratio: float = 0.08) -> list[float]:
    span = abs(upper - lower)
    if span == 0:
        span = max(abs(lower), 1.0)
    pad = span * pad_ratio
    return [float(lower - pad), float(upper + pad)]


def _with_log_padding(lower: float, upper: float, pad_ratio: float = 0.08) -> list[float]:
    safe_lower = max(float(lower), 1e-12)
    safe_upper = max(float(upper), safe_lower * 10.0)
    log_lower = np.log10(safe_lower)
    log_upper = np.log10(safe_upper)
    span = abs(log_upper - log_lower) or 1.0
    pad = span * pad_ratio
    return [float(log_lower - pad), float(log_upper + pad)]


def _axis_range_for_scale(lower: float, upper: float, scale: str) -> list[float]:
    if scale == "log":
        return _with_log_padding(lower, upper)
    return _with_padding(lower, upper)


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


def _make_implicit_traces(
    expr: object,
    x_symbol: Symbol,
    y_symbol: Symbol,
    x_range: list[float],
    y_range: list[float],
    samples: int,
) -> list[dict[str, object]]:
    x_values = np.linspace(x_range[0], x_range[1], samples)
    y_values = np.linspace(y_range[0], y_range[1], samples)
    xx, yy = np.meshgrid(x_values, y_values)
    fn = lambdify((x_symbol, y_symbol), expr, "numpy")
    z_values = np.asarray(fn(xx, yy), dtype=float)
    z_values = np.where(np.isfinite(z_values), z_values, np.nan)
    contour_lines = contour_generator(x=x_values, y=y_values, z=z_values).lines(0.0)
    traces: list[dict[str, object]] = []
    curve_name = str(expr)
    for idx, line_points in enumerate(contour_lines):
        if len(line_points) < 2:
            continue
        traces.append(
            {
                "type": "scatter",
                "mode": "lines",
                "x": line_points[:, 0].tolist(),
                "y": line_points[:, 1].tolist(),
                "name": curve_name,
                "legendgroup": curve_name,
                "showlegend": idx == 0,
                "line": {"width": 2.5},
                "hovertemplate": "x=%{x:.6g}<br>y=%{y:.6g}<extra>%{fullData.name}</extra>",
            }
        )
    return traces


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

    expressions, positional_options = _extract_positional_plot_options(expressions)
    for key, value in positional_options.items():
        kwargs.setdefault(key, value)
    expressions = [canonicalize_equation(expr) for expr in expressions]

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
    xscale = str(kwargs.pop("xscale", kwargs.pop("x_scale", "linear"))).lower()
    yscale = str(kwargs.pop("yscale", kwargs.pop("y_scale", "linear"))).lower()
    if xscale not in {"linear", "log"}:
        raise ValueError("xscale must be 'linear' or 'log'.")
    if yscale not in {"linear", "log"}:
        raise ValueError("yscale must be 'linear' or 'log'.")
    if equal_axes and (xscale == "log" or yscale == "log"):
        raise ValueError("equal_axes=True cannot be combined with log axes.")

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
    point_series: list[SugarPyPointSeries] = []
    implicit_items: list[tuple[object, Symbol, Symbol]] = []
    explicit_items: list[object] = []
    for expr in expressions:
        if isinstance(expr, SugarPyPointSeries):
            point_series.append(expr)
            continue
        implicit_symbols = _pick_implicit_symbols(expr)
        if implicit_symbols is not None and not isinstance(expr, Symbol):
            implicit_items.append((expr, implicit_symbols[0], implicit_symbols[1]))
        else:
            explicit_items.append(expr)

    x_values = np.linspace(render_start, render_end, render_samples)
    visible_y_min: float | None = None
    visible_y_max: float | None = None
    visible_mask = (x_values >= start) & (x_values <= end)
    x_label = str(variable)
    y_label = "f(x)"
    for series in point_series:
        series_x = np.asarray(series.x, dtype=float)
        series_y = np.asarray(series.y, dtype=float)
        if series_x.size != series_y.size:
            continue
        series_visible = (series_x >= start) & (series_x <= end)
        visible_values = (
            _positive_finite_values(series_y[series_visible])
            if yscale == "log"
            else _finite_values(series_y[series_visible])
        )
        if visible_values.size:
            current_min = float(np.min(visible_values))
            current_max = float(np.max(visible_values))
            visible_y_min = current_min if visible_y_min is None else min(visible_y_min, current_min)
            visible_y_max = current_max if visible_y_max is None else max(visible_y_max, current_max)
        x_label = series.x_label or x_label
        y_label = series.y_label or y_label
        traces.append(
            {
                "type": "scatter",
                "mode": "markers",
                "x": series_x.tolist(),
                "y": series_y.tolist(),
                "name": series.name,
                "marker": {
                    "size": 8,
                    "color": "#0f766e",
                    "line": {"width": 1, "color": "#134e4a"},
                },
                "hovertemplate": "%{x:.6g}, %{y:.6g}<extra>%{fullData.name}</extra>",
            }
        )
    for expr in explicit_items:
        fn = lambdify(variable, expr, "numpy")
        y_values = _normalize_curve(fn(x_values), x_values)
        visible_values = (
            _positive_finite_values(y_values[visible_mask])
            if yscale == "log"
            else _finite_values(y_values[visible_mask])
        )
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
    if xscale == "log":
        series_x_values = [value for series in point_series for value in series.x]
        positive_x_values = _positive_finite_values(
            np.asarray([*x_values.tolist(), *series_x_values], dtype=float)
        )
        x_lower = x_range[0] if x_range[0] > 0 else float(np.min(positive_x_values)) if positive_x_values.size else 1e-12
        x_upper = x_range[1] if x_range[1] > x_lower else x_lower * 10.0
        layout_x_range = _with_log_padding(x_lower, x_upper)
    else:
        layout_x_range = x_range
    if implicit_items:
        if xscale == "log" or yscale == "log":
            raise ValueError("Implicit plots do not support log axes yet.")
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
            traces.extend(_make_implicit_traces(implicit_expr, x_symbol, y_symbol, x_range, y_range, implicit_samples))
    elif ymin is not None or ymax is not None:
        y_lower = float(ymin) if ymin is not None else float(visible_y_min if visible_y_min is not None else -1.0)
        y_upper = float(ymax) if ymax is not None else float(visible_y_max if visible_y_max is not None else 1.0)
        if yscale == "log":
            if y_lower <= 0:
                y_lower = float(visible_y_min if visible_y_min and visible_y_min > 0 else 1e-12)
            if y_upper <= y_lower:
                y_upper = y_lower * 10.0
        y_range = _axis_range_for_scale(y_lower, y_upper, yscale)
    elif visible_y_min is not None and visible_y_max is not None:
        y_range = _axis_range_for_scale(visible_y_min, visible_y_max, yscale)
    else:
        y_range = _with_log_padding(1.0, 10.0) if yscale == "log" else [-1.0, 1.0]

    if show_legend is None:
        show_legend = len(traces) <= 2

    figure = {
        "data": traces,
        "layout": {
            "title": {"text": title} if title else {},
            "xaxis": {
                "title": {"text": x_label},
                **({"type": "log"} if xscale == "log" else {}),
                "fixedrange": False,
                "constrain": "none",
                "range": layout_x_range,
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
                "title": {"text": y_label},
                **({"type": "log"} if yscale == "log" else {}),
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
