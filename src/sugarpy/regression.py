"""Regression cell helpers."""

from __future__ import annotations

from dataclasses import dataclass
import math
from typing import Any, Callable
import warnings

import numpy as np
from scipy.optimize import least_squares

from .utils import display_sugarpy


REGRESSION_MIME_TYPE = "application/vnd.sugarpy.regression+json"
MODEL_AUTO = "auto"
MODEL_ORDER = [
    MODEL_AUTO,
    "linear",
    "quadratic",
    "cubic",
    "exponential",
    "logarithmic",
    "power",
    "logistic",
    "saturating_exponential",
]


@dataclass(frozen=True)
class PreparedData:
    x: np.ndarray
    y: np.ndarray
    x_min: float
    x_max: float
    x_span: float
    y_min: float
    y_max: float
    y_span: float
    mean_x: float
    std_x: float
    n: int
    positive_shift: float
    domain_shift: float
    warnings: list[str]


@dataclass(frozen=True)
class FitResult:
    model_name: str
    model_label: str
    complexity_k: int
    params: dict[str, float]
    predicted: np.ndarray
    success: bool
    loss: float
    sse: float
    rmse: float
    r2: float
    aicc: float
    bic: float
    formula: str
    warnings: list[str]


@dataclass(frozen=True)
class ModelSpec:
    name: str
    label: str
    complexity_k: int
    min_points: int
    prefer_min_points: int
    fit: Callable[[PreparedData], FitResult | None]
    is_applicable: Callable[[PreparedData], bool]


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", ".")
        if not cleaned:
            return None
        try:
            numeric = float(cleaned)
        except ValueError:
            return None
        return numeric if math.isfinite(numeric) else None
    return None


def _format_number(value: float) -> str:
    if abs(value) < 1e-12:
        value = 0.0
    formatted = f"{value:.6g}"
    return "0" if formatted == "-0" else formatted


def _format_shifted_x(shift: float) -> str:
    if abs(shift) < 1e-12:
        return "x"
    if shift > 0:
        return f"(x + {_format_number(shift)})"
    return f"(x - {_format_number(abs(shift))})"


def _safe_log(values: np.ndarray) -> np.ndarray:
    return np.log(np.clip(values, 1e-9, None))


def _safe_exp(values: np.ndarray) -> np.ndarray:
    return np.exp(np.clip(values, -60.0, 60.0))


def _build_fit_x(prepared: PreparedData) -> np.ndarray:
    if prepared.x_span < 1e-9:
        return np.linspace(prepared.x_min - 1.0, prepared.x_max + 1.0, 120)
    return np.linspace(prepared.x_min, prepared.x_max, 160)


def _build_plotly_figure(
    prepared: PreparedData,
    fit_x: np.ndarray,
    fit_y: np.ndarray,
    title: str,
    x_label: str,
    y_label: str,
) -> dict[str, Any]:
    return {
        "data": [
            {
                "type": "scatter",
                "mode": "markers",
                "name": "Data",
                "x": prepared.x.tolist(),
                "y": prepared.y.tolist(),
                "marker": {
                    "size": 9,
                    "color": "#0f766e",
                    "line": {"width": 1, "color": "#134e4a"},
                },
            },
            {
                "type": "scatter",
                "mode": "lines",
                "name": title,
                "x": fit_x.tolist(),
                "y": fit_y.tolist(),
                "line": {"width": 2.5, "color": "#f97316"},
            },
        ],
        "layout": {
            "height": 280,
            "showlegend": True,
            "paper_bgcolor": "rgba(255,255,255,0)",
            "plot_bgcolor": "rgba(255,255,255,0)",
            "font": {"color": "#1f2937"},
            "margin": {"l": 44, "r": 18, "t": 32, "b": 42},
            "legend": {"font": {"color": "#1f2937"}},
            "xaxis": {
                "title": {
                    "text": x_label or "x",
                    "font": {"color": "#1f2937", "size": 13},
                    "standoff": 12,
                },
                "tickfont": {"color": "#1f2937"},
                "gridcolor": "rgba(148, 163, 184, 0.28)",
                "zeroline": False,
            },
            "yaxis": {
                "title": {
                    "text": y_label or "y",
                    "font": {"color": "#1f2937", "size": 13},
                    "standoff": 12,
                },
                "tickfont": {"color": "#1f2937"},
                "gridcolor": "rgba(148, 163, 184, 0.28)",
                "zeroline": False,
            },
        },
    }


