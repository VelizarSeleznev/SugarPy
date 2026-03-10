from unittest.mock import patch

from sugarpy.chem import balance_equation
from sugarpy.library import load_catalog
from sugarpy.math_cell import display_math_cell, render_math_cell
from sugarpy.startup import plot, sqrt, x, y
from sugarpy.stoichiometry import display_stoichiometry, render_stoichiometry


def test_chem_balance_smoke():
    assert balance_equation("H2 + O2 -> H2O") == "2H2 + O2 -> 2H2O"
    assert balance_equation("Fe + O2 -> Fe2O3") == "4Fe + 3O2 -> 2Fe2O3"
    assert balance_equation("C3H8 + O2 -> CO2 + H2O") == "C3H8 + 5O2 -> 3CO2 + 4H2O"


def test_catalog_smoke():
    entries = load_catalog()
    assert entries
    assert "chem.stoichiometry_table" in [entry.id for entry in entries]


def test_math_cell_smoke():
    result_expr = render_math_cell("2 + 2")
    assert result_expr["ok"] and result_expr["kind"] == "expression"
    assert result_expr["value"] == "4"

    result_symbolic = render_math_cell("x + 2")
    assert result_symbolic["ok"] and result_symbolic["value"] is None

    result_deg = render_math_cell("sin(30)", mode="deg")
    assert result_deg["ok"] and result_deg["value"] == r"\frac{1}{2}"

    result_equation = render_math_cell("x^2 = 2")
    assert result_equation["ok"] and result_equation["kind"] == "equation"

    result_solve = render_math_cell("solve((Eq(x^2 + y^2, 25), Eq(x - y, 1)), (x, y))")
    assert result_solve["ok"] and "\\left( -3" in (result_solve["value"] or "")

    result_assign = render_math_cell("a := 5")
    assert result_assign["ok"] and result_assign["kind"] == "assignment"
    assert result_assign["assigned"] == "a"

    result_assign_list = render_math_cell("roots := solve(x^2 - 9, x)")
    assert result_assign_list["ok"] and result_assign_list["kind"] == "assignment"
    assert "-3" in (result_assign_list["value"] or "")

    result_multiline = render_math_cell(
        "c1 := (x - 5)^2 + (y - 5)^2 - 36\n"
        "c2 := (x + 1)^2 + (y - 2)^2 - 36\n"
        "line := expand(c1 - c2)\n"
        "solve(Eq(line, 0), y)"
    )
    assert result_multiline["ok"] and "\\frac{15}{2}" in (result_multiline["value"] or "")

    result_render_decimal = render_math_cell("render_decimal(sqrt(2), 3)")
    assert result_render_decimal["ok"]
    assert "1.414" in (result_render_decimal["value"] or "")

    result_render_exact = render_math_cell("render_exact(N(sqrt(2), 8))")
    assert result_render_exact["ok"]
    assert "1.4142136" in (result_render_exact["value"] or "")

    result_set_places = render_math_cell("set_decimal_places(2)\nrender_decimal(sqrt(2))")
    assert result_set_places["ok"]
    assert "1.41" in (result_set_places["value"] or "")

    result_fixed_places = render_math_cell("render_decimal(4.056, 2)")
    assert result_fixed_places["ok"]
    assert result_fixed_places["value"] == "4.06"

    class DummyShell:
        def __init__(self):
            self.user_ns = {"__sugarpy_decimal_places": 2}

    with patch("sugarpy.math_cell.get_ipython", return_value=DummyShell()):
        result_cell_decimal_mode = render_math_cell("4.056", render_mode="decimal")
        assert result_cell_decimal_mode["ok"]
        assert result_cell_decimal_mode["value"] == "4.06"
        assert result_cell_decimal_mode["steps"] == ["4.06"]


def test_stoichiometry_smoke():
    assert render_stoichiometry("H2 + O2 -> H2O", {"H2": {"n": 2}})["balanced"] == "2H2 + O2 -> 2H2O"
    assert render_stoichiometry("Fe + O2 -> Fe2O3", {"Fe": {"m": 10}})["balanced"] == "4Fe + 3O2 -> 2Fe2O3"


