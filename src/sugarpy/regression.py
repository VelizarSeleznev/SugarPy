"""Regression helpers for template-driven custom cells."""

from __future__ import annotations

import math
from typing import Any, Callable

import numpy as np
import sympy as sp
from IPython import get_ipython

from sugarpy.utils import display_sugarpy

CUSTOM_MIME_TYPE = "application/vnd.sugarpy.custom+json"
DEFAULT_BINDING_PREFIX = "regression"
SUPPORTED_MODELS = {"linear", "quadratic", "exponential"}


class RegressionError(ValueError):
    """Raised when a regression request is invalid."""


def _as_float(value: Any, field: str) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise RegressionError(f"{field} must be numeric.") from exc
    if not math.isfinite(parsed):
        raise RegressionError(f"{field} must be finite.")
    return parsed


def _normalize_points(points: Any) -> list[tuple[float, float]]:
    if not isinstance(points, list):
        raise RegressionError("Points must be a list.")
    normalized: list[tuple[float, float]] = []
    for index, item in enumerate(points, start=1):
        if not isinstance(item, dict):
            raise RegressionError(f"Point {index} must be an object with x/y values.")
        x_value = _as_float(item.get("x"), f"Point {index} x")
        y_value = _as_float(item.get("y"), f"Point {index} y")
        normalized.append((x_value, y_value))
    if not normalized:
        raise RegressionError("Add at least one point.")
    return normalized


def _render_number(value: float) -> str:
    if abs(value) < 1e-12:
        value = 0.0
    text = f"{value:.6g}"
    return "0" if text == "-0" else text