def _metrics(actual: np.ndarray, predicted: np.ndarray, complexity_k: int) -> tuple[float, float, float, float, float]:
    residuals = predicted - actual
    sse = float(np.sum(np.square(residuals)))
    rmse = float(np.sqrt(max(sse, 0.0) / max(actual.size, 1)))
    y_mean = float(np.mean(actual))
    total = float(np.sum(np.square(actual - y_mean)))
    if total < 1e-12:
        r2 = 1.0 if sse < 1e-12 else 0.0
    else:
        r2 = max(0.0, 1.0 - sse / total)
    safe_sse = max(sse, 1e-12)
    n = actual.size
    aic = n * math.log(safe_sse / max(n, 1)) + 2.0 * complexity_k
    if n - complexity_k - 1 <= 0:
        aicc = float("inf")
    else:
        aicc = aic + (2.0 * complexity_k * (complexity_k + 1)) / (n - complexity_k - 1)
    bic = n * math.log(safe_sse / max(n, 1)) + complexity_k * math.log(max(n, 1))
    return sse, rmse, r2, aicc, bic


def _fit_result(
    prepared: PreparedData,
    model_name: str,
    model_label: str,
    complexity_k: int,
    params: dict[str, float],
    predicted: np.ndarray,
    formula: str,
    warnings_list: list[str] | None = None,
    success: bool = True,
    loss: float | None = None,
) -> FitResult:
    sse, rmse, r2, aicc, bic = _metrics(prepared.y, predicted, complexity_k)
    return FitResult(
        model_name=model_name,
        model_label=model_label,
        complexity_k=complexity_k,
        params=params,
        predicted=predicted,
        success=success,
        loss=sse if loss is None else loss,
        sse=sse,
        rmse=rmse,
        r2=r2,
        aicc=aicc,
        bic=bic,
        formula=formula,
        warnings=warnings_list or [],
    )


def _sanitize_fit(prepared: PreparedData, fit: FitResult) -> FitResult | None:
    if not fit.success:
        return None
    if not np.isfinite(fit.predicted).all():
        return None
    if not all(math.isfinite(value) for value in fit.params.values()):
        return None
    if fit.rmse > max(prepared.y_span * 10.0, 1e6):
        return None
    if np.max(np.abs(fit.predicted)) > max(abs(prepared.y_max), abs(prepared.y_min), 1.0) * 1_000.0:
        return None
    return fit


def _prepare_data(points: Any) -> tuple[PreparedData | None, list[dict[str, Any]]]:
    invalid_rows: list[dict[str, Any]] = []
    normalized_rows: list[tuple[float, float]] = []
    if not isinstance(points, list):
        return None, [{"row": 1, "error": "Points must be a list of x/y rows."}]
    for index, raw_point in enumerate(points, start=1):
        if not isinstance(raw_point, dict):
            invalid_rows.append({"row": index, "error": "Row must be an object with x and y values."})
            continue
        raw_x = str(raw_point.get("x") or "").strip()
        raw_y = str(raw_point.get("y") or "").strip()
        if not raw_x and not raw_y:
            continue
        x_value = _to_float(raw_point.get("x"))
        y_value = _to_float(raw_point.get("y"))
        row_errors: list[str] = []
        if x_value is None:
            row_errors.append("x must be a number")
        if y_value is None:
            row_errors.append("y must be a number")
        if row_errors:
            invalid_rows.append({"row": index, "error": ", ".join(row_errors)})
            continue
        normalized_rows.append((x_value, y_value))

    if len(normalized_rows) < 2:
        return None, invalid_rows

    grouped: dict[float, list[float]] = {}
    for x_value, y_value in normalized_rows:
        grouped.setdefault(x_value, []).append(y_value)
    warnings_list: list[str] = []
    if len(grouped) < len(normalized_rows):
        warnings_list.append("Duplicate x values were averaged before fitting.")

    xs = np.array(sorted(grouped.keys()), dtype=float)
    ys = np.array([float(np.mean(grouped[x_value])) for x_value in xs], dtype=float)

    x_min = float(np.min(xs))
    x_max = float(np.max(xs))
    y_min = float(np.min(ys))
    y_max = float(np.max(ys))
    x_span = max(x_max - x_min, 1e-6)
    y_span = max(y_max - y_min, 1e-6)
    positive_shift = max(1e-6, -x_min + 1e-6) if x_min <= 0 else 0.0
    domain_shift = -x_min + 1e-6

    return (
        PreparedData(
            x=xs,
            y=ys,
            x_min=x_min,
            x_max=x_max,
            x_span=x_span,
            y_min=y_min,
            y_max=y_max,
            y_span=y_span,
            mean_x=float(np.mean(xs)),
            std_x=float(max(np.std(xs), 1e-6)),
            n=int(xs.size),
            positive_shift=positive_shift,
            domain_shift=domain_shift,
            warnings=warnings_list,
        ),
        invalid_rows,
    )


