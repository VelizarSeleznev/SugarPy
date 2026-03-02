"""CAS-style parsing helpers for Math cells."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Literal

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

_TRANSFORMS = standard_transformations + (convert_xor, implicit_multiplication_application)
_IDENT_RE = re.compile(r"[A-Za-z_]\w*")
_ASSIGN_TARGET_RE = re.compile(r"^[A-Za-z_]\w*$")
_CALL_NAME_RE = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
_BLOCKED_IDENTIFIERS = {
    "import",
    "exec",
    "eval",
    "lambda",
    "globals",
    "locals",
    "open",
    "compile",
    "__import__",
}


class MathParseError(ValueError):
    """Raised when CAS input cannot be parsed safely."""


@dataclass(frozen=True)
class ParsedMathInput:
    kind: Literal["assignment", "equation", "expression"]
    source: str
    normalized_source: str
    lhs_source: str | None = None
    rhs_source: str | None = None
    assigned_name: str | None = None
    warnings: tuple[str, ...] = ()


def _scan_top_level(source: str) -> Dict[str, list[int]]:
    depth = 0
    quote: str | None = None
    escaped = False
    assignment_positions: list[int] = []
    equation_positions: list[int] = []
    compare_positions: list[int] = []
    i = 0
    while i < len(source):
        ch = source[i]
        nxt = source[i + 1] if i + 1 < len(source) else ""
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in {"'", '"'}:
            quote = ch
            i += 1
            continue
        if ch in "([{":
            depth += 1
            i += 1
            continue
        if ch in ")]}":
            depth -= 1
            if depth < 0:
                raise MathParseError("Unmatched closing bracket.")
            i += 1
            continue
        if depth == 0:
            pair = ch + nxt
            if pair == ":=":
                assignment_positions.append(i)
                i += 2
                continue
            if pair in {"==", "!=", "<=", ">="}:
                compare_positions.append(i)
                i += 2
                continue
            if ch == "=":
                equation_positions.append(i)
        i += 1
    if quote:
        raise MathParseError("Unclosed string literal.")
    if depth != 0:
        raise MathParseError("Unclosed bracket in expression.")
    return {
        "assignment": assignment_positions,
        "equation": equation_positions,
        "compare": compare_positions,
    }


def _check_blocked_identifiers(source: str) -> None:
    names = set(_IDENT_RE.findall(source))
    for name in names:
        if name.startswith("__"):
            raise MathParseError("Names starting with '__' are not allowed in Math cells.")
        if name in _BLOCKED_IDENTIFIERS:
            raise MathParseError(f"'{name}' is not allowed in Math cells.")


def parse_math_input(source: str) -> ParsedMathInput:
    raw = (source or "").strip()
    if not raw:
        raise MathParseError("Empty cell.")
    _check_blocked_identifiers(raw)
    marks = _scan_top_level(raw)
    if len(marks["assignment"]) > 1:
        raise MathParseError("Use only one ':=' assignment per Math cell.")
    if marks["compare"]:
        raise MathParseError("Use single '=' for equations in Math cells.")

    if marks["assignment"]:
        idx = marks["assignment"][0]
        lhs = raw[:idx].strip()
        rhs = raw[idx + 2 :].strip()
        if not lhs or not rhs:
            raise MathParseError("Assignment must have both name and expression.")
        if not _ASSIGN_TARGET_RE.match(lhs):
            raise MathParseError("Left side of ':=' must be a single variable name.")
        return ParsedMathInput(
            kind="assignment",
            source=raw,
            normalized_source=f"{lhs} := {rhs}",
            lhs_source=lhs,
            rhs_source=rhs,
            assigned_name=lhs,
        )

    if len(marks["equation"]) > 1:
        raise MathParseError("Use one top-level '=' per equation.")
    if marks["equation"]:
        idx = marks["equation"][0]
        lhs = raw[:idx].strip()
        rhs = raw[idx + 1 :].strip()
        if not lhs or not rhs:
            raise MathParseError("Equation must have expressions on both sides of '='.")
        return ParsedMathInput(
            kind="equation",
            source=raw,
            normalized_source=f"{lhs} = {rhs}",
            lhs_source=lhs,
            rhs_source=rhs,
        )

    return ParsedMathInput(kind="expression", source=raw, normalized_source=raw)


def _collect_call_names(source: str) -> set[str]:
    return {match.group(1) for match in _CALL_NAME_RE.finditer(source)}


def _collect_identifier_names(source: str) -> set[str]:
    return set(_IDENT_RE.findall(source))


def build_math_locals(
    source_parts: Iterable[str],
    *,
    mode: str,
    user_ns: Dict[str, Any],
) -> Dict[str, Any]:
    source = " ".join(source_parts)
    names = _collect_identifier_names(source)
    call_names = _collect_call_names(source)

    def _container_map(value: Any, fn: Any) -> Any:
        if isinstance(value, list):
            return [_container_map(item, fn) for item in value]
        if isinstance(value, tuple):
            return tuple(_container_map(item, fn) for item in value)
        if isinstance(value, dict):
            return {_container_map(k, fn): _container_map(v, fn) for k, v in value.items()}
        return fn(value)

    def N(value: Any, *args: Any, **kwargs: Any) -> Any:
        # SymPy's N() expects objects with evalf(); wrap it to support containers like solve(...) results.
        def _n(v: Any) -> Any:
            return sp.N(v, *args, **kwargs)

        try:
            return _container_map(value, _n)
        except Exception:
            return sp.N(value, *args, **kwargs)

    def _normalize_equations_for_solve(value: Any) -> Any:
        if isinstance(value, sp.Equality):
            return sp.simplify(value.lhs - value.rhs)
        if isinstance(value, list):
            return [_normalize_equations_for_solve(item) for item in value]
        if isinstance(value, tuple):
            return tuple(_normalize_equations_for_solve(item) for item in value)
        if isinstance(value, set):
            return {_normalize_equations_for_solve(item) for item in value}
        return value

    def solve(equations: Any, *args: Any, **kwargs: Any) -> Any:
        normalized = _normalize_equations_for_solve(equations)
        return sp.solve(normalized, *args, **kwargs)

    def subs(expr: Any, *args: Any, **kwargs: Any) -> Any:
        if hasattr(expr, "subs"):
            return expr.subs(*args, **kwargs)
        return expr

    mapping: Dict[str, Any] = {
        "sqrt": sp.sqrt,
        "sin": sp.sin,
        "cos": sp.cos,
        "tan": sp.tan,
        "asin": sp.asin,
        "acos": sp.acos,
        "atan": sp.atan,
        "log": sp.log,
        "ln": sp.log,
        "exp": sp.exp,
        "pow": sp.Pow,
        "abs": sp.Abs,
        "pi": sp.pi,
        "e": sp.E,
        "E": sp.E,
        "I": sp.I,
        "Eq": sp.Eq,
        "solve": solve,
        "subs": subs,
        "linsolve": sp.linsolve,
        "simplify": sp.simplify,
        "expand": sp.expand,
        "factor": sp.factor,
        "N": N,
        "math": sp,
    }

    plot_fn = user_ns.get("plot")
    if callable(plot_fn):
        mapping["plot"] = plot_fn
    else:
        try:
            from sugarpy.startup import plot as startup_plot
        except Exception:
            startup_plot = None
        if startup_plot is not None:
            mapping["plot"] = startup_plot

    if mode == "deg":
        def sind(x: Any, **_kwargs: Any) -> Any:
            return sp.sin(x * sp.pi / 180)

        def cosd(x: Any, **_kwargs: Any) -> Any:
            return sp.cos(x * sp.pi / 180)

        def tand(x: Any, **_kwargs: Any) -> Any:
            return sp.tan(x * sp.pi / 180)

        mapping.update({"sin": sind, "cos": cosd, "tan": tand})

    for name in names:
        if name in mapping:
            continue
        if name in user_ns:
            value = user_ns[name]
            if callable(value):
                mapping[name] = value
                continue
            if name in call_names:
                raise MathParseError(f"'{name}' is not callable. Define a function in a Code cell.")
            mapping[name] = value
            continue
        if name in call_names:
            mapping[name] = sp.Function(name)
        else:
            mapping[name] = sp.Symbol(name)
    return mapping


def parse_sympy_expression(source: str, *, mode: str, user_ns: Dict[str, Any]) -> Any:
    try:
        return parse_expr(
            source,
            local_dict=build_math_locals([source], mode=mode, user_ns=user_ns),
            transformations=_TRANSFORMS,
            evaluate=False,
        )
    except MathParseError:
        raise
    except Exception as exc:  # pragma: no cover - message normalized for UI
        raise MathParseError(f"Syntax error: {exc}") from exc
