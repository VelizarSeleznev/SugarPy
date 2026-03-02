"""Math cell rendering helpers."""

from __future__ import annotations

import json
from typing import Any, Dict

import sympy as sp
from IPython import get_ipython
from collections.abc import Mapping

from .math_parser import MathParseError, parse_math_input, parse_sympy_expression


def _as_latex(value: Any) -> str:
    try:
        return sp.latex(value)
    except Exception:
        return str(value)


def _finalize_value(value: Any) -> Any:
    """Simplify SymPy-native values while preserving container results from CAS calls."""
    if isinstance(value, sp.Basic):
        return sp.simplify(value)
    if isinstance(value, list):
        return [_finalize_value(item) for item in value]
    if isinstance(value, tuple):
        return tuple(_finalize_value(item) for item in value)
    if isinstance(value, dict):
        return {_finalize_value(k): _finalize_value(v) for k, v in value.items()}
    return value


def _error_payload(source: str, mode: str, error: str, kind: str = "expression") -> Dict[str, Any]:
    return {
        "ok": False,
        "kind": kind,
        "steps": [],
        "value": None,
        "assigned": None,
        "mode": mode,
        "error": error,
        "warnings": [],
        "normalized_source": (source or "").strip(),
        "equation_latex": None,
        "plotly_figure": None,
        "trace": [],
    }


def _render_single_math(source: str, mode: str, user_ns: Dict[str, Any]) -> Dict[str, Any]:
    try:
        parsed = parse_math_input(source)
    except MathParseError as exc:
        return _error_payload(source, mode, str(exc))

    warnings = list(parsed.warnings)

    try:
        if parsed.kind == "assignment":
            target = parsed.assigned_name or ""
            rhs_source = parsed.rhs_source or ""
            rhs_parsed = parse_math_input(rhs_source)
            if rhs_parsed.kind == "assignment":
                raise MathParseError("Right side of ':=' cannot contain another ':=' assignment.")

            if rhs_parsed.kind == "equation":
                lhs_expr = parse_sympy_expression(rhs_parsed.lhs_source or "", mode=mode, user_ns=user_ns)
                rhs_expr = parse_sympy_expression(rhs_parsed.rhs_source or "", mode=mode, user_ns=user_ns)
                equation = sp.Eq(lhs_expr, rhs_expr, evaluate=False)
                value_expr = sp.simplify(lhs_expr - rhs_expr)
                warnings.append("Equation assignments are stored in '=0' expression form for solve compatibility.")
                steps = [
                    f"{sp.latex(sp.Symbol(target))} = {_as_latex(equation)}",
                    f"{sp.latex(sp.Symbol(target))} = {_as_latex(value_expr)}",
                ]
            else:
                value_expr = parse_sympy_expression(rhs_source, mode=mode, user_ns=user_ns)
                steps = [f"{sp.latex(sp.Symbol(target))} = {_as_latex(value_expr)}"]
            value_expr = _finalize_value(value_expr)
            user_ns[target] = value_expr
            value_latex = _as_latex(value_expr)
            final_step = f"{sp.latex(sp.Symbol(target))} = {value_latex}"
            if steps[-1] != final_step:
                steps.append(final_step)
            return {
                "ok": True,
                "kind": "assignment",
                "steps": steps,
                "value": value_latex,
                "assigned": target,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": None,
                "trace": [],
            }

        if parsed.kind == "equation":
            lhs_expr = parse_sympy_expression(parsed.lhs_source or "", mode=mode, user_ns=user_ns)
            rhs_expr = parse_sympy_expression(parsed.rhs_source or "", mode=mode, user_ns=user_ns)
            equation = sp.Eq(lhs_expr, rhs_expr, evaluate=False)
            equation_latex = _as_latex(equation)
            return {
                "ok": True,
                "kind": "equation",
                "steps": [equation_latex],
                "value": equation_latex,
                "assigned": None,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": equation_latex,
                "plotly_figure": None,
                "trace": [],
            }

        expr = parse_sympy_expression(parsed.source, mode=mode, user_ns=user_ns)
        if isinstance(expr, Mapping) and "data" in expr and "layout" in expr:
            # plot(...) returns a Plotly-compatible figure dict and also emits MIME output.
            # Do not feed the dict into KaTeX as a math step; instead attach it for the UI.
            figure = dict(expr) if not isinstance(expr, dict) else expr
            return {
                "ok": True,
                "kind": "expression",
                "steps": [],
                "value": None,
                "assigned": None,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": figure,
                "trace": [],
            }
        base = _as_latex(expr)
        steps = [base]
        if isinstance(expr, sp.Basic) and getattr(expr, "free_symbols", None):
            return {
                "ok": True,
                "kind": "expression",
                "steps": steps,
                "value": None,
                "assigned": None,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": None,
                "trace": [],
            }
        value_expr = _finalize_value(expr)
        value_latex = _as_latex(value_expr)
        if steps[-1] != value_latex:
            steps.append(value_latex)
        return {
            "ok": True,
            "kind": "expression",
            "steps": steps,
            "value": value_latex,
            "assigned": None,
            "mode": mode,
            "error": None,
            "warnings": warnings,
            "normalized_source": parsed.normalized_source,
            "equation_latex": None,
            "plotly_figure": None,
            "trace": [],
        }
    except MathParseError as exc:
        return _error_payload(source, mode, str(exc), kind=parsed.kind)
    except Exception as exc:
        return _error_payload(source, mode, f"{type(exc).__name__}: {exc}", kind=parsed.kind)