def _fit_polynomial(prepared: PreparedData, degree: int, name: str, label: str) -> FitResult | None:
    if prepared.n < degree + 1 or np.unique(prepared.x).size < degree + 1:
        return None
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", np.exceptions.RankWarning)
        coeffs = np.polyfit(prepared.x, prepared.y, degree)
    predicted = np.polyval(coeffs, prepared.x)
    terms: list[str] = []
    parameter_names = list("abcd")
    params: dict[str, float] = {}
    for index, coeff in enumerate(coeffs):
        power = degree - index
        params[parameter_names[index]] = float(coeff)
        prefix = f"{'+' if coeff >= 0 else '-'} {_format_number(abs(float(coeff)))}"
        if not terms:
            prefix = f"{_format_number(float(coeff))}"
        if power == 0:
            term = prefix
        elif power == 1:
            term = f"{prefix}x"
        else:
            term = f"{prefix}x^{power}"
        terms.append(term)
    return _sanitize_fit(prepared, _fit_result(prepared, name, label, degree + 1, params, predicted, f"y = {' '.join(terms)}"))


def _exp_func(x: np.ndarray, params: np.ndarray) -> np.ndarray:
    a, b, c = params
    return a * _safe_exp(b * x) + c


def _log_func_factory(shift: float) -> Callable[[np.ndarray, np.ndarray], np.ndarray]:
    def _func(x: np.ndarray, params: np.ndarray) -> np.ndarray:
        a, b = params
        return a * _safe_log(x + shift) + b

    return _func


def _power_func_factory(shift: float) -> Callable[[np.ndarray, np.ndarray], np.ndarray]:
    def _func(x: np.ndarray, params: np.ndarray) -> np.ndarray:
        a, b, c = params
        return a * np.power(np.clip(x + shift, 1e-6, None), b) + c

    return _func


def _logistic_func(x: np.ndarray, params: np.ndarray) -> np.ndarray:
    a, b, c, d = params
    return c + d / (1.0 + _safe_exp(-a * (x - b)))


def _saturating_func(x: np.ndarray, params: np.ndarray) -> np.ndarray:
    a, b0, c, d = params
    shifted = np.maximum(x - b0, 0.0)
    return c + d * (1.0 - _safe_exp(-a * shifted))


