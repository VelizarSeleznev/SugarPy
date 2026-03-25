"""Internal parsing helpers for Math cells."""

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
_NORMALIZE_TOKEN_RE = re.compile(
    r"""
    (?P<space>\s+)
    | (?P<string>'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")
    | (?P<compare>==|!=|<=|>=)
    | (?P<assign>:=)
    | (?P<power>\*\*|\^)
    | (?P<range>\.\.)
    | (?P<number>\d+(?:\.\d+)?|\.\d+)
    | (?P<ident>[A-Za-z_]\w*)
    | (?P<open>[\(\[\{])
    | (?P<close>[\)\]\}])
    | (?P<comma>,)
    | (?P<operator>[+\-*/%=:])
    | (?P<other>.)
    """,
    re.VERBOSE,
)
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


def _structured_parser_error(detail: str) -> MathParseError:
    return MathParseError(f"Structured parser diagnostic: {detail}")


def is_equation_like(value: Any) -> bool:
    return isinstance(value, sp.Equality)


def canonicalize_equation(value: Any) -> Any:
    """Convert equation-like values to SugarPy's implicit `lhs - rhs` form."""
    if isinstance(value, sp.Equality):
        return sp.simplify(value.lhs - value.rhs)
    if isinstance(value, list):
        return [canonicalize_equation(item) for item in value]
    if isinstance(value, tuple):
        return tuple(canonicalize_equation(item) for item in value)
    if isinstance(value, set):
        return {canonicalize_equation(item) for item in value}
    if isinstance(value, dict):
        return {
            canonicalize_equation(key): canonicalize_equation(item)
            for key, item in value.items()
        }
    return value


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
                raise _structured_parser_error("unmatched closing bracket")
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
        raise _structured_parser_error("unclosed string literal")
    if depth != 0:
        raise _structured_parser_error("unclosed bracket")
    return {
        "assignment": assignment_positions,
        "equation": equation_positions,
        "compare": compare_positions,
    }


def _normalize_expression_source(source: str) -> str:
    raw = (source or "").strip()
    if not raw:
        return raw

    tokens: list[tuple[str, str]] = []
    for match in _NORMALIZE_TOKEN_RE.finditer(raw):
        kind = match.lastgroup or "other"
        value = match.group(0)
        if kind == "space":
            continue
        if kind == "power":
            value = "**"
        tokens.append((kind, value))

    normalized: list[str] = []
    prev_kind: str | None = None
    prev_value: str | None = None

    def _ends_atom(kind: str | None) -> bool:
        return kind in {"ident", "number", "string", "close"}

    def _starts_atom(kind: str | None) -> bool:
        return kind in {"ident", "number", "string", "open"}

    for kind, value in tokens:
        if normalized and _ends_atom(prev_kind) and _starts_atom(kind):
            if not (
                prev_kind == "ident" and value == "("
            ) and not (
                prev_kind == "close" and prev_value == "["
            ) and not (
                value == "[" and prev_kind in {"ident", "close"}
            ):
                normalized.append("*")
        normalized.append(value)
        prev_kind = kind
        prev_value = value

    return "".join(normalized)


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
        raise _structured_parser_error("unsupported bracket")

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
    raise _structured_parser_error("unclosed bracket")


def _wrap_equation_expression(source: str) -> str:
    from .math_parser import parse_math_input

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


def _parse_plot_tuple_range_arg(arg: str) -> list[str] | None:
    stripped = arg.strip()
    if not stripped or stripped[0] not in "([{" or stripped[-1] not in ")]}":
        return None
    inner = _strip_enclosing_group(stripped)
    parts = _split_top_level_commas(inner)
    if len(parts) != 3:
        return None
    target = parts[0].strip()
    range_start = parts[1].strip()
    range_end = parts[2].strip()
    if not _ASSIGN_TARGET_RE.match(target) or not range_start or not range_end:
        return None
    if target == "x":
        return [f"xmin={range_start}", f"xmax={range_end}"]
    if target == "y":
        return [f"ymin={range_start}", f"ymax={range_end}"]
    return [f"var={target}", f"start={range_start}", f"end={range_end}"]


def _parse_plot_positional_range_args(args: list[str], idx: int) -> tuple[list[str], int] | None:
    if idx + 2 >= len(args):
        return None
    target = args[idx].strip()
    if target not in {"x", "y"}:
        return None
    range_start = args[idx + 1].strip()
    range_end = args[idx + 2].strip()
    if not range_start or not range_end:
        return None
    if _parse_plot_option_arg(range_start) is not None or _parse_plot_option_arg(range_end) is not None:
        return None
    if target == "x":
        return (["xmin=" + range_start, "xmax=" + range_end], idx + 3)
    return (["ymin=" + range_start, "ymax=" + range_end], idx + 3)


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
    idx = 0
    while idx < len(args):
        stripped_arg = args[idx].strip()
        option_args = _parse_plot_option_arg(stripped_arg)
        if option_args is not None:
            rewritten_args.extend(option_args)
            idx += 1
            continue
        tuple_option_args = _parse_plot_tuple_range_arg(stripped_arg)
        if tuple_option_args is not None:
            rewritten_args.extend(tuple_option_args)
            idx += 1
            continue
        positional_range = _parse_plot_positional_range_args(args, idx)
        if positional_range is not None:
            range_args, next_idx = positional_range
            rewritten_args.extend(range_args)
            idx = next_idx
            continue
        rewritten_arg = _rewrite_plot_call_source(stripped_arg) if stripped_arg.startswith("plot(") else _rewrite_inline_equations(stripped_arg, nested=True)
        rewritten_args.append(rewritten_arg)
        idx += 1
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


def _collect_call_names(source: str) -> set[str]:
    return {match.group(1) for match in _CALL_NAME_RE.finditer(source)}


def _collect_identifier_names(source: str) -> set[str]:
    return set(_IDENT_RE.findall(source))