def _split_math_statements(source: str) -> list[tuple[int, str]]:
    """Split a Math cell into top-level statements.

    Rules:
    - New statement starts on newline only when not inside quotes and bracket depth is 0.
    - Preserves 1-based starting line number for each statement.
    """
    statements: list[tuple[int, str]] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False
    line_no = 1
    stmt_start_line = 1

    def flush(next_start_line: int) -> None:
        nonlocal stmt_start_line
        text = "".join(buf).strip()
        buf.clear()
        if text:
            statements.append((stmt_start_line, text))
        stmt_start_line = next_start_line

    for ch in source:
        if ch == "\n":
            if quote is None and depth == 0:
                flush(line_no + 1)
            else:
                buf.append(ch)
            line_no += 1
            continue

        if quote is not None:
            buf.append(ch)
            if escaped:
                escaped = False
                continue
            if ch == "\\":
                escaped = True
                continue
            if ch == quote:
                quote = None
            continue

        if ch in {"'", '"'}:
            quote = ch
            buf.append(ch)
            continue

        if ch in "([{":
            depth += 1
            buf.append(ch)
            continue
        if ch in ")]}":
            depth -= 1
            buf.append(ch)
            continue

        buf.append(ch)

    flush(line_no)
    return statements


def render_math_cell(source: str, mode: str = "deg") -> Dict[str, Any]:
    """Render CAS-style input and compute its value."""
    ip = get_ipython()
    user_ns: Dict[str, Any] = ip.user_ns if ip is not None else {}

    raw = (source or "")
    trimmed = raw.strip()
    if not raw:
        return _error_payload(source, mode, "Empty cell.")

    statements = _split_math_statements(trimmed)
    if not statements:
        return _error_payload(source, mode, "Empty cell.")

    merged_steps: list[str] = []
    merged_warnings: list[str] = []
    normalized_sources: list[str] = []
    plotly_figure: Any | None = None
    last_result: Dict[str, Any] | None = None
    trace: list[Dict[str, Any]] = []

    for line_start, statement in statements:
        result = _render_single_math(statement, mode, user_ns)
        if not result.get("ok"):
            err = result.get("error") or "Unknown error"
            payload = _error_payload(source, mode, f"Line {line_start}: {err}", kind=result.get("kind") or "expression")
            payload["trace"] = trace
            payload["steps"] = merged_steps
            payload["warnings"] = merged_warnings
            payload["plotly_figure"] = plotly_figure
            return payload

        trace.append(
            {
                "line_start": line_start,
                "source": statement,
                "kind": result.get("kind"),
                "steps": result.get("steps") or [],
                "value": result.get("value"),
                "plotly_figure": result.get("plotly_figure"),
            }
        )
        merged_steps.extend(str(step) for step in (result.get("steps") or []))
        merged_warnings.extend(str(w) for w in (result.get("warnings") or []))
        if result.get("plotly_figure") is not None:
            plotly_figure = result.get("plotly_figure")
        normalized = result.get("normalized_source")
        if normalized:
            normalized_sources.append(str(normalized))
        last_result = result

    if last_result is None:
        return _error_payload(source, mode, "Empty cell.")

    return {
        "ok": True,
        "kind": last_result.get("kind", "expression"),
        "steps": merged_steps,
        "value": last_result.get("value"),
        "assigned": last_result.get("assigned"),
        "mode": mode,
        "error": None,
        "warnings": merged_warnings,
        "normalized_source": "\n".join(normalized_sources) if normalized_sources else raw,
        "equation_latex": last_result.get("equation_latex"),
        "plotly_figure": plotly_figure,
        "trace": trace,
    }


def render_math_cell_json(source: str, mode: str = "deg") -> str:
    """Return JSON for frontend consumption."""
    return json.dumps(render_math_cell(source, mode))