def _r2_score(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    y_mean = np.mean(y_true)
    ss_tot = float(np.sum((y_true - y_mean) ** 2))
    ss_res = float(np.sum((y_true - y_pred) ** 2))
    if ss_tot <= 1e-12:
        return 1.0 if ss_res <= 1e-12 else 0.0
    return 1.0 - (ss_res / ss_tot)


def _rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def _range_with_padding(values: np.ndarray, ratio: float = 0.1) -> list[float]:
    lower = float(np.min(values))
    upper = float(np.max(values))
    span = abs(upper - lower)
    if span <= 1e-9:
        span = max(abs(lower), 1.0)
    pad = span * ratio
    return [lower - pad, upper + pad]


def _build_plot(xs: np.ndarray, ys: np.ndarray, fit_xs: np.ndarray, fit_ys: np.ndarray, equation_label: str) -> dict[str, Any]:
    y_values = np.concatenate([ys, fit_ys]) if fit_ys.size else ys
    return {
        "data": [
            {
                "type": "scatter",
                "mode": "markers",
                "name": "Data",
                "x": xs.tolist(),
                "y": ys.tolist(),
                "marker": {"size": 9, "color": "#14532d"},
                "hovertemplate": "x=%{x:.6g}<br>y=%{y:.6g}<extra>Data</extra>",
            },
            {
                "type": "scatter",
                "mode": "lines",
                "name": "Fit",
                "x": fit_xs.tolist(),
                "y": fit_ys.tolist(),
                "line": {"width": 2.5, "color": "#b45309"},
                "hovertemplate": "x=%{x:.6g}<br>y=%{y:.6g}<extra>Fit</extra>",
            },
        ],
        "layout": {
            "title": {"text": equation_label},
            "paper_bgcolor": "#ffffff",
            "plot_bgcolor": "#ffffff",
            "showlegend": True,
            "xaxis": {"title": {"text": "x"}, "range": _range_with_padding(xs)},
            "yaxis": {"title": {"text": "y"}, "range": _range_with_padding(y_values)},
        },
    }


def _fit_linear(xs: np.ndarray, ys: np.ndarray) -> dict[str, Any]:
    if len(xs) < 2:
        raise RegressionError("Linear regression needs at least 2 points.")
    coeffs = np.polyfit(xs, ys, deg=1)
    slope, intercept = [float(value) for value in coeffs]
    symbol_x = sp.Symbol("x")
    expression = sp.Float(slope) * symbol_x + sp.Float(intercept)

    def predict(values: np.ndarray) -> np.ndarray:
        return (slope * values) + intercept

    return {
        "coefficients": [slope, intercept],
        "coefficient_labels": ["slope", "intercept"],
        "expression": expression,
        "equation_text": f"y = {_render_number(slope)}x + {_render_number(intercept)}",
        "predict": predict,
    }


def _fit_quadratic(xs: np.ndarray, ys: np.ndarray) -> dict[str, Any]:
    if len(xs) < 3:
        raise RegressionError("Quadratic regression needs at least 3 points.")
    coeffs = np.polyfit(xs, ys, deg=2)
    a_value, b_value, c_value = [float(value) for value in coeffs]
    symbol_x = sp.Symbol("x")
    expression = (sp.Float(a_value) * symbol_x**2) + (sp.Float(b_value) * symbol_x) + sp.Float(c_value)

    def predict(values: np.ndarray) -> np.ndarray:
        return (a_value * values**2) + (b_value * values) + c_value

    return {
        "coefficients": [a_value, b_value, c_value],
        "coefficient_labels": ["a", "b", "c"],
        "expression": expression,
        "equation_text": f"y = {_render_number(a_value)}x^2 + {_render_number(b_value)}x + {_render_number(c_value)}",
        "predict": predict,
    }


def _fit_exponential(xs: np.ndarray, ys: np.ndarray) -> dict[str, Any]:
    if len(xs) < 2:
        raise RegressionError("Exponential regression needs at least 2 points.")
    if np.any(ys <= 0):
        raise RegressionError("Exponential regression requires all y values to be greater than 0.")
    slope, intercept = np.polyfit(xs, np.log(ys), deg=1)
    growth = float(slope)
    scale = float(np.exp(intercept))
    symbol_x = sp.Symbol("x")
    expression = sp.Float(scale) * sp.exp(sp.Float(growth) * symbol_x)

    def predict(values: np.ndarray) -> np.ndarray:
        return scale * np.exp(growth * values)

    return {
        "coefficients": [scale, growth],
        "coefficient_labels": ["scale", "growth"],
        "expression": expression,
        "equation_text": f"y = {_render_number(scale)}e^({_render_number(growth)}x)",
        "predict": predict,
    }


def _fit_model(model: str, xs: np.ndarray, ys: np.ndarray) -> dict[str, Any]:
    if model == "linear":
        return _fit_linear(xs, ys)
    if model == "quadratic":
        return _fit_quadratic(xs, ys)
    if model == "exponential":
        return _fit_exponential(xs, ys)
    raise RegressionError(f"Unsupported regression model: {model}")


def _safe_binding_prefix(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch == "_" else "_" for ch in (value or "").strip().lower())
    cleaned = cleaned.strip("_")
    return cleaned or DEFAULT_BINDING_PREFIX


def _bind_results(prefix: str, payload: dict[str, Any], predictor: Callable[[float], float]) -> dict[str, str]:
    shell = get_ipython()
    if shell is None:
        raise RegressionError("Notebook namespace is unavailable.")
    namespace = shell.user_ns
    names = {
        "model": f"{prefix}_model",
        "coefficients": f"{prefix}_coefficients",
        "equation": f"{prefix}_equation",
        "r2": f"{prefix}_r2",
        "rmse": f"{prefix}_rmse",
        "predict": f"{prefix}_predict",
    }
    namespace[names["model"]] = payload["model"]
    namespace[names["coefficients"]] = payload["coefficients"]
    namespace[names["equation"]] = payload["equation_text"]
    namespace[names["r2"]] = payload["metrics"]["r2"]
    namespace[names["rmse"]] = payload["metrics"]["rmse"]
    namespace[names["predict"]] = predictor
    return names


def render_regression(
    points: Any,
    model: str = "linear",
    export_bindings: bool = False,
    binding_prefix: str = DEFAULT_BINDING_PREFIX,
) -> dict[str, Any]:
    """Return regression output for the frontend custom cell renderer."""
    normalized_model = str(model or "linear").strip().lower()
    if normalized_model not in SUPPORTED_MODELS:
        raise RegressionError(f"Model must be one of: {', '.join(sorted(SUPPORTED_MODELS))}.")

    normalized_points = _normalize_points(points)
    xs = np.asarray([point[0] for point in normalized_points], dtype=float)
    ys = np.asarray([point[1] for point in normalized_points], dtype=float)
    fit = _fit_model(normalized_model, xs, ys)
    predict_array = fit["predict"]
    predicted = np.asarray(predict_array(xs), dtype=float)

    fit_range = _range_with_padding(xs)
    fit_xs = np.linspace(fit_range[0], fit_range[1], 240)
    fit_ys = np.asarray(predict_array(fit_xs), dtype=float)

    payload: dict[str, Any] = {
        "schema_version": 1,
        "template_id": "regression",
        "ok": True,
        "model": normalized_model,
        "point_count": len(normalized_points),
        "coefficients": [float(value) for value in fit["coefficients"]],
        "coefficient_labels": [str(value) for value in fit["coefficient_labels"]],
        "equation_text": fit["equation_text"],
        "equation_latex": sp.latex(sp.Eq(sp.Symbol("y"), fit["expression"])),
        "metrics": {
            "r2": _r2_score(ys, predicted),
            "rmse": _rmse(ys, predicted),
        },
        "plotly_figure": _build_plot(xs, ys, fit_xs, fit_ys, fit["equation_text"]),
        "warnings": [],
    }

    if export_bindings:
        prefix = _safe_binding_prefix(binding_prefix)
        binding_names = _bind_results(prefix, payload, lambda value: float(np.asarray(predict_array(np.asarray([value], dtype=float)))[0]))
        payload["bindings"] = {
            "prefix": prefix,
            "names": binding_names,
        }

    return payload


def display_regression(
    points: Any,
    model: str = "linear",
    export_bindings: bool = False,
    binding_prefix: str = DEFAULT_BINDING_PREFIX,
) -> dict[str, Any]:
    """Render regression output and send structured payload via Jupyter MIME output."""
    payload = render_regression(
        points=points,
        model=model,
        export_bindings=export_bindings,
        binding_prefix=binding_prefix,
    )
    display_sugarpy(payload, CUSTOM_MIME_TYPE)
    return payload