def _least_squares_multistart(
    prepared: PreparedData,
    name: str,
    label: str,
    parameter_names: list[str],
    func: Callable[[np.ndarray, np.ndarray], np.ndarray],
    guesses: list[np.ndarray],
    lower_bounds: np.ndarray,
    upper_bounds: np.ndarray,
    formula_builder: Callable[[dict[str, float]], str],
) -> FitResult | None:
    if not guesses:
        return None
    best_result: FitResult | None = None
    f_scale = max(prepared.y_span * 0.2, 1e-3)
    for guess in guesses[:10]:
        try:
            clipped_guess = np.clip(np.asarray(guess, dtype=float), lower_bounds, upper_bounds)
            result = least_squares(
                lambda params: func(prepared.x, params) - prepared.y,
                clipped_guess,
                bounds=(lower_bounds, upper_bounds),
                loss="soft_l1",
                f_scale=f_scale,
                method="trf",
                max_nfev=4000,
            )
        except Exception:
            continue
        if not result.success:
            continue
        predicted = func(prepared.x, result.x)
        params = {param_name: float(value) for param_name, value in zip(parameter_names, result.x)}
        fit = _sanitize_fit(
            prepared,
            _fit_result(
                prepared,
                name,
                label,
                len(parameter_names),
                params,
                predicted,
                formula_builder(params),
                success=bool(result.success),
                loss=float(result.cost * 2.0),
            ),
        )
        if fit is None:
            continue
        if best_result is None or fit.aicc < best_result.aicc or (
            abs(fit.aicc - best_result.aicc) < 1e-9 and fit.rmse < best_result.rmse
        ):
            best_result = fit
    return best_result


def _fit_exponential(prepared: PreparedData) -> FitResult | None:
    if prepared.n < 3:
        return None
    y_mid = (prepared.y_min + prepared.y_max) / 2.0
    amplitude = max(prepared.y_span, 1e-3)
    slope_scale = 1.0 / prepared.x_span
    guesses = [
        np.array([amplitude, slope_scale, prepared.y_min]),
        np.array([amplitude, -slope_scale, prepared.y_max]),
        np.array([-amplitude, slope_scale, prepared.y_max]),
        np.array([prepared.y[0] - prepared.y_min, 0.5 * slope_scale, prepared.y_min]),
        np.array([prepared.y[-1] - prepared.y_min, slope_scale * 2.0, y_mid]),
    ]
    lower = np.array([-prepared.y_span * 8.0, -8.0 / prepared.x_span, prepared.y_min - prepared.y_span * 4.0])
    upper = np.array([prepared.y_span * 8.0, 8.0 / prepared.x_span, prepared.y_max + prepared.y_span * 4.0])
    return _least_squares_multistart(
        prepared,
        "exponential",
        "Exponential",
        ["a", "b", "c"],
        _exp_func,
        guesses,
        lower,
        upper,
        lambda params: f"y = {_format_number(params['a'])}exp({_format_number(params['b'])}x) + {_format_number(params['c'])}",
    )


def _fit_logarithmic(prepared: PreparedData) -> FitResult | None:
    if prepared.n < 3:
        return None
    shift = prepared.domain_shift
    func = _log_func_factory(shift)
    guesses = [
        np.array([prepared.y_span / max(_safe_log(np.array([prepared.x_max + shift]))[0], 1e-3), prepared.y_min]),
        np.array([-prepared.y_span / max(_safe_log(np.array([prepared.x_max + shift]))[0], 1e-3), prepared.y_max]),
        np.array([prepared.y_span * 0.5, np.mean(prepared.y)]),
    ]
    lower = np.array([-prepared.y_span * 10.0, prepared.y_min - prepared.y_span * 4.0])
    upper = np.array([prepared.y_span * 10.0, prepared.y_max + prepared.y_span * 4.0])
    shift_text = _format_shifted_x(shift)
    return _least_squares_multistart(
        prepared,
        "logarithmic",
        "Logarithmic",
        ["a", "b"],
        func,
        guesses,
        lower,
        upper,
        lambda params: f"y = {_format_number(params['a'])}ln({shift_text}) + {_format_number(params['b'])}",
    )


def _fit_power(prepared: PreparedData) -> FitResult | None:
    if prepared.n < 4:
        return None
    shift = prepared.domain_shift
    func = _power_func_factory(shift)
    guesses = [
        np.array([prepared.y_span, 1.0, prepared.y_min]),
        np.array([prepared.y_span, 2.0, prepared.y_min]),
        np.array([-prepared.y_span, 1.0, prepared.y_max]),
        np.array([prepared.y_span * 0.5, 0.5, np.mean(prepared.y)]),
    ]
    lower = np.array([-prepared.y_span * 10.0, -4.0, prepared.y_min - prepared.y_span * 4.0])
    upper = np.array([prepared.y_span * 10.0, 4.0, prepared.y_max + prepared.y_span * 4.0])
    shift_text = _format_shifted_x(shift)
    return _least_squares_multistart(
        prepared,
        "power",
        "Power",
        ["a", "b", "c"],
        func,
        guesses,
        lower,
        upper,
        lambda params: f"y = {_format_number(params['a'])}{shift_text}^{_format_number(params['b'])} + {_format_number(params['c'])}",
    )


