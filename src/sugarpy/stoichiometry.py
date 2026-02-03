"""Stoichiometry table helpers."""

from __future__ import annotations

from typing import Any, Dict, List, Tuple
import math
import re

from chempy import Substance, balance_stoichiometry


_ARROW_RE = re.compile(r"->|=")
_COEFF_RE = re.compile(r"^\s*[0-9]+(?:\.[0-9]+)?\s*")
_STATE_RE = re.compile(r"\((aq|s|l|g)\)\s*$", re.IGNORECASE)


class StoichiometryError(ValueError):
    pass


def _clean_formula(formula: str) -> str:
    cleaned = _STATE_RE.sub("", formula).strip()
    return cleaned


def _strip_coeff(part: str) -> str:
    stripped = _COEFF_RE.sub("", part).strip()
    return _clean_formula(stripped)


def _split_reaction(reaction: str) -> Tuple[List[str], List[str]]:
    if not reaction or not isinstance(reaction, str):
        raise StoichiometryError("Reaction is empty.")
    if "->" in reaction:
        left, right = reaction.split("->", 1)
    elif "=" in reaction:
        left, right = reaction.split("=", 1)
    else:
        raise StoichiometryError("Reaction must contain '->' or '='.")

    left_parts = [_strip_coeff(p) for p in left.split("+") if p.strip()]
    right_parts = [_strip_coeff(p) for p in right.split("+") if p.strip()]
    if not left_parts or not right_parts:
        raise StoichiometryError("Reaction must have reactants and products.")
    return left_parts, right_parts


def _latex_name(formula: str) -> str:
    try:
        return Substance.from_formula(formula).latex_name
    except Exception:
        return formula


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if math.isfinite(value):
            return float(value)
        return None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", ".")
        if not cleaned:
            return None
        try:
            parsed = float(cleaned)
        except ValueError:
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _normalize_inputs(inputs: Any) -> Dict[str, Dict[str, float | None]]:
    normalized: Dict[str, Dict[str, float | None]] = {}
    if isinstance(inputs, dict):
        for species, payload in inputs.items():
            if not species:
                continue
            if isinstance(payload, dict):
                normalized[str(species)] = {
                    "n": _to_float(payload.get("n")),
                    "m": _to_float(payload.get("m")),
                }
            else:
                normalized[str(species)] = {"n": _to_float(payload), "m": None}
    elif isinstance(inputs, list):
        for item in inputs:
            if not isinstance(item, dict):
                continue
            species = item.get("species") or item.get("name")
            if not species:
                continue
            normalized[str(species)] = {
                "n": _to_float(item.get("n")),
                "m": _to_float(item.get("m")),
            }
    return normalized


def _relative_diff(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    denom = max(abs(a), abs(b), 1.0)
    return abs(a - b) / denom


def render_stoichiometry(reaction: str, inputs: Any = None) -> Dict[str, Any]:
    """Return stoichiometry table data for frontend rendering."""
    try:
        left, right = _split_reaction(reaction)
        reactants, products = balance_stoichiometry(left, right)
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "balanced": None,
            "equation_latex": None,
            "species": [],
        }

    ordered = [(name, "reactant") for name in left] + [(name, "product") for name in right]
    coeffs: Dict[str, float] = {}
    coeffs.update({k: float(v) for k, v in reactants.items()})
    coeffs.update({k: float(v) for k, v in products.items()})

    molar_masses: Dict[str, float | None] = {}
    for name, _side in ordered:
        try:
            molar_masses[name] = float(Substance.from_formula(name).mass)
        except Exception:
            molar_masses[name] = None

    inputs_map = _normalize_inputs(inputs)

    inputs_map = {k: v for k, v in inputs_map.items() if k in coeffs}

    extents: List[float] = []
    computed_inputs: Dict[str, Dict[str, float | None]] = {}
    for name, _side in ordered:
        data = inputs_map.get(name, {})
        input_n = data.get("n")
        input_m = data.get("m")
        mm = molar_masses.get(name)
        if input_n is None and input_m is not None and mm:
            input_n = input_m / mm
        computed_inputs[name] = {"n": input_n, "m": input_m}
        if input_n is not None:
            coeff = coeffs.get(name)
            if coeff and coeff > 0:
                extents.append(input_n / coeff)

    extent = min(extents) if extents else None

    species_rows: List[Dict[str, Any]] = []
    for name, side in ordered:
        coeff = coeffs.get(name, 0.0)
        mm = molar_masses.get(name)
        input_n = computed_inputs.get(name, {}).get("n")
        input_m = computed_inputs.get(name, {}).get("m")

        calc_n = coeff * extent if extent is not None else None
        calc_m = calc_n * mm if calc_n is not None and mm is not None else None

        status = "ok"
        if input_n is not None and calc_n is not None:
            if (_relative_diff(input_n, calc_n) or 0.0) > 1e-3:
                status = "mismatch"
        if input_m is not None and calc_m is not None:
            if (_relative_diff(input_m, calc_m) or 0.0) > 1e-3:
                status = "mismatch"

        species_rows.append(
            {
                "name": name,
                "side": side,
                "coeff": coeff,
                "molar_mass": mm,
                "input_n": input_n,
                "input_m": input_m,
                "calc_n": calc_n,
                "calc_m": calc_m,
                "status": status,
            }
        )

    def fmt_coeff(value: float) -> str:
        if abs(value - 1.0) < 1e-9:
            return ""
        if abs(value - round(value)) < 1e-9:
            return str(int(round(value)))
        return str(value)

    def fmt_term(name: str, coeff: float) -> str:
        return f"{fmt_coeff(coeff)}{name}"

    left_balanced = " + ".join(fmt_term(name, coeffs.get(name, 0.0)) for name in left)
    right_balanced = " + ".join(fmt_term(name, coeffs.get(name, 0.0)) for name in right)
    balanced = f"{left_balanced} -> {right_balanced}"

    left_latex = " + ".join(f"{fmt_coeff(coeffs.get(name, 0.0))}{_latex_name(name)}" for name in left)
    right_latex = " + ".join(f"{fmt_coeff(coeffs.get(name, 0.0))}{_latex_name(name)}" for name in right)
    equation_latex = f"{left_latex} \\rightarrow {right_latex}"

    return {
        "ok": True,
        "error": None,
        "balanced": balanced,
        "equation_latex": equation_latex,
        "species": species_rows,
    }
