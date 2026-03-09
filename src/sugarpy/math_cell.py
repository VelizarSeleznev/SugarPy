"""Math cell rendering helpers."""

from __future__ import annotations

import json
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Dict

import sympy as sp
from IPython import get_ipython
from collections.abc import Mapping

from .math_parser import MathParseError, RenderDirective, parse_math_input, parse_sympy_expression
from .utils import display_sugarpy


MATH_MIME_TYPE = "application/vnd.sugarpy.math+json"


def _as_latex(value: Any) -> str:
    try:
        return sp.latex(value)
    except Exception:
        return str(value)


def _finalize_value(value: Any) -> Any:
    """Finalize SymPy-native values while preserving container results from CAS calls."""
    if isinstance(value, sp.Basic):
        try:
            return value.doit()
        except Exception:
            return value
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
        "render_cache": None,
    }


def _make_render_cache(
    *,
    exact_steps: list[str],
    exact_value: str | None,
    decimal_steps: list[str] | None = None,
    decimal_value: str | None = None,
) -> Dict[str, Any]:
    return {
        "exact": {
            "steps": [str(step) for step in exact_steps],
            "value": exact_value,
        },
        "decimal": {
            "steps": [str(step) for step in (decimal_steps if decimal_steps is not None else exact_steps)],
            "value": decimal_value if decimal_value is not None else exact_value,
        },
    }


def _apply_decimal_places(value: Any, places: int) -> Any:
    if isinstance(value, list):
        return [_apply_decimal_places(item, places) for item in value]
    if isinstance(value, tuple):
        return tuple(_apply_decimal_places(item, places) for item in value)
    if isinstance(value, set):
        return {_apply_decimal_places(item, places) for item in value}
    if isinstance(value, dict):
        return {_apply_decimal_places(k, places): _apply_decimal_places(v, places) for k, v in value.items()}

    if isinstance(value, sp.Basic):
        try:
            if value.is_real:
                # Keep decimal rendering responsive for large symbolic roots by avoiding
                # unnecessarily high evalf precision during display-only conversion.
                numeric = sp.N(value, max(places + 4, 8))
                quant = Decimal("1").scaleb(-places)
                rounded = Decimal(str(numeric)).quantize(quant, rounding=ROUND_HALF_UP)
                return sp.Float(str(rounded))
            return sp.N(value, max(places + 4, 8))
        except Exception:
            return value

    if isinstance(value, (int, float)):
        try:
            quant = Decimal("1").scaleb(-places)
            rounded = Decimal(str(value)).quantize(quant, rounding=ROUND_HALF_UP)
            return float(rounded)
        except Exception:
            return value

    return value


def _render_directive(directive: RenderDirective) -> tuple[str, Any]:
    if directive.mode == "exact":
        base_value = _finalize_value(directive.value)
        return _as_latex(base_value), base_value

    places = directive.places if directive.places is not None else 4
    base_value = _finalize_value(directive.value)
    decimal_value = _apply_decimal_places(base_value, places)
    return _as_latex(decimal_value), base_value


def _assignment_targets(parsed: Any) -> tuple[str, ...]:
    names = tuple(getattr(parsed, "assigned_names", ()) or ())
    if names:
        return names
    legacy = getattr(parsed, "assigned_name", None)
    return (legacy,) if legacy else ()


def _make_math_function(
    name: str,
    args: tuple[str, ...],
    rhs_source: str,
    *,
    mode: str,
    user_ns: Dict[str, Any],
):
    def _fn(*values: Any) -> Any:
        if len(values) != len(args):
            raise TypeError(f"{name} expects {len(args)} arguments, got {len(values)}.")
        local_ns = dict(user_ns)
        for arg, val in zip(args, values):
            local_ns[arg] = val
        evaluated = parse_sympy_expression(rhs_source, mode=mode, user_ns=local_ns)
        if isinstance(evaluated, RenderDirective):
            raise MathParseError("render_decimal/render_exact cannot be returned from function definition.")
        return _finalize_value(evaluated)

    _fn.__name__ = name
    _fn._sugarpy_math_function = {  # type: ignore[attr-defined]
        "name": name,
        "args": args,
        "body_source": rhs_source,
        "mode": mode,
    }
    user_ns[name] = _fn
    return _fn


def _unpack_assignment_values(targets: tuple[str, ...], value_expr: Any) -> list[Any]:
    if len(targets) == 1:
        return [value_expr]

    if isinstance(value_expr, (list, tuple, sp.Tuple)):
        values = list(value_expr)
    else:
        raise MathParseError(
            "Right side of ':=' is not unpackable. Use a list/tuple when assigning multiple names."
        )
    if len(values) != len(targets):
        raise MathParseError(
            f"Unpack mismatch: expected {len(targets)} values, got {len(values)}."
        )
    return values


