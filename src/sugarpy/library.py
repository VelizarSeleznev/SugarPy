"""Load the built-in function catalog."""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib import resources
from typing import List


@dataclass(frozen=True)
class FunctionEntry:
    id: str
    title: str
    subject: str
    tags: List[str]
    description: str
    snippet: str
    signature: str | None = None


def load_catalog() -> List[FunctionEntry]:
    with resources.files("sugarpy.data").joinpath("functions.json").open("r", encoding="utf-8") as f:
        data = json.load(f)
    return [FunctionEntry(**item) for item in data]
