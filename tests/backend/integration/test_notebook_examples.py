import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from sugarpy.math_cell import render_math_cell


_CIRCLE_INTERSECTIONS_FALLBACK = {
    "cells": [
        {
            "type": "math",
            "source": (
                "c1 := (x - 3)^2 + (y + 1)^2 - 9\n"
                "c2 := (x - 4)^2 + (y - 1)^2 - 4\n"
                "line := expand(c2 - c1)\n"
                "yline := solve(line, y)\n"
                "sol := solve((c1, c2), (x, y))\n"
                "sol"
            ),
        },
        {
            "type": "math",
            "source": (
                "solN := N(sol)\n"
                "solN\n"
                "plot(\n"
                "  -1 + sqrt(9 - (x - 3)^2),\n"
                "  -1 - sqrt(9 - (x - 3)^2),\n"
                "  1 + sqrt(4 - (x - 4)^2),\n"
                "  1 - sqrt(4 - (x - 4)^2),\n"
                "  xmin=0,\n"
                "  xmax=8,\n"
                "  title='Circle intersections (CAS check)'\n"
                ")"
            ),
        },
    ]
}

_RUNDKOERSEL_FALLBACK = {
    "cells": [
        {
            "type": "math",
            "source": (
                "Ax := 3\nAy := 38\nBx := 26\nBy := 25\nPx := 43\nPy := 30\n\n"
                "rin := 15\nrout := 25\nrmid := 20\n\n"
                "u^2 + v^2 = rin^2\nu^2 + v^2 = rout^2\nu^2 + v^2 = rmid^2"
            ),
        },
        {
            "type": "math",
            "source": (
                "dx := Bx - Ax\ndy := By - Ay\nDab := (dx^2 + dy^2)^0.5\n"
                "mx := (Ax + Bx)/2\nmy := (Ay + By)/2\na := Dab/2\n"
                "halfChordToCenter := (rout^2 - a^2)^0.5\nux := -dy / Dab\nuy := dx / Dab\n\n"
                "h1 := mx + ux*halfChordToCenter\nk1 := my + uy*halfChordToCenter\n"
                "h2 := mx - ux*halfChordToCenter\nk2 := my - uy*halfChordToCenter\n\n"
                "h1N := N(h1, 8)\nk1N := N(k1, 8)\nh2N := N(h2, 8)\nk2N := N(k2, 8)\n"
                "(h1N, k1N)\n(h2N, k2N)\n\nh0 := h1N\nk0 := k1N\n\n(x - h0)^2 + (y - k0)^2 = rout^2"
            ),
        },
        {
            "type": "math",
            "source": (
                "vAx := Ax - h0\nvAy := Ay - k0\n\n"
                "vCpx := vAx*cos(91) - vAy*sin(91)\nvCpy := vAx*sin(91) + vAy*cos(91)\n"
                "vCmx := vAx*cos(91) + vAy*sin(91)\nvCmy := -vAx*sin(91) + vAy*cos(91)\n\n"
                "Cplusx := h0 + vCpx\nCplusy := k0 + vCpy\nCminusx := h0 + vCmx\nCminusy := k0 + vCmy\n\n"
                "N(Cplusx)\nN(Cplusy)\nN(Cminusx)\nN(Cminusy)\n\n"
                "Cx := Cplusx\nCy := Cplusy\n\n"
                "vBx := Bx - h0\nvBy := By - k0\ndxC := Cx - h0\ndyC := Cy - k0\n"
                "dotBC := vBx*dxC + vBy*dyC\ndotCC := dxC^2 + dyC^2\nprojx := (dotBC/dotCC)*dxC\n"
                "projy := (dotBC/dotCC)*dyC\nvDx := 2*projx - vBx\nvDy := 2*projy - vBy\n"
                "Dx := h0 + vDx\nDy := k0 + vDy\n\n"
                "N(Cx)\nN(Cy)\nN(Dx)\nN(Dy)\n\n"
                "checkC := simplify((Cx - h0)^2 + (Cy - k0)^2 - rout^2)\n"
                "checkD := simplify((Dx - h0)^2 + (Dy - k0)^2 - rout^2)\ncheckC\ncheckD"
            ),
        },
        {
            "type": "math",
            "source": (
                "phiAC := 180 - 91\nthetaBD := (180/pi) * acos((vBx*vDx + vBy*vDy)/rout^2)\n"
                "phiBD := 180 - thetaBD\n\nphiAC\nN(thetaBD)\nN(phiBD)"
            ),
        },
        {
            "type": "math",
            "source": (
                "L := 2*pi*rmid\nspeed := 30000/3600\nT := L / speed\n\n"
                "OP := ((Px - h0)^2 + (Py - k0)^2)^0.5\ndmin := abs(OP - rmid)\n\nN(T)\nN(dmin)"
            ),
        },
        {
            "type": "math",
            "source": "N(h0)\nN(k0)\nN(Cx)\nN(Cy)\nN(Dx)\nN(Dy)\nN(phiAC)\nN(phiBD)\nN(T)\nN(dmin)",
        },
    ]
}


def _load_demo_notebook(*names: str, fallback: dict) -> dict:
    notebook_dir = Path(__file__).resolve().parents[3] / "notebooks"
    for name in names:
        nb_path = notebook_dir / name
        if nb_path.exists():
            return json.loads(nb_path.read_text(encoding="utf-8"))
    return fallback


@pytest.mark.integration
def test_circle_intersections_cas_notebook_runs_end_to_end():
    data = _load_demo_notebook("CircleIntersections_CAS.sugarpy", fallback=_CIRCLE_INTERSECTIONS_FALLBACK)

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
    data = _load_demo_notebook(
        "Rundkoersel_CAS.sugarpy",
        "Projektopgaver_Rundkoersel_CAS.sugarpy",
        fallback=_RUNDKOERSEL_FALLBACK,
    )

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
