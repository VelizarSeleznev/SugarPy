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
_PLOT_KWARG_NAMES = {
    "xmin",
    "xmax",
    "ymin",
    "ymax",
    "start",
    "end",
    "samples",
    "num",
    "title",
    "overscan",
    "equal_axes",
    "showlegend",
    "var",
}
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
    kind: Literal["assignment", "function_assignment", "equation", "expression"]
    source: str
    normalized_source: str
    lhs_source: str | None = None
    rhs_source: str | None = None
    assigned_name: str | None = None
    assigned_names: tuple[str, ...] = ()
    assignment_target_tree: Any = None
    function_name: str | None = None
    function_args: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class RenderDirective:
    value: Any
    mode: Literal["decimal", "exact"]
    places: int | None = None


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


def _split_top_level_commas(source: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    quote: str | None = None
    escaped = False
    for ch in source:
        if quote:
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

    parts.append("".join(buf).strip())
    return [part for part in parts if part]


def _strip_enclosing_group(source: str) -> str:
    trimmed = source.strip()
    while trimmed and trimmed[0] in "([{" and _find_matching_bracket(trimmed, 0) == len(trimmed) - 1:
        trimmed = trimmed[1:-1].strip()
    return trimmed


def _find_matching_bracket(source: str, start: int) -> int:
    pairs = {"(": ")", "[": "]", "{": "}"}
    opener = source[start]
    closer = pairs.get(opener)
    if closer is None:
        raise MathParseError("Unsupported bracket.")

    depth = 1
    quote: str | None = None
    escaped = False
    i = start + 1
    while i < len(source):
        ch = source[i]
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
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise MathParseError("Unclosed bracket in expression.")


def _wrap_equation_expression(source: str) -> str:
    try:
        parsed = parse_math_input(source)
    except MathParseError:
        return source
    if parsed.kind != "equation":
        return source
    lhs = parsed.lhs_source or ""
    rhs = parsed.rhs_source or ""
    return f"Eq({lhs}, {rhs})"


def _rewrite_inline_equations(source: str, *, nested: bool = False) -> str:
    parts = _split_top_level_commas(source)
    rewritten_parts: list[str] = []

    for part in parts:
        buf: list[str] = []
        i = 0
        while i < len(part):
            ch = part[i]
            if ch in "([{":
                close_idx = _find_matching_bracket(part, i)
                inner = part[i + 1 : close_idx]
                rewritten_inner = _rewrite_inline_equations(inner, nested=True)
                buf.append(ch)
                buf.append(rewritten_inner)
                buf.append(part[close_idx])
                i = close_idx + 1
                continue
            buf.append(ch)
            i += 1
        rewritten = "".join(buf).strip()
        if nested:
            rewritten = _wrap_equation_expression(rewritten)
        rewritten_parts.append(rewritten)

    return ", ".join(rewritten_parts)


def _find_top_level_range(source: str) -> int | None:
    depth = 0
    quote: str | None = None
    escaped = False
    i = 0
    while i < len(source) - 1:
        ch = source[i]
        nxt = source[i + 1]
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
            i += 1
            continue
        if depth == 0 and ch == "." and nxt == ".":
            return i
        i += 1
    return None


def _parse_plot_option_arg(arg: str) -> list[str] | None:
    marks = _scan_top_level(arg)
    if len(marks["equation"]) != 1 or marks["assignment"]:
        return None
    idx = marks["equation"][0]
    lhs = arg[:idx].strip()
    rhs = arg[idx + 1 :].strip()
    if not _ASSIGN_TARGET_RE.match(lhs) or not rhs:
        return None

    range_idx = _find_top_level_range(rhs)
    if range_idx is not None:
        range_start = rhs[:range_idx].strip()
        range_end = rhs[range_idx + 2 :].strip()
        if not range_start or not range_end:
            return None
        if lhs == "x":
            return [f"xmin={range_start}", f"xmax={range_end}"]
        if lhs == "y":
            return [f"ymin={range_start}", f"ymax={range_end}"]
        return [f"var={lhs}", f"start={range_start}", f"end={range_end}"]

    if lhs in _PLOT_KWARG_NAMES:
        return [f"{lhs}={rhs}"]
    return None


def _rewrite_plot_call_source(source: str) -> str:
    trimmed = source.strip()
    prefix = "plot("
    if not trimmed.startswith(prefix) or not trimmed.endswith(")"):
        return source

    close_idx = _find_matching_bracket(trimmed, len(prefix) - 1)
    if close_idx != len(trimmed) - 1:
        return source

    inner = trimmed[len(prefix):close_idx]
    args = _split_top_level_commas(inner)
    rewritten_args: list[str] = []
    for arg in args:
        stripped_arg = arg.strip()
        option_args = _parse_plot_option_arg(stripped_arg)
        if option_args is not None:
            rewritten_args.extend(option_args)
            continue
        rewritten_arg = _rewrite_plot_call_source(stripped_arg) if stripped_arg.startswith("plot(") else _rewrite_inline_equations(stripped_arg, nested=True)
        rewritten_args.append(rewritten_arg)
    return f"plot({', '.join(rewritten_args)})"


def _flatten_assignment_target_tree(target_tree: Any) -> tuple[str, ...]:
    if isinstance(target_tree, str):
        return (target_tree,)
    flattened: list[str] = []
    for item in target_tree:
        flattened.extend(_flatten_assignment_target_tree(item))
    return tuple(flattened)


def _parse_assignment_target_tree(lhs: str) -> Any:
    trimmed = lhs.strip()
    if not trimmed:
        raise MathParseError("Left side of ':=' must define at least one variable name.")
    ungrouped = _strip_enclosing_group(trimmed)
    parts = _split_top_level_commas(ungrouped)
    if len(parts) > 1:
        return tuple(_parse_assignment_target_tree(part) for part in parts)
    if _ASSIGN_TARGET_RE.match(ungrouped):
        return ungrouped
    raise MathParseError(
        "Left side of ':=' must be a variable name or comma-separated variable names."
    )


def _parse_assignment_targets(lhs: str) -> tuple[tuple[str, ...], Any]:
    target_tree = _parse_assignment_target_tree(lhs)
    targets = _flatten_assignment_target_tree(target_tree)
    if not targets:
        raise MathParseError("Left side of ':=' must define at least one variable name.")
    if len(set(targets)) != len(targets):
        raise MathParseError("Duplicate names are not allowed on assignment left side.")
    return targets, target_tree


def _parse_function_target(lhs: str) -> tuple[str, tuple[str, ...]] | None:
    trimmed = lhs.strip()
    open_idx = trimmed.find("(")
    close_idx = trimmed.rfind(")")
    if open_idx <= 0 or close_idx != len(trimmed) - 1:
        return None
    name = trimmed[:open_idx].strip()
    if not _ASSIGN_TARGET_RE.match(name):
        return None
    raw_args = trimmed[open_idx + 1 : close_idx].strip()
    if not raw_args:
        return name, ()
    args = tuple(_split_top_level_commas(raw_args))
    if not args:
        return name, ()
    for arg in args:
        if not _ASSIGN_TARGET_RE.match(arg):
            raise MathParseError("Function arguments must be simple variable names.")
    if len(set(args)) != len(args):
        raise MathParseError("Duplicate function argument names are not allowed.")
    return name, args


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
        function_target = _parse_function_target(lhs)
        if function_target is not None:
            function_name, function_args = function_target
            return ParsedMathInput(
                kind="function_assignment",
                source=raw,
                normalized_source=f"{lhs} := {rhs}",
                lhs_source=lhs,
                rhs_source=rhs,
                assigned_name=function_name,
                assigned_names=(function_name,),
                function_name=function_name,
                function_args=function_args,
            )
        targets, target_tree = _parse_assignment_targets(lhs)
        return ParsedMathInput(
            kind="assignment",
            source=raw,
            normalized_source=f"{lhs} := {rhs}",
            lhs_source=lhs,
            rhs_source=rhs,
            assigned_name=targets[0],
            assigned_names=targets,
            assignment_target_tree=target_tree,
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

    def _resolve_decimal_places(places: Any | None) -> int:
        def _fallback_default() -> int:
            default_places = user_ns.get("__sugarpy_decimal_places", 4)
            try:
                resolved_default = int(default_places)
            except Exception:
                resolved_default = 4
            return min(max(resolved_default, 0), 12)

        if places is None:
            return _fallback_default()
        try:
            resolved = int(places)
        except Exception:
            # Keep rendering resilient: if places cannot be parsed, use configured/default precision.
            return _fallback_default()
        return min(max(resolved, 0), 12)

    def set_decimal_places(places: Any) -> int:
        resolved = _resolve_decimal_places(places)
        user_ns["__sugarpy_decimal_places"] = resolved
        return resolved

    def render_decimal(value: Any, places: Any | None = None) -> RenderDirective:
        return RenderDirective(value=value, mode="decimal", places=_resolve_decimal_places(places))

    def render_exact(value: Any) -> RenderDirective:
        return RenderDirective(value=value, mode="exact", places=None)

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

    def _is_symbol_spec(value: Any) -> bool:
        if isinstance(value, sp.Symbol):
            return True
        if isinstance(value, (list, tuple, set)):
            return bool(value) and all(_is_symbol_spec(item) for item in value)
        return False

    def solve(equations: Any, *args: Any, **kwargs: Any) -> Any:
        grouped_equations = [equations]
        remaining_args: list[Any] = []
        collecting_equations = not _is_symbol_spec(equations)

        for arg in args:
            if collecting_equations and not _is_symbol_spec(arg):
                grouped_equations.append(arg)
                continue
            collecting_equations = False
            remaining_args.append(arg)

        normalized_input: Any
        if len(grouped_equations) == 1:
            normalized_input = grouped_equations[0]
        else:
            normalized_input = tuple(grouped_equations)

        normalized = _normalize_equations_for_solve(normalized_input)
        try:
            return sp.solve(normalized, *remaining_args, **kwargs)
        except Exception as exc:
            # SymPy can fail with `CoercionFailed: nan is not in any domain` for exact polynomial systems.
            # Fallback to polynomial solver when possible to preserve exact symbolic output.
            msg = str(exc).lower()
            if "nan is not in any domain" not in msg:
                raise
            if kwargs:
                raise
            if not isinstance(normalized, (list, tuple)):
                raise
            if not remaining_args:
                raise

            raw_vars = remaining_args[0]
            if isinstance(raw_vars, (list, tuple, set)):
                vars_seq = tuple(raw_vars)
            else:
                vars_seq = (raw_vars,)
            if not vars_seq:
                raise

            return sp.solve_poly_system(tuple(normalized), *vars_seq)

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
        "set_decimal_places": set_decimal_places,
        "render_decimal": render_decimal,
        "render_exact": render_exact,
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
    if source.strip().startswith("plot("):
        rewritten_source = _rewrite_plot_call_source(source)
    else:
        rewritten_source = _rewrite_inline_equations(source)
    try:
        return parse_expr(
            rewritten_source,
            local_dict=build_math_locals([rewritten_source], mode=mode, user_ns=user_ns),
            transformations=_TRANSFORMS,
            evaluate=False,
        )
    except MathParseError:
        raise
    except Exception as exc:  # pragma: no cover - message normalized for UI
        raise MathParseError(f"Syntax error: {exc}") from exc