def test_math_display_mime_smoke():
    with patch("sugarpy.utils.display") as display_mock:
        payload = display_math_cell("2 + 2")
    assert payload["ok"] is True
    assert display_mock.called
    raw_payload = display_mock.call_args[0][0]
    assert "application/vnd.sugarpy.math+json" in raw_payload
    assert raw_payload["application/vnd.sugarpy.math+json"]["schema_version"] == 1


def test_stoich_display_mime_smoke():
    with patch("sugarpy.utils.display") as display_mock:
        payload = display_stoichiometry("H2 + O2 -> H2O", {"H2": {"n": 2}})
    assert payload["ok"] is True
    assert display_mock.called
    raw_payload = display_mock.call_args[0][0]
    assert "application/vnd.sugarpy.stoich+json" in raw_payload
    assert raw_payload["application/vnd.sugarpy.stoich+json"]["schema_version"] == 1


def test_math_namespace_sharing_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    def f(x):
        return x**2

    dummy.user_ns["f"] = f
    dummy.user_ns["a"] = 5

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        numeric = render_math_cell("f(3) + 2a")
        assert numeric["ok"] and numeric["value"] == "19"

        symbolic = render_math_cell("f(x) + 2a")
        assert symbolic["ok"] and symbolic["value"] is None

        not_callable = render_math_cell("a(2)")
        assert not not_callable["ok"]
        assert "not callable" in (not_callable["error"] or "")

        circle_1 = render_math_cell("c1 := (x - 5)^2 + (y - 5)^2 - 36")
        assert circle_1["ok"]

        circle_2 = render_math_cell("c2 := (x + 1)^2 + (y - 2)^2 - 36")
        assert circle_2["ok"]

        intersection = render_math_cell("solve((Eq(c1, 0), Eq(c2, 0)), (x, y))")
        assert intersection["ok"]
        assert "\\sqrt{55}" in (intersection["value"] or "")


def test_math_cas_circle_intersections_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        symbolic = render_math_cell(
            "c1 := (x - 3)^2 + (y + 1)^2 - 9\n"
            "c2 := (x - 4)^2 + (y - 1)^2 - 4\n"
            "line := expand(c2 - c1)\n"
            "yline := solve(line, y)\n"
            "sol := solve((c1, c2), (x, y))\n"
            "sol"
        )
        assert symbolic["ok"]
        assert "sqrt" in (symbolic["value"] or "")

        numeric = render_math_cell("solN := N(sol)\nsolN")
        assert numeric["ok"]
        assert "2.211" in (numeric["value"] or "")


def test_math_multiline_plot_statement_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    def plot_stub(*_args, **_kwargs):
        return {"data": [], "layout": {}}

    dummy.user_ns["plot"] = plot_stub

    source = (
        "plot(\n"
        "  sin(x),\n"
        "  xmin=-2,\n"
        "  xmax=2,\n"
        "  title='demo'\n"
        ")\n"
        "1 + 1"
    )

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        result = render_math_cell(source)
    assert result["ok"]
    assert result.get("trace")
    plot_items = [item for item in result["trace"] if "plot(" in (item.get("source") or "")]
    assert plot_items and plot_items[0].get("plotly_figure") is not None


def test_math_assignment_with_equation_rhs_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        result = render_math_cell(
            "eq1 := (3-a)^2 + (38-b)^2 = R^2\n"
            "eq2 := (26-a)^2 + (25-b)^2 = R^2\n"
            "solve((eq1, eq2), (a, b))"
        )
        assert result["ok"]
        assert result["kind"] == "expression"
        assert "sqrt" in (result["value"] or "")

        numeric = render_math_cell("sol := solve((eq1, eq2), (a, b))\nsolN := N(subs(sol, R, 25), 4)\nsolN")
        assert numeric["ok"]
        assert "14.5" in (numeric["value"] or "")


def test_math_assignment_with_inline_solve_equations_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        result = render_math_cell(
            "solutions := solve((h-3)^2 + (k-38)^2 = r^2, (h-26)^2 + (k-25)^2 = r^2, (h, k))"
        )
        assert result["ok"]
        assert result["kind"] == "assignment"
        assert dummy.user_ns["solutions"]
        assert "29" in (result["value"] or "")


