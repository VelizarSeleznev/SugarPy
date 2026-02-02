"""Math cell rendering helpers."""

from __future__ import annotations

import ast
import json
from typing import Any, Dict, Iterable

import sympy as sp
from IPython import get_ipython
from sympy.parsing.sympy_parser import (
    implicit_multiplication_application,
    standard_transformations,
    parse_expr,
)


_TRANSFORMS = standard_transformations + (implicit_multiplication_application,)
_ALLOWED_MATH_NAMES = {
    "sqrt",
    "sin",
    "cos",
    "tan",
    "asin",
    "acos",
    "atan",
    "log",
    "ln",
    "exp",
    "pow",
    "abs",
    "pi",
    "e",
    "math",
}


def _collect_names(node: ast.AST) -> set[str]:
    return {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}


def _sympy_locals(names: Iterable[str]) -> Dict[str, Any]:
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
        "math": sp,
    }
    for name in names:
        mapping.setdefault(name, sp.Symbol(name))
    return mapping


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float, complex, sp.Number))


def _sympy_locals_with_mode(names: Iterable[str], mode: str) -> Dict[str, Any]:
    mapping = _sympy_locals(names)
    if mode == "deg":
        def sind(x: Any, **_kwargs: Any) -> Any:
            return sp.sin(x * sp.pi / 180)

        def cosd(x: Any, **_kwargs: Any) -> Any:
            return sp.cos(x * sp.pi / 180)

        def tand(x: Any, **_kwargs: Any) -> Any:
            return sp.tan(x * sp.pi / 180)

        mapping.update({"sin": sind, "cos": cosd, "tan": tand})
    return mapping


def render_math_cell(source: str, mode: str = "deg") -> Dict[str, Any]:
    """Render a single math expression and compute its value."""
    src = (source or "").strip()
    if not src:
        return {"ok": False, "steps": [], "value": None, "assigned": None, "mode": mode, "error": "Empty cell."}

    try:
        tree = ast.parse(src, mode="exec")
    except SyntaxError as exc:
        return {
            "ok": False,
            "steps": [],
            "value": None,
            "assigned": None,
            "mode": mode,
            "error": f"Syntax error: {exc.msg}",
        }

    if len(tree.body) != 1:
        return {
            "ok": False,
            "steps": [],
            "value": None,
            "assigned": None,
            "mode": mode,
            "error": "Use a single expression or assignment.",
        }

    stmt = tree.body[0]
    assigned = None
    expr_node = None
    if isinstance(stmt, ast.Assign):
        if len(stmt.targets) != 1 or not isinstance(stmt.targets[0], ast.Name):
            return {
                "ok": False,
                "steps": [],
                "value": None,
                "assigned": None,
                "mode": mode,
                "error": "Only simple assignments like `b = ...` are supported.",
            }
        assigned = stmt.targets[0].id
        expr_node = stmt.value
    elif isinstance(stmt, ast.Expr):
        expr_node = stmt.value
    else:
        return {
            "ok": False,
            "steps": [],
            "value": None,
            "assigned": None,
            "mode": mode,
            "error": "Only expressions or assignments are supported.",
        }

    expr_code = ast.unparse(expr_node)
    names = _collect_names(expr_node)

    ip = get_ipython()
    user_ns: Dict[str, Any] = ip.user_ns if ip is not None else {}

    steps: list[str] = []
    sym_expr = None
    base = None
    try:
        sym_expr = parse_expr(
            expr_code,
            local_dict=_sympy_locals_with_mode(names, mode),
            transformations=_TRANSFORMS,
            evaluate=False,
        )
        base = sp.latex(sym_expr)
    except Exception:
        base = expr_code

    if assigned:
        steps.append(f"{sp.latex(sp.Symbol(assigned))} = {base}")
    else:
        steps.append(base)

    subs: Dict[Any, Any] = {}
    sub_expr = sym_expr
    if sym_expr is not None:
        for name in names:
            if name in user_ns and _is_number(user_ns[name]):
                subs[sp.Symbol(name)] = user_ns[name]
        if subs:
            sub_expr = sym_expr.subs(subs)
            sub_latex = sp.latex(sub_expr)
            if sub_latex != base:
                if assigned:
                    steps.append(f"{sp.latex(sp.Symbol(assigned))} = {sub_latex}")
                else:
                    steps.append(sub_latex)

    unknown_names = {name for name in names if name not in user_ns and name not in _ALLOWED_MATH_NAMES}
    if unknown_names:
        return {
            "ok": True,
            "steps": steps,
            "value": None,
            "assigned": assigned,
            "mode": mode,
            "error": None,
        }

    if sub_expr is None:
        return {
            "ok": False,
            "steps": steps,
            "value": None,
            "assigned": assigned,
            "mode": mode,
            "error": "Unable to parse expression.",
        }

    if sub_expr.free_symbols:
        return {
            "ok": True,
            "steps": steps,
            "value": None,
            "assigned": assigned,
            "mode": mode,
            "error": None,
        }

    try:
        value_expr = sp.simplify(sub_expr)
    except Exception as exc:
        return {
            "ok": False,
            "steps": steps,
            "value": None,
            "assigned": assigned,
            "mode": mode,
            "error": f"{type(exc).__name__}: {exc}",
        }

    if assigned and ip is not None:
        ip.user_ns[assigned] = value_expr

    try:
        value_latex = sp.latex(value_expr)
    except Exception:
        value_latex = str(value_expr)

    if assigned:
        final_step = f"{sp.latex(sp.Symbol(assigned))} = {value_latex}"
    else:
        final_step = value_latex

    if not steps or steps[-1] != final_step:
        steps.append(final_step)

    return {
        "ok": True,
        "steps": steps,
        "value": value_latex,
        "assigned": assigned,
        "mode": mode,
        "error": None,
    }


def render_math_cell_json(source: str, mode: str = "deg") -> str:
    """Return JSON for frontend consumption."""
    return json.dumps(render_math_cell(source, mode))
