"""Chemistry equation balancer for basic reactions."""

from __future__ import annotations

from collections import defaultdict
import re
from typing import Dict, List, Tuple

from sympy import Matrix, lcm

ELEMENT_RE = re.compile(r"([A-Z][a-z]?)(\d*)")
TOKEN_RE = re.compile(r"([A-Z][a-z]?|\d+|\(|\))")


class FormulaError(ValueError):
    pass


def _tokenize(formula: str) -> List[str]:
    tokens = TOKEN_RE.findall(formula)
    if not tokens:
        raise FormulaError("Empty formula")
    if "".join(tokens) != formula:
        raise FormulaError(f"Invalid characters in formula: {formula}")
    return tokens


def _parse_tokens(tokens: List[str]) -> Dict[str, int]:
    stack: List[Dict[str, int]] = [defaultdict(int)]
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "(":
            stack.append(defaultdict(int))
            i += 1
        elif tok == ")":
            if len(stack) == 1:
                raise FormulaError("Unmatched closing parenthesis")
            group = stack.pop()
            i += 1
            mult = 1
            if i < len(tokens) and tokens[i].isdigit():
                mult = int(tokens[i])
                i += 1
            for el, cnt in group.items():
                stack[-1][el] += cnt * mult
        elif tok.isdigit():
            raise FormulaError("Unexpected number")
        else:
            el = tok
            i += 1
            mult = 1
            if i < len(tokens) and tokens[i].isdigit():
                mult = int(tokens[i])
                i += 1
            stack[-1][el] += mult
    if len(stack) != 1:
        raise FormulaError("Unmatched opening parenthesis")
    return dict(stack[0])


def parse_formula(formula: str) -> Dict[str, int]:
    formula = formula.strip()
    if not formula:
        raise FormulaError("Empty formula")
    tokens = _tokenize(formula)
    return _parse_tokens(tokens)


def _parse_side(side: str) -> List[Tuple[str, Dict[str, int]]]:
    parts = [p.strip() for p in side.split("+") if p.strip()]
    if not parts:
        raise FormulaError("Empty reaction side")
    result = []
    for part in parts:
        result.append((part, parse_formula(part)))
    return result


def parse_reaction(reaction: str) -> Tuple[List[Tuple[str, Dict[str, int]]], List[Tuple[str, Dict[str, int]]]]:
    if "->" in reaction:
        left, right = reaction.split("->", 1)
    elif "=" in reaction:
        left, right = reaction.split("=", 1)
    else:
        raise FormulaError("Reaction must contain '->' or '='")
    return _parse_side(left), _parse_side(right)


def balance_equation(reaction: str) -> str:
    left, right = parse_reaction(reaction)
    species = left + right
    elements = sorted({el for _, comp in species for el in comp.keys()})

    rows = []
    for el in elements:
        row = []
        for _, comp in left:
            row.append(comp.get(el, 0))
        for _, comp in right:
            row.append(-comp.get(el, 0))
        rows.append(row)

    matrix = Matrix(rows)
    nullspace = matrix.nullspace()
    if not nullspace:
        raise FormulaError("No solution found")
    vec = nullspace[0]
    denom_lcm = lcm([val.q for val in vec])
    coeffs = [int(val * denom_lcm) for val in vec]
    if all(c == 0 for c in coeffs):
        raise FormulaError("Invalid solution")

    # Normalize to smallest integers
    sign = -1 if any(c < 0 for c in coeffs) else 1
    coeffs = [c * sign for c in coeffs]
    gcd = abs(coeffs[0])
    for c in coeffs[1:]:
        gcd = _gcd(gcd, abs(c))
    coeffs = [c // gcd for c in coeffs]

    left_coeffs = coeffs[: len(left)]
    right_coeffs = coeffs[len(left) :]

    left_str = " + ".join(_fmt_coeff(c, name) for c, (name, _) in zip(left_coeffs, left))
    right_str = " + ".join(_fmt_coeff(c, name) for c, (name, _) in zip(right_coeffs, right))
    return f"{left_str} -> {right_str}"


def _fmt_coeff(coeff: int, formula: str) -> str:
    return f"{coeff}{formula}" if coeff != 1 else formula


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a
