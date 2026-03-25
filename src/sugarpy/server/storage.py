from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from .config import DEFAULT_STORAGE_DIRNAME


def safe_identifier(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", (value or "").strip())
    normalized = normalized.strip("-.")
    return normalized or fallback


def storage_root() -> Path:
    configured = os.environ.get("SUGARPY_STORAGE_ROOT", "").strip()
    if configured:
        root = Path(os.path.expanduser(configured))
    else:
        root = Path.home() / ".local" / "share" / "sugarpy" / DEFAULT_STORAGE_DIRNAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def storage_subdir(name: str) -> Path:
    path = storage_root() / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def autosave_path(notebook_id: str) -> Path:
    return storage_subdir("autosave") / f"{safe_identifier(notebook_id, 'notebook')}.sugarpy"


def notebook_path(notebook_id: str) -> Path:
    return storage_subdir("notebooks") / f"{safe_identifier(notebook_id, 'notebook')}.sugarpy"


def trace_path(notebook_id: str, trace_id: str) -> Path:
    trace_dir = storage_subdir("assistant-traces") / safe_identifier(notebook_id, "notebook")
    trace_dir.mkdir(parents=True, exist_ok=True)
    return trace_dir / f"{safe_identifier(trace_id, 'trace')}.json"


def json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def json_load(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def normalize_notebook_payload(payload: dict[str, Any]) -> dict[str, Any]:
    cells = payload.get("cells")
    normalized_cells = cells if isinstance(cells, list) else []
    return {
        "version": 1,
        "id": str(payload.get("id") or "notebook"),
        "name": str(payload.get("name") or "Untitled"),
        "trigMode": "rad" if payload.get("trigMode") == "rad" else "deg",
        "defaultMathRenderMode": "decimal" if payload.get("defaultMathRenderMode") == "decimal" else "exact",
        "cells": normalized_cells,
        "updatedAt": str(payload.get("updatedAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())),
    }


def normalize_trace_payload(payload: dict[str, Any]) -> dict[str, Any]:
    redacted = json.loads(json.dumps(payload))
    for response in redacted.get("responses", []) if isinstance(redacted.get("responses"), list) else []:
        if isinstance(response, dict):
            response.pop("raw", None)
    for event in redacted.get("network", []) if isinstance(redacted.get("network"), list) else []:
        if isinstance(event, dict):
            detail = event.get("detail")
            if isinstance(detail, str) and "Bearer " in detail:
                event["detail"] = "[redacted]"
    return redacted