def _fit_logistic(prepared: PreparedData) -> FitResult | None:
    if prepared.n < 6:
        return None
    midpoint = prepared.y_min + prepared.y_span * 0.5
    midpoint_index = int(np.argmin(np.abs(prepared.y - midpoint)))
    center_guess = float(prepared.x[midpoint_index])
    slope_scale = 1.0 / prepared.x_span
    guesses = [
        np.array([slope_scale, center_guess, prepared.y_min, prepared.y_span]),
        np.array([2.0 * slope_scale, center_guess, prepared.y_min, prepared.y_span]),
        np.array([-slope_scale, center_guess, prepared.y_max, -prepared.y_span]),
        np.array([0.5 * slope_scale, prepared.mean_x, prepared.y_min, prepared.y_span]),
    ]
    lower = np.array([-12.0 / prepared.x_span, prepared.x_min - prepared.x_span, prepared.y_min - prepared.y_span * 3.0, -prepared.y_span * 6.0])
    upper = np.array([12.0 / prepared.x_span, prepared.x_max + prepared.x_span, prepared.y_max + prepared.y_span * 3.0, prepared.y_span * 6.0])
    return _least_squares_multistart(
        prepared,
        "logistic",
        "Logistic",
        ["a", "b", "c", "d"],
        _logistic_func,
        guesses,
        lower,
        upper,
        lambda params: (
            f"y = {_format_number(params['c'])} + {_format_number(params['d'])} / "
            f"(1 + exp(-{_format_number(params['a'])}(x - {_format_number(params['b'])})))"
        ),
    )


def _fit_saturating(prepared: PreparedData) -> FitResult | None:
    if prepared.n < 5:
        return None
    slope_scale = 1.0 / prepared.x_span
    guesses = [
        np.array([slope_scale, prepared.x_min, prepared.y_min, prepared.y_span]),
        np.array([2.0 * slope_scale, prepared.x_min, prepared.y_min, prepared.y_span]),
        np.array([0.5 * slope_scale, prepared.mean_x, prepared.y_min, prepared.y_span]),
        np.array([slope_scale, prepared.x_min, prepared.y_max, -prepared.y_span]),
    ]
    lower = np.array([1e-6, prepared.x_min - prepared.x_span, prepared.y_min - prepared.y_span * 3.0, -prepared.y_span * 6.0])
    upper = np.array([12.0 / prepared.x_span, prepared.x_max + prepared.x_span, prepared.y_max + prepared.y_span * 3.0, prepared.y_span * 6.0])
    return _least_squares_multistart(
        prepared,
        "saturating_exponential",
        "Saturating exponential",
        ["a", "b0", "c", "d"],
        _saturating_func,
        guesses,
        lower,
        upper,
        lambda params: (
            f"y = {_format_number(params['c'])} + {_format_number(params['d'])}"
            f"(1 - exp(-{_format_number(params['a'])}(x - {_format_number(params['b0'])})))"
        ),
    )


