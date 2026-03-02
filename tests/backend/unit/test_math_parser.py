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