def test_math_nested_tuple_unpack_assignment_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()

    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        result = render_math_cell(
            "r := 25\n"
            "solutions := solve((h-3)^2 + (k-38)^2 = r^2, (h-26)^2 + (k-25)^2 = r^2, (h, k))\n"
            "(h1, k1), (h2, k2) := solutions"
        )
        assert result["ok"]
        assert result["kind"] == "assignment"
        assert dummy.user_ns["h1"] is not None
        assert dummy.user_ns["k1"] is not None
        assert dummy.user_ns["h2"] is not None
        assert dummy.user_ns["k2"] is not None


def test_math_tuple_unpack_assignment_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        seed = render_math_cell("solO := [(1, 2), (4.056, 13.02)]")
        assert seed["ok"]
        unpack = render_math_cell("a0, b0 := solO[1]")
        assert unpack["ok"]
        assert dummy.user_ns["a0"] == 4.056
        assert dummy.user_ns["b0"] == 13.02


def test_math_render_wrapper_keeps_assignment_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        wrapped = render_math_cell("render_decimal(C1 := [1.23456, 2.34567], 2)")
        assert wrapped["ok"]
        assert wrapped["kind"] == "assignment"
        assert "1.23" in (wrapped["value"] or "")
        assert "2.35" in (wrapped["value"] or "")
        assert dummy.user_ns["C1"] == [1.23456, 2.34567]

        use_assigned = render_math_cell("C1[0] + C1[1]")
        assert use_assigned["ok"]
        assert "3.58023" in (use_assigned["value"] or "")


def test_math_render_wrapper_keeps_unpack_assignment_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        seed = render_math_cell("sol := [(4.056, 13.02), (24.94, 49.98)]")
        assert seed["ok"]

        wrapped_unpack = render_math_cell("render_decimal(x0, y0 := sol[0], 2)")
        assert wrapped_unpack["ok"]
        assert wrapped_unpack["kind"] == "assignment"
        assert dummy.user_ns["x0"] == 4.056
        assert dummy.user_ns["y0"] == 13.02
        assert wrapped_unpack["value"] == r"\left( 4.06, \  13.02\right)"

        check = render_math_cell("x0 + y0")
        assert check["ok"]
        assert "17.076" in (check["value"] or "")


def test_math_solve_fallback_for_exact_domain_nan_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        seed = render_math_cell(
            "A := [3, 38]\n"
            "B := [26, 25]\n"
            "rout := 25\n"
            "theta_AOC := 91\n"
            "eqA := (A[0]-a)^2 + (A[1]-b)^2 = rout^2\n"
            "eqB := (B[0]-a)^2 + (B[1]-b)^2 = rout^2\n"
            "solO := solve((eqA, eqB), (a,b))\n"
            "a0, b0 := solO[1]\n"
            "AC := 2*rout*sin(theta_AOC/2)\n"
            "eqOuter := (x-a0)^2 + (y-b0)^2 = rout^2\n"
            "eqAChord := (x-A[0])^2 + (y-A[1])^2 = AC^2\n"
            "solC := solve((eqOuter, eqAChord), (x,y))\n"
            "solC"
        )
        assert seed["ok"]
        assert "nan is not in any domain" not in (seed.get("error") or "")


def test_math_function_definition_and_call_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        definition = render_math_cell("dist(P, Q) := sqrt((P[0]-Q[0])^2 + (P[1]-Q[1])^2)")
        assert definition["ok"]
        assert "dist" in (definition.get("assigned") or "")
        assert "defined" in (definition.get("value") or "")

        call_result = render_math_cell("dist([3, 38], [26, 25])")
        assert call_result["ok"]
        assert call_result["value"] is not None
        assert "sqrt" in (call_result["value"] or "") or "26" in (call_result["value"] or "")


def test_math_function_definition_with_solve_is_not_eagerly_expanded_smoke():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        definition = render_math_cell(
            "intersections(C1, r1, C2, r2) := solve(((x - C1[0])^2 + (y - C1[1])^2 - r1^2, (x - C2[0])^2 + (y - C2[1])^2 - r2^2), (x, y))"
        )
        assert definition["ok"]
        assert "defined" in (definition.get("value") or "")
        assert "sqrt" not in (definition.get("value") or "")