MODEL_REGISTRY: dict[str, ModelSpec] = {
    "linear": ModelSpec(
        name="linear",
        label="Linear",
        complexity_k=2,
        min_points=2,
        prefer_min_points=2,
        fit=lambda prepared: _fit_polynomial(prepared, 1, "linear", "Linear"),
        is_applicable=lambda prepared: prepared.n >= 2,
    ),
    "quadratic": ModelSpec(
        name="quadratic",
        label="Quadratic",
        complexity_k=3,
        min_points=3,
        prefer_min_points=3,
        fit=lambda prepared: _fit_polynomial(prepared, 2, "quadratic", "Quadratic"),
        is_applicable=lambda prepared: prepared.n >= 3,
    ),
    "cubic": ModelSpec(
        name="cubic",
        label="Cubic",
        complexity_k=4,
        min_points=4,
        prefer_min_points=4,
        fit=lambda prepared: _fit_polynomial(prepared, 3, "cubic", "Cubic"),
        is_applicable=lambda prepared: prepared.n >= 4,
    ),
    "exponential": ModelSpec(
        name="exponential",
        label="Exponential",
        complexity_k=3,
        min_points=3,
        prefer_min_points=6,
        fit=_fit_exponential,
        is_applicable=lambda prepared: prepared.n >= 3,
    ),
    "logarithmic": ModelSpec(
        name="logarithmic",
        label="Logarithmic",
        complexity_k=2,
        min_points=3,
        prefer_min_points=6,
        fit=_fit_logarithmic,
        is_applicable=lambda prepared: prepared.n >= 3,
    ),
    "power": ModelSpec(
        name="power",
        label="Power",
        complexity_k=3,
        min_points=4,
        prefer_min_points=6,
        fit=_fit_power,
        is_applicable=lambda prepared: prepared.n >= 4,
    ),
    "logistic": ModelSpec(
        name="logistic",
        label="Logistic",
        complexity_k=4,
        min_points=6,
        prefer_min_points=6,
        fit=_fit_logistic,
        is_applicable=lambda prepared: prepared.n >= 6,
    ),
    "saturating_exponential": ModelSpec(
        name="saturating_exponential",
        label="Saturating exponential",
        complexity_k=4,
        min_points=5,
        prefer_min_points=6,
        fit=_fit_saturating,
        is_applicable=lambda prepared: prepared.n >= 5,
    ),
}


def _candidate_models(prepared: PreparedData, requested_model: str) -> list[ModelSpec]:
    if prepared.n < 3:
        return [MODEL_REGISTRY["linear"]]
    if requested_model != MODEL_AUTO:
        spec = MODEL_REGISTRY.get(requested_model)
        return [spec] if spec else [MODEL_REGISTRY["linear"]]
    candidates: list[ModelSpec] = []
    for model_name in MODEL_ORDER[1:]:
        spec = MODEL_REGISTRY[model_name]
        if prepared.n < spec.prefer_min_points and spec.name not in {"linear", "quadratic", "cubic"}:
            continue
        if spec.is_applicable(prepared):
            candidates.append(spec)
    return candidates or [MODEL_REGISTRY["linear"]]


def fit_model(model_name: str, prepared: PreparedData) -> FitResult | None:
    spec = MODEL_REGISTRY.get(model_name)
    if spec is None or not spec.is_applicable(prepared):
        return None
    return spec.fit(prepared)


def auto_fit(prepared: PreparedData, models: list[ModelSpec]) -> tuple[FitResult | None, list[FitResult]]:
    fits = [fit for fit in (model.fit(prepared) for model in models) if fit is not None]
    if not fits:
        return None, []
    fits.sort(key=lambda fit: (fit.aicc, fit.complexity_k, fit.rmse))
    best = fits[0]
    near_best = [fit for fit in fits if fit.aicc <= best.aicc + 2.0]
    near_best.sort(key=lambda fit: (fit.complexity_k, fit.rmse, fit.aicc))
    chosen = near_best[0]
    fits.sort(key=lambda fit: (fit.aicc, fit.rmse))
    return chosen, fits


def _confidence(best_fit: FitResult | None, alternatives: list[FitResult]) -> str:
    if best_fit is None or len(alternatives) < 2:
        return "high"
    delta = alternatives[1].aicc - alternatives[0].aicc
    return "low" if delta < 2.0 else "high"


