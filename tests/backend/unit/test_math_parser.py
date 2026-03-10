import pytest

from sugarpy.math_parser import MathParseError, parse_math_input, parse_sympy_expression


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_power_is_normalized_to_python_operator():
    parsed = parse_math_input("x^2")
    assert parsed.normalized_source == "x**2"


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_implicit_multiplication_normalized_for_symbol_term():
    parsed = parse_math_input("2x")
    assert parsed.normalized_source == "2*x"


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_implicit_multiplication_normalized_for_parentheses():
    parsed = parse_math_input("(x+1)(x-1)")
    assert parsed.normalized_source == "(x+1)*(x-1)"


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_equation_becomes_explicit_eq_expression():
    parsed = parse_math_input("x = 2")
    assert parsed.kind == "equation"
    assert parsed.normalized_source == "Eq(x, 2)"


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_assignment_detected_for_colon_equals():
    parsed = parse_math_input("a := 5")
    assert parsed.kind == "assignment"
    assert parsed.assigned_name == "a"
    assert parsed.normalized_source == "let a = 5"


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
@pytest.mark.parametrize("source", ["x == 2", "x <= 2", "x >= 2", "x != 2"])
def test_comparison_operators_are_rejected(source: str):
    with pytest.raises(MathParseError, match="comparison operators are unsupported"):
        parse_math_input(source)


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
@pytest.mark.parametrize("source", ["(x+1", "x+1)", "x =", "= 2"])
def test_parser_reports_shape_errors(source: str):
    with pytest.raises(MathParseError, match="structured parser diagnostic"):
        parse_math_input(source)


@pytest.mark.unit
@pytest.mark.xfail(strict=True, reason="spec not implemented yet")
def test_equation_expression_has_eq_symbolics():
    expr = parse_sympy_expression("x = 2", mode="deg", user_ns={})
    assert str(expr) == "Eq(x, 2)"


def test_assignment_can_store_equation_rhs():
    parsed = parse_math_input("eq1 := (3-a)^2 + (38-b)^2 = R^2")
    assert parsed.kind == "assignment"
    assert parsed.assigned_name == "eq1"
    assert parsed.rhs_source == "(3-a)^2 + (38-b)^2 = R^2"


def test_assignment_unpack_targets_are_parsed():
    parsed = parse_math_input("a0, b0 := solO[1]")
    assert parsed.kind == "assignment"
    assert parsed.assigned_names == ("a0", "b0")
    assert parsed.assigned_name == "a0"
    assert parsed.rhs_source == "solO[1]"


def test_assignment_nested_unpack_targets_are_parsed():
    parsed = parse_math_input("(h1, k1), (h2, k2) := solutions")
    assert parsed.kind == "assignment"
    assert parsed.assigned_names == ("h1", "k1", "h2", "k2")
    assert parsed.assigned_name == "h1"
    assert parsed.assignment_target_tree == (("h1", "k1"), ("h2", "k2"))
    assert parsed.rhs_source == "solutions"


def test_function_assignment_is_parsed():
    parsed = parse_math_input("dist(P, Q) := sqrt((P[0]-Q[0])^2 + (P[1]-Q[1])^2)")
    assert parsed.kind == "function_assignment"
    assert parsed.function_name == "dist"
    assert parsed.function_args == ("P", "Q")


def test_inline_equations_inside_solve_expression_are_supported():
    expr = parse_sympy_expression(
        "solve((h-3)^2 + (k-38)^2 = r^2, (h-26)^2 + (k-25)^2 = r^2, (h, k))",
        mode="deg",
        user_ns={},
    )
    assert isinstance(expr, list)
    assert len(expr) == 2


def test_plot_range_sugar_and_kwargs_are_passed_as_plot_kwargs():
    captured: dict[str, object] = {}

    def plot(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {"data": [], "layout": {}}

    parse_sympy_expression(
        "plot(circle1, circle2, x = -10..40, y = 0..60, equal_axes = True)",
        mode="deg",
        user_ns={"plot": plot, "circle1": 1, "circle2": 2},
    )

    assert captured["args"] == (1, 2)
    assert captured["kwargs"] == {
        "xmin": -10,
        "xmax": 40,
        "ymin": 0,
        "ymax": 60,
        "equal_axes": True,
    }


def test_plot_tuple_range_args_are_rewritten_to_plot_kwargs():
    captured: dict[str, object] = {}

    def plot(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {"data": [], "layout": {}}

    parse_sympy_expression(
        "plot(circle, (x, -8, 12), (y, -4, 20), equal_axes=True)",
        mode="deg",
        user_ns={"plot": plot, "circle": 1},
    )

    assert captured["args"] == (1,)
    assert captured["kwargs"] == {
        "xmin": -8,
        "xmax": 12,
        "ymin": -4,
        "ymax": 20,
        "equal_axes": True,
    }


def test_plot_flat_positional_range_args_are_rewritten_to_plot_kwargs():
    captured: dict[str, object] = {}

    def plot(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {"data": [], "layout": {}}

    parse_sympy_expression(
        "plot(squircle, x, -1.5, 1.5, y, -1.5, 1.5, equal_axes=True)",
        mode="deg",
        user_ns={"plot": plot, "squircle": 1},
    )

    assert captured["args"] == (1,)
    assert captured["kwargs"] == {
        "xmin": -1.5,
        "xmax": 1.5,
        "ymin": -1.5,
        "ymax": 1.5,
        "equal_axes": True,
    }
