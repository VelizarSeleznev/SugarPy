import numpy as np

from sugarpy.regression import render_regression


def _rows(xs, ys):
    return [{"x": float(x), "y": float(y)} for x, y in zip(xs, ys)]


def test_auto_fit_picks_linear_for_linear_data():
    xs = np.arange(1, 8, dtype=float)
    ys = 3.0 * xs + 2.0
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "linear"
    assert result["model_label"] == "Linear"
    assert result["requested_model"] == "auto"


def test_auto_fit_picks_quadratic_for_quadratic_data():
    xs = np.arange(-3, 4, dtype=float)
    ys = 2.0 * xs**2 - 3.0 * xs + 5.0
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "quadratic"


def test_auto_fit_picks_cubic_for_cubic_data():
    xs = np.linspace(-2.0, 2.0, 9)
    ys = 0.8 * xs**3 - 1.2 * xs**2 + 2.0 * xs + 1.0
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "cubic"


def test_auto_fit_picks_exponential_for_exponential_data():
    xs = np.arange(1, 8, dtype=float)
    ys = 1.5 * np.exp(0.55 * xs) + 0.75
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "exponential"


def test_auto_fit_picks_logarithmic_for_shifted_logarithmic_data():
    xs = np.linspace(3.0, 12.0, 18)
    shifted = xs - xs.min() + 1e-6
    ys = 3.0 * np.log(shifted) + 7.0
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "logarithmic"


def test_auto_fit_picks_power_for_shifted_power_data():
    xs = np.linspace(4.0, 14.0, 18)
    shifted = xs - xs.min() + 1e-6
    ys = 1.8 * shifted**1.7 + 4.0
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] == "power"


def test_auto_fit_prefers_logistic_family_for_sigmoid_data():
    xs = np.linspace(-6.0, 6.0, 16)
    ys = 2.0 + 9.0 / (1.0 + np.exp(-1.2 * (xs - 0.5)))
    result = render_regression(_rows(xs, ys), "auto")
    assert result["ok"] is True
    assert result["model"] in {"logistic", "saturating_exponential"}


def test_auto_fit_returns_alternatives_and_confidence():
    xs = np.arange(1, 8, dtype=float)
    ys = 2.0 * xs + 1.0
    result = render_regression(_rows(xs, ys), "auto", x_label="Time", y_label="Mass")
    assert result["ok"] is True
    assert result["alternatives"]
    assert result["plotly_figure"]["layout"]["xaxis"]["title"]["text"] == "Time"
    assert result["plotly_figure"]["layout"]["yaxis"]["title"]["text"] == "Mass"


def test_manual_logarithmic_fit_works_with_shifted_domain():
    xs = np.array([-2.0, -1.0, 0.0, 1.0, 2.0, 4.0])
    shifted = xs - xs.min() + 1e-6
    ys = 3.0 * np.log(shifted) + 7.0
    result = render_regression(_rows(xs, ys), "logarithmic")
    assert result["ok"] is True
    assert result["model"] == "logarithmic"
