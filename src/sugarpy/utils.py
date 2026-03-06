"""Shared utilities for SugarPy frontend messaging."""

from __future__ import annotations

from typing import Any

from IPython.display import display


def display_sugarpy(data: dict[str, Any], mime_type: str) -> None:
    """Send structured JSON payload to frontend via Jupyter display_data."""
    display({mime_type: data}, raw=True)
