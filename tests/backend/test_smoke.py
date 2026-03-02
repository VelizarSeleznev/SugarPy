from unittest.mock import patch

from sugarpy.chem import balance_equation
from sugarpy.library import load_catalog
from sugarpy.math_cell import render_math_cell
from sugarpy.stoichiometry import render_stoichiometry


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


def test_stoichiometry_smoke():
    assert render_stoichiometry("H2 + O2 -> H2O", {"H2": {"n": 2}})["balanced"] == "2H2 + O2 -> 2H2O"
    assert render_stoichiometry("Fe + O2 -> Fe2O3", {"Fe": {"m": 10}})["balanced"] == "4Fe + 3O2 -> 2Fe2O3"


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