def test_plot_uses_explicit_viewport_and_equal_axes():
    with patch("sugarpy.startup.display"):
        figure = plot(
            -1 + sqrt(9 - (x - 3) ** 2),
            -1 - sqrt(9 - (x - 3) ** 2),
            1 + sqrt(4 - (x - 4) ** 2),
            1 - sqrt(4 - (x - 4) ** 2),
            xmin=0,
            xmax=8,
            equal_axes=True,
            title="Circle intersections (CAS check)",
        )

    layout = figure["layout"]
    assert layout["xaxis"]["range"] == [0.0, 8.0]
    assert layout["yaxis"]["scaleanchor"] == "x"
    assert layout["yaxis"]["scaleratio"] == 1
    assert layout["showlegend"] is False
    assert layout["yaxis"]["range"][0] < -4.0
    assert layout["yaxis"]["range"][1] > 3.0


def test_math_plot_range_sugar_renders_two_implicit_circles():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        render_math_cell(
            "r := 25\n"
            "solutions := solve((h-3)^2 + (k-38)^2 = r^2, (h-26)^2 + (k-25)^2 = r^2, (h, k))\n"
            "(h1, k1), (h2, k2) := solutions\n"
            "circle1 := (x - h1)^2 + (y - k1)^2 = r^2\n"
            "circle2 := (x - h2)^2 + (y - k2)^2 = r^2"
        )
        plotted = render_math_cell(
            "plot(circle1, circle2, x = -10..40, y = 0..60, equal_axes = True)"
        )

    assert plotted["ok"]
    figure = plotted["plotly_figure"]
    assert figure is not None
    assert len(figure["data"]) >= 2
    assert all(trace["type"] == "scatter" for trace in figure["data"])
    assert {trace["name"] for trace in figure["data"]} == {
        str(dummy.user_ns["circle1"]),
        str(dummy.user_ns["circle2"]),
    }
    assert figure["layout"]["xaxis"]["range"] == [-10.0, 40.0]
    assert figure["layout"]["yaxis"]["range"] == [-4.8, 64.8]
    assert figure["layout"]["yaxis"]["scaleanchor"] == "x"
    assert figure["layout"]["yaxis"]["scaleratio"] == 1


def test_math_plot_flat_positional_ranges_render_implicit_curve():
    class DummyShell:
        def __init__(self):
            self.user_ns = {}

    dummy = DummyShell()
    with patch("sugarpy.math_cell.get_ipython", return_value=dummy):
        render_math_cell("squircle := x^4 + y^4 - 1")
        plotted = render_math_cell(
            "plot(squircle, x, -1.5, 1.5, y, -1.5, 1.5, equal_axes=True)"
        )

    assert plotted["ok"]
    figure = plotted["plotly_figure"]
    assert figure is not None
    assert len(figure["data"]) >= 1
    assert figure["layout"]["xaxis"]["range"] == [-1.5, 1.5]
    assert figure["layout"]["yaxis"]["scaleanchor"] == "x"
    assert figure["layout"]["yaxis"]["scaleratio"] == 1


def test_plot_accepts_tuple_range_specs():
    with patch("sugarpy.startup.display"):
        circle = (x - 2) ** 2 + (y - 30) ** 2 - 60
        figure = plot(circle, (x, -8, 12), (y, 20, 40), equal_axes=True)

    layout = figure["layout"]
    assert layout["xaxis"]["range"] == [-8.0, 12.0]
    assert layout["yaxis"]["range"][0] <= 20.0
    assert layout["yaxis"]["range"][1] >= 40.0
    assert layout["yaxis"]["scaleanchor"] == "x"
    assert layout["yaxis"]["scaleratio"] == 1


def test_plot_accepts_circle_expression_stored_from_equation_assignment():
    with patch("sugarpy.startup.display"):
        circle = (x - 2) ** 2 + (y - 30) ** 2 - 60
        figure = plot(circle, xmin=-8, xmax=12)

    trace = figure["data"][0]
    layout = figure["layout"]
    assert trace["type"] == "scatter"
    assert layout["yaxis"]["scaleanchor"] == "x"
    assert layout["yaxis"]["scaleratio"] == 1
    assert layout["yaxis"]["range"][0] < 30
    assert layout["yaxis"]["range"][1] > 30
