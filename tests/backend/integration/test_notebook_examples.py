import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from sugarpy.math_cell import render_math_cell


@pytest.mark.integration
def test_circle_intersections_cas_notebook_runs_end_to_end():
    nb_path = Path(__file__).resolve().parents[3] / "notebooks" / "CircleIntersections_CAS.sugarpy"
    data = json.loads(nb_path.read_text(encoding="utf-8"))

    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    shell = DummyShell()

    def plot_stub(*_args, **_kwargs):
        # Keep this test stable and backend-only. The UI separately tests Plotly MIME rendering.
        return {"data": [], "layout": {"title": {"text": "stub"}}}

    shell.user_ns["plot"] = plot_stub

    math_cells = [cell for cell in data.get("cells", []) if cell.get("type") == "math"]
    assert math_cells, "Expected at least one Math cell in the demo notebook."

    results = []
    with patch("sugarpy.math_cell.get_ipython", return_value=shell):
        for cell in math_cells:
            src = cell.get("source", "")
            result = render_math_cell(src)
            results.append(result)
            assert result["ok"] is True, result.get("error")
            # The CAS trace is part of the readability contract for large tasks.
            assert result.get("trace"), "Expected CAS trace for multi-statement Math cells."

    assert results

    # Ensure the numeric step produced decimals.
    # Note: the numeric+plot Math cell ends with plot(...), which intentionally returns no math value,
    # so the decimals should be present in the trace item that outputs `solN`.
    float_pat = re.compile(r"\d\.\d")
    numeric_trace_values = []
    for result in results:
        for item in result.get("trace", []):
            v = item.get("value") or ""
            if v:
                numeric_trace_values.append(v)
    assert any(float_pat.search(v) for v in numeric_trace_values), "Expected a decimal value in the CAS trace."

    # Ensure at least one statement in the run produced a plot figure.
    plot_items = []
    for result in results:
        plot_items.extend([t for t in result.get("trace", []) if "plot(" in (t.get("source") or "")])
    assert plot_items and plot_items[0].get("plotly_figure") is not None


@pytest.mark.integration
def test_rundkoersel_cas_notebook_runs_end_to_end():
    nb_path = Path(__file__).resolve().parents[3] / "notebooks" / "Rundkoersel_CAS.sugarpy"
    data = json.loads(nb_path.read_text(encoding="utf-8"))

    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    shell = DummyShell()

    def plot_stub(*_args, **_kwargs):
        # Keep this test stable and backend-only. The UI separately tests Plotly MIME rendering.
        return {"data": [], "layout": {"title": {"text": "stub"}}}

    shell.user_ns["plot"] = plot_stub

    math_cells = [cell for cell in data.get("cells", []) if cell.get("type") == "math"]
    assert math_cells, "Expected at least one Math cell in the demo notebook."

    results = []
    with patch("sugarpy.math_cell.get_ipython", return_value=shell):
        for cell in math_cells:
            src = cell.get("source", "")
            result = render_math_cell(src)
            results.append(result)
            assert result["ok"] is True, result.get("error")
            assert result.get("trace"), "Expected CAS trace for multi-statement Math cells."

    assert results

    float_pat = re.compile(r"\d\.\d")
    numeric_trace_values = []
    for result in results:
        for item in result.get("trace", []):
            v = item.get("value") or ""
            if v:
                numeric_trace_values.append(v)
    assert any(float_pat.search(v) for v in numeric_trace_values), "Expected a decimal value in the CAS trace."

    # This readability-focused notebook intentionally avoids heavy plot output.