def _resolve_render_mode(render_mode: str | None) -> str:
    if render_mode in {"exact", "decimal"}:
        return render_mode
    return "exact"


def _current_decimal_places(user_ns: Dict[str, Any]) -> int:
    try:
        places = int(user_ns.get("__sugarpy_decimal_places", 4))
    except Exception:
        places = 4
    return min(max(places, 0), 12)


def _split_top_level_args(source: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False
    for ch in source:
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

        if ch == "," and depth == 0:
            parts.append("".join(buf).strip())
            buf = []
            continue

        buf.append(ch)

    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _extract_render_wrapper(source: str) -> tuple[str, list[str]] | None:
    trimmed = source.strip()
    for wrapper_name in ("render_decimal", "render_exact"):
        prefix = f"{wrapper_name}("
        if not trimmed.startswith(prefix):
            continue
        if len(trimmed) <= len(prefix) or not trimmed.endswith(")"):
            continue

        depth = 0
        quote: str | None = None
        escaped = False
        close_idx = -1
        for idx, ch in enumerate(trimmed):
            if quote is not None:
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
                continue
            if ch == "(":
                depth += 1
                continue
            if ch == ")":
                depth -= 1
                if depth == 0:
                    close_idx = idx
                    break
                continue

        if close_idx != len(trimmed) - 1:
            continue
        args_source = trimmed[len(prefix):close_idx]
        args = _split_top_level_args(args_source)
        return wrapper_name, args
    return None


def _resolve_decimal_places_arg(source: str | None, mode: str, user_ns: Dict[str, Any]) -> int:
    if not source:
        return _current_decimal_places(user_ns)
    try:
        value = parse_sympy_expression(source, mode=mode, user_ns=user_ns)
        return min(max(int(value), 0), 12)
    except Exception:
        return _current_decimal_places(user_ns)


def _render_wrapper_assignment(
    *,
    source: str,
    mode: str,
    user_ns: Dict[str, Any],
) -> Dict[str, Any] | None:
    wrapper_call = _extract_render_wrapper(source)
    if wrapper_call is None:
        return None
    wrapper_name, args = wrapper_call
    if not args:
        return None
    if wrapper_name == "render_exact" and len(args) != 1:
        return None
    if wrapper_name == "render_decimal" and len(args) > 3:
        return None

    inner_source = args[0]
    places_source: str | None = None
    if wrapper_name == "render_decimal":
        if len(args) == 2:
            if ":=" in args[1] and ":=" not in args[0]:
                # Support ergonomic form: render_decimal(x, y := expr)
                inner_source = f"{args[0]}, {args[1]}"
            else:
                places_source = args[1]
        elif len(args) == 3:
            if ":=" in args[1] and ":=" not in args[0]:
                # Support ergonomic form: render_decimal(x, y := expr, places)
                inner_source = f"{args[0]}, {args[1]}"
                places_source = args[2]
            else:
                return None

    try:
        inner_parsed = parse_math_input(inner_source)
    except MathParseError:
        return None
    if inner_parsed.kind != "assignment":
        return None

    inner_result = _render_single_math(inner_source, mode, user_ns, render_mode="exact")
    if not inner_result.get("ok"):
        return inner_result

    targets = _assignment_targets(inner_parsed)
    if not targets:
        return inner_result
    assigned_values = [_finalize_value(user_ns[name]) for name in targets]
    if wrapper_name == "render_decimal":
        places = _resolve_decimal_places_arg(places_source, mode, user_ns)
        rendered_values = [_apply_decimal_places(item, places) for item in assigned_values]
    else:
        rendered_values = assigned_values

    if len(rendered_values) == 1:
        value_latex = _as_latex(rendered_values[0])
    else:
        value_latex = _as_latex(sp.Tuple(*rendered_values))

    steps = [
        f"{sp.latex(sp.Symbol(name))} = {_as_latex(rendered)}"
        for name, rendered in zip(targets, rendered_values)
    ]

    return {
        "ok": True,
        "kind": "assignment",
        "steps": steps,
        "value": value_latex,
        "assigned": targets[0] if len(targets) == 1 else ", ".join(targets),
        "mode": mode,
        "error": None,
        "warnings": inner_result.get("warnings") or [],
        "normalized_source": source.strip(),
        "equation_latex": None,
        "plotly_figure": None,
        "trace": [],
        "render_cache": _make_render_cache(
            exact_steps=steps,
            exact_value=value_latex,
        ),
    }


def _render_single_math(source: str, mode: str, user_ns: Dict[str, Any], render_mode: str | None = None) -> Dict[str, Any]:
    resolved_render_mode = _resolve_render_mode(render_mode)
    try:
        parsed = parse_math_input(source)
    except MathParseError as exc:
        return _error_payload(source, mode, str(exc))

    warnings = list(parsed.warnings)

    try:
        if parsed.kind == "function_assignment":
            function_name = parsed.function_name or parsed.assigned_name or ""
            function_args = parsed.function_args or ()
            if not function_name:
                raise MathParseError("Function name is missing.")
            rhs_source = parsed.rhs_source or ""
            rhs_parsed = parse_math_input(rhs_source)
            if rhs_parsed.kind in {"assignment", "function_assignment"}:
                raise MathParseError("Right side of function ':=' must be a single expression or equation.")
            _make_math_function(function_name, function_args, rhs_source, mode=mode, user_ns=user_ns)
            fn_symbol = (
                sp.Function(function_name)(*(sp.Symbol(arg) for arg in function_args))
                if function_args
                else sp.Symbol(function_name)
            )
            value_latex = f"{_as_latex(fn_symbol)}\\ :=\\ \\text{{defined}}"
            return {
                "ok": True,
                "kind": "assignment",
                "steps": [value_latex],
                "value": value_latex,
                "assigned": function_name,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": None,
                "trace": [],
                "render_cache": _make_render_cache(
                    exact_steps=[value_latex],
                    exact_value=value_latex,
                ),
            }

        if parsed.kind == "assignment":
            targets = _assignment_targets(parsed)
            if not targets:
                raise MathParseError("Assignment target is missing.")
            rhs_source = parsed.rhs_source or ""
            rhs_parsed = parse_math_input(rhs_source)
            rendered_assignment = False
            assign_label = ", ".join(sp.latex(sp.Symbol(name)) for name in targets)
            if rhs_parsed.kind == "assignment":
                raise MathParseError("Right side of ':=' cannot contain another ':=' assignment.")

            if rhs_parsed.kind == "equation":
                lhs_expr = parse_sympy_expression(rhs_parsed.lhs_source or "", mode=mode, user_ns=user_ns)
                rhs_expr = parse_sympy_expression(rhs_parsed.rhs_source or "", mode=mode, user_ns=user_ns)
                equation = sp.Eq(lhs_expr, rhs_expr, evaluate=False)
                value_expr = sp.simplify(lhs_expr - rhs_expr)
                warnings.append("Equation assignments are stored in '=0' expression form for solve compatibility.")
                steps = [
                    f"{assign_label} = {_as_latex(equation)}",
                    f"{assign_label} = {_as_latex(value_expr)}",
                ]
            else:
                value_expr = parse_sympy_expression(rhs_source, mode=mode, user_ns=user_ns)
                if isinstance(value_expr, RenderDirective):
                    value_latex, stored_value = _render_directive(value_expr)
                    steps = [f"{assign_label} = {value_latex}"]
                    value_expr = stored_value
                    rendered_assignment = True
                else:
                    steps = [f"{assign_label} = {_as_latex(value_expr)}"]
            value_expr = _finalize_value(value_expr)
            assigned_values = _unpack_assignment_values(targets, value_expr)
            finalized_values = [_finalize_value(item) for item in assigned_values]
            for name, assigned_value in zip(targets, finalized_values):
                user_ns[name] = assigned_value

            if resolved_render_mode == "decimal":
                places = _current_decimal_places(user_ns)
                rendered_values = [_apply_decimal_places(item, places) for item in finalized_values]
            else:
                rendered_values = finalized_values

            exact_rendered_values = finalized_values
            decimal_rendered_values = [_apply_decimal_places(item, _current_decimal_places(user_ns)) for item in finalized_values]

            if len(targets) == 1:
                value_latex = _as_latex(rendered_values[0])
            else:
                value_latex = _as_latex(sp.Tuple(*rendered_values))

            exact_value_latex = _as_latex(exact_rendered_values[0]) if len(targets) == 1 else _as_latex(sp.Tuple(*exact_rendered_values))
            decimal_value_latex = _as_latex(decimal_rendered_values[0]) if len(targets) == 1 else _as_latex(sp.Tuple(*decimal_rendered_values))

            final_steps = [
                f"{sp.latex(sp.Symbol(name))} = {_as_latex(rendered)}"
                for name, rendered in zip(targets, rendered_values)
            ]
            exact_final_steps = [
                f"{sp.latex(sp.Symbol(name))} = {_as_latex(rendered)}"
                for name, rendered in zip(targets, exact_rendered_values)
            ]
            decimal_final_steps = [
                f"{sp.latex(sp.Symbol(name))} = {_as_latex(rendered)}"
                for name, rendered in zip(targets, decimal_rendered_values)
            ]
            exact_steps_cache = list(steps)
            if not rendered_assignment:
                if len(exact_final_steps) == 1:
                    if exact_steps_cache[-1] != exact_final_steps[0]:
                        exact_steps_cache.append(exact_final_steps[0])
                else:
                    exact_steps_cache = exact_final_steps
            if resolved_render_mode == "decimal" and not rendered_assignment:
                # In decimal display mode, keep assignment output concise and avoid duplicating exact+decimal lines.
                steps = final_steps
            elif not rendered_assignment:
                if len(final_steps) == 1:
                    if steps[-1] != final_steps[0]:
                        steps.append(final_steps[0])
                else:
                    steps = final_steps
            return {
                "ok": True,
                "kind": "assignment",
                "steps": steps,
                "value": value_latex,
                "assigned": targets[0] if len(targets) == 1 else ", ".join(targets),
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": None,
                "trace": [],
                "render_cache": _make_render_cache(
                    exact_steps=exact_steps_cache,
                    exact_value=exact_value_latex,
                    decimal_steps=decimal_final_steps if not rendered_assignment else steps,
                    decimal_value=decimal_value_latex,
                ),
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
                "render_cache": _make_render_cache(
                    exact_steps=[equation_latex],
                    exact_value=equation_latex,
                ),
            }

        wrapper_assignment_result = _render_wrapper_assignment(source=parsed.source, mode=mode, user_ns=user_ns)
        if wrapper_assignment_result is not None:
            return wrapper_assignment_result

        expr = parse_sympy_expression(parsed.source, mode=mode, user_ns=user_ns)
        if isinstance(expr, RenderDirective):
            rendered_value, _stored = _render_directive(expr)
            return {
                "ok": True,
                "kind": "expression",
                "steps": [rendered_value],
                "value": rendered_value,
                "assigned": None,
                "mode": mode,
                "error": None,
                "warnings": warnings,
                "normalized_source": parsed.normalized_source,
                "equation_latex": None,
                "plotly_figure": None,
                "trace": [],
                "render_cache": _make_render_cache(
                    exact_steps=[rendered_value],
                    exact_value=rendered_value,
                ),
            }
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
                "render_cache": _make_render_cache(exact_steps=[], exact_value=None),
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
                "render_cache": _make_render_cache(
                    exact_steps=steps,
                    exact_value=None,
                ),
            }
        value_expr = _finalize_value(expr)
        decimal_value_expr = _apply_decimal_places(value_expr, _current_decimal_places(user_ns))
        if resolved_render_mode == "decimal":
            places = _current_decimal_places(user_ns)
            value_latex = _as_latex(_apply_decimal_places(value_expr, places))
        else:
            value_latex = _as_latex(value_expr)
        exact_value_latex = _as_latex(value_expr)
        decimal_value_latex = _as_latex(decimal_value_expr)
        exact_steps_cache = list(steps)
        if exact_steps_cache[-1] != exact_value_latex:
            exact_steps_cache.append(exact_value_latex)
        decimal_steps_cache = [decimal_value_latex]
        if resolved_render_mode == "decimal":
            # In decimal display mode, show only the decimal-rendered result.
            steps = [value_latex]
        elif steps[-1] != value_latex:
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
            "render_cache": _make_render_cache(
                exact_steps=exact_steps_cache,
                exact_value=exact_value_latex,
                decimal_steps=decimal_steps_cache,
                decimal_value=decimal_value_latex,
            ),
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


def render_math_cell(source: str, mode: str = "deg", render_mode: str | None = None) -> Dict[str, Any]:
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
        result = _render_single_math(statement, mode, user_ns, render_mode=render_mode)
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
                "render_cache": result.get("render_cache"),
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
        "render_cache": last_result.get("render_cache"),
    }


def render_math_cell_json(source: str, mode: str = "deg", render_mode: str | None = None) -> str:
    """Return JSON for frontend consumption."""
    return json.dumps(render_math_cell(source, mode, render_mode=render_mode))


def display_math_cell(source: str, mode: str = "deg", render_mode: str | None = None) -> Dict[str, Any]:
    """Render Math cell and send structured payload via Jupyter MIME output."""
    payload = render_math_cell(source, mode, render_mode=render_mode)
    display_sugarpy({**payload, "schema_version": 1}, MATH_MIME_TYPE)
    return payload
