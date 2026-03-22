from __future__ import annotations

import re
from typing import Any

from sugarpy.math_parser import MathParseError, parse_math_input

from .models import MapleInputBlock, MapleWorksheet, SectionBlock, TextBlock, TitleBlock, WarningBlock

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
INLINE_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
INLINE_CODE_RE = re.compile(r"`([^`]+)`")
INLINE_EMPHASIS_RE = re.compile(r"(\*\*|__|\*|_)(.+?)\1")
SAFE_MAPLE_TEXT_RE = re.compile(r"^[A-Za-z0-9_+\-*/^=(),.\[\]{}\s]+$")
SIMPLE_ASSIGN_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*:=\s*(.+)$", re.DOTALL)
FUNCTION_ASSIGN_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*:=\s*(.+)$", re.DOTALL)
UNSUPPORTED_MATH_TOKENS = (
    "==",
    "!=",
    "<=",
    ">=",
    "Eq(",
    "linsolve(",
    "render_decimal(",
    "render_exact(",
    "set_decimal_places(",
    "subs(",
)
MATH_FUNCTION_REWRITES = {
    "integrate(": "int(",
    "N(": "evalf(",
}
SUPPORTED_CALL_PREFIXES = (
    "solve(",
    "simplify(",
    "expand(",
    "factor(",
    "diff(",
    "int(",
    "integrate(",
    "plot(",
)


def translate_notebook_to_maple_ir(notebook: dict[str, Any]) -> MapleWorksheet:
    title = str(notebook.get("name") or "Untitled")
    blocks: list[Any] = []
    for cell in notebook.get("cells") or []:
        if not isinstance(cell, dict):
            continue
        blocks.extend(_translate_cell(cell))
    return MapleWorksheet(title=title, blocks=blocks)


def _translate_cell(cell: dict[str, Any]) -> list[Any]:
    cell_type = str(cell.get("type") or "code")
    if cell_type == "markdown":
        return _translate_markdown(cell)
    if cell_type == "math":
        return _translate_math(cell)
    return _translate_unsupported_cell(cell_type, cell)


def _translate_markdown(cell: dict[str, Any]) -> list[Any]:
    source = str(cell.get("source") or "")
    blocks: list[Any] = []
    paragraph_lines: list[str] = []
    for raw_line in source.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            if paragraph_lines:
                blocks.extend(_translate_markdown_paragraph(paragraph_lines))
                paragraph_lines = []
            continue
        paragraph_lines.append(line)
    if paragraph_lines:
        blocks.extend(_translate_markdown_paragraph(paragraph_lines))
    return blocks


def _translate_markdown_paragraph(lines: list[str]) -> list[Any]:
    first = lines[0].strip()
    heading_match = HEADING_RE.match(first)
    if heading_match:
        level = len(heading_match.group(1))
        text = _normalize_text(heading_match.group(2))
        if not text:
            return []
        if level == 1:
            return [TitleBlock(text=text)]
        return [SectionBlock(text=text)]
    text = _normalize_text("\n".join(lines))
    return [TextBlock(text=text)] if text else []


def _translate_math(cell: dict[str, Any]) -> list[Any]:
    source = str(cell.get("source") or "").strip()
    normalized = _math_source_for_export(cell)
    if not normalized:
        return []
    assignment_code = _maple_assignment_code_for_math_source(normalized)
    if assignment_code:
        return [MapleInputBlock(code=assignment_code)]
    if ":=" in normalized:
        return [
            WarningBlock(text="Math cell kept as text because Maple export supports only simple `name := expr` and `f(x) := expr` assignments in MVP."),
            TextBlock(text=source or normalized),
        ]
    for token in UNSUPPORTED_MATH_TOKENS:
        if token in normalized:
            return [
                WarningBlock(text=f"Math cell kept as text because Maple export does not support `{token}` in MVP."),
                TextBlock(text=source or normalized),
            ]
    code = _maple_code_for_math_source(normalized)
    if code:
        return [MapleInputBlock(code=code)]
    return [
        WarningBlock(text="Math cell kept as text because Maple export could not translate it safely."),
        TextBlock(text=source or normalized),
    ]


def _translate_unsupported_cell(cell_type: str, cell: dict[str, Any]) -> list[Any]:
    source = str(cell.get("source") or "").strip()
    label = cell_type or "unknown"
    blocks: list[Any] = [
        WarningBlock(text=f"Unsupported SugarPy {label} cell exported as plain text."),
    ]
    if source:
        blocks.append(TextBlock(text=source))
    return blocks


def _math_source_for_export(cell: dict[str, Any]) -> str:
    math_output = cell.get("mathOutput")
    normalized = None
    if isinstance(math_output, dict):
        value = math_output.get("normalized_source")
        if isinstance(value, str):
            normalized = value.strip()
    source = normalized or str(cell.get("source") or "").strip()
    if not normalized and source:
        try:
            source = parse_math_input(source).normalized_source
        except MathParseError:
            pass
    return source.replace("**", "^")


def _maple_code_for_math_source(source: str) -> str | None:
    candidate = source.strip()
    for before, after in MATH_FUNCTION_REWRITES.items():
        candidate = candidate.replace(before, after)
    if candidate.startswith(SUPPORTED_CALL_PREFIXES) and SAFE_MAPLE_TEXT_RE.fullmatch(candidate):
        return _ensure_semicolon(candidate)
    if SAFE_MAPLE_TEXT_RE.fullmatch(candidate):
        return _ensure_semicolon(candidate)
    return None


def _maple_assignment_code_for_math_source(source: str) -> str | None:
    candidate = source.strip()
    function_match = FUNCTION_ASSIGN_RE.match(candidate)
    if function_match:
        fn_name, raw_args, raw_rhs = function_match.groups()
        args = [arg.strip() for arg in raw_args.split(",")] if raw_args.strip() else []
        if not args or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", arg) for arg in args):
            return None
        rhs_code = _maple_rhs_for_assignment(raw_rhs)
        if not rhs_code:
            return None
        return _ensure_semicolon(f"{fn_name}({', '.join(args)}) := {rhs_code}")

    simple_match = SIMPLE_ASSIGN_RE.match(candidate)
    if simple_match:
        name, raw_rhs = simple_match.groups()
        rhs_code = _maple_rhs_for_assignment(raw_rhs)
        if not rhs_code:
            return None
        return _ensure_semicolon(f"{name} := {rhs_code}")
    return None


def _maple_rhs_for_assignment(source: str) -> str | None:
    candidate = source.strip()
    if not candidate or ":=" in candidate:
        return None
    for token in UNSUPPORTED_MATH_TOKENS:
        if token in candidate:
            return None
    for before, after in MATH_FUNCTION_REWRITES.items():
        candidate = candidate.replace(before, after)
    if SAFE_MAPLE_TEXT_RE.fullmatch(candidate):
        return candidate
    return None


def _ensure_semicolon(source: str) -> str:
    stripped = source.rstrip()
    if stripped.endswith((";", ":")):
        return stripped
    return f"{stripped};"


def _normalize_text(text: str) -> str:
    value = text.strip()
    value = INLINE_LINK_RE.sub(r"\1 (\2)", value)
    value = INLINE_CODE_RE.sub(r"\1", value)
    value = INLINE_EMPHASIS_RE.sub(r"\2", value)
    return value.strip()