def render_regression(points: Any, model: str = MODEL_AUTO, x_label: str = "x", y_label: str = "y") -> dict[str, Any]:
    requested_model = model if model in MODEL_ORDER else MODEL_AUTO
    prepared, invalid_rows = _prepare_data(points)
    if prepared is None:
        return {
            "ok": False,
            "model": "linear",
            "requested_model": requested_model,
            "model_label": "Linear",
            "confidence": "low",
            "error": "Enter at least two valid x/y points.",
            "equation_text": None,
            "r2": None,
            "rmse": None,
            "aicc": None,
            "bic": None,
            "points": [],
            "invalid_rows": invalid_rows,
            "plotly_figure": None,
            "parameters": {},
            "warnings": [],
            "alternatives": [],
        }

    candidates = _candidate_models(prepared, requested_model)
    best_fit, ranked_fits = auto_fit(prepared, candidates) if requested_model == MODEL_AUTO else (fit_model(requested_model, prepared), [])
    if requested_model != MODEL_AUTO:
        ranked_fits = [best_fit] if best_fit is not None else []

    if best_fit is None:
        return {
            "ok": False,
            "model": requested_model if requested_model != MODEL_AUTO else "linear",
            "requested_model": requested_model,
            "model_label": requested_model.replace("_", " ").title(),
            "confidence": "low",
            "error": "No stable fit was found for the current points.",
            "equation_text": None,
            "r2": None,
            "rmse": None,
            "aicc": None,
            "bic": None,
            "points": [{"x": float(x_value), "y": float(y_value)} for x_value, y_value in zip(prepared.x, prepared.y)],
            "invalid_rows": invalid_rows,
            "plotly_figure": None,
            "parameters": {},
            "warnings": prepared.warnings,
            "alternatives": [],
        }

    fit_x = _build_fit_x(prepared)
    fit_predictors = {
        "linear": lambda x_values: np.polyval(np.polyfit(prepared.x, prepared.y, 1), x_values),
        "quadratic": lambda x_values: np.polyval(np.polyfit(prepared.x, prepared.y, 2), x_values),
        "cubic": lambda x_values: np.polyval(np.polyfit(prepared.x, prepared.y, 3), x_values),
        "exponential": lambda x_values: _exp_func(x_values, np.array(list(best_fit.params.values()))),
        "logarithmic": lambda x_values: _log_func_factory(prepared.domain_shift)(x_values, np.array(list(best_fit.params.values()))),
        "power": lambda x_values: _power_func_factory(prepared.domain_shift)(x_values, np.array(list(best_fit.params.values()))),
        "logistic": lambda x_values: _logistic_func(x_values, np.array(list(best_fit.params.values()))),
        "saturating_exponential": lambda x_values: _saturating_func(x_values, np.array(list(best_fit.params.values()))),
    }
    fit_y = fit_predictors[best_fit.model_name](fit_x)

    alternatives_payload = [
        {
            "model_name": fit.model_name,
            "model_label": fit.model_label,
            "rmse": fit.rmse,
            "r2": fit.r2,
            "aicc": fit.aicc,
            "bic": fit.bic,
            "formula": fit.formula,
        }
        for fit in ranked_fits[:3]
    ]

    warnings_list = [*prepared.warnings, *best_fit.warnings]
    if _confidence(best_fit, ranked_fits) == "low":
        warnings_list.append("Best available fit has low confidence because several models score similarly.")

    return {
        "ok": True,
        "model": best_fit.model_name,
        "requested_model": requested_model,
        "model_label": best_fit.model_label,
        "confidence": _confidence(best_fit, ranked_fits),
        "error": None,
        "equation_text": best_fit.formula,
        "r2": best_fit.r2,
        "rmse": best_fit.rmse,
        "aicc": best_fit.aicc,
        "bic": best_fit.bic,
        "points": [{"x": float(x_value), "y": float(y_value)} for x_value, y_value in zip(prepared.x, prepared.y)],
        "invalid_rows": invalid_rows,
        "plotly_figure": _build_plotly_figure(prepared, fit_x, fit_y, best_fit.model_label, x_label, y_label),
        "parameters": best_fit.params,
        "warnings": warnings_list,
        "alternatives": alternatives_payload,
    }


def display_regression(points: Any, model: str = MODEL_AUTO, x_label: str = "x", y_label: str = "y") -> dict[str, Any]:
    payload = render_regression(points, model, x_label=x_label, y_label=y_label)
    display_sugarpy({**payload, "schema_version": 1}, REGRESSION_MIME_TYPE)
    return payload
