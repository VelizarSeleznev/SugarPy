from __future__ import annotations

import ast
import contextlib
import json
import time
import uuid
from typing import Any, Callable

from sugarpy.runtime_manager import RuntimeManager

from .config import DEFAULT_SANDBOX_TIMEOUT_S
from .execution import join_execution_chunks, wrap_code_for_notebook_display
from .security import validate_restricted_python


def normalize_sandbox_context_preset(value: Any) -> str:
    raw = str(value or "").strip()
    if raw in {"none", "bootstrap-only", "imports-only", "selected-cells", "full-notebook-replay"}:
        return raw
    return "none"


def sandbox_cell_id(cell: dict[str, Any]) -> str:
    return str(cell.get("id") or "").strip()


def sandbox_cell_context_source(cell: dict[str, Any]) -> str:
    return "draft" if str(cell.get("contextSource") or "").strip() == "draft" else "notebook"


def is_replayable_sandbox_cell(cell: dict[str, Any]) -> bool:
    return str(cell.get("type") or "code") in {"code", "math"} and bool(str(cell.get("source") or "").strip())


def is_import_only_source(source: str) -> bool:
    stripped = source.strip()
    if not stripped:
        return False
    try:
        tree = ast.parse(stripped)
    except SyntaxError:
        return False
    if not tree.body:
        return False
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(getattr(node, "value", None), ast.Constant) and isinstance(node.value.value, str):
            continue
        if not isinstance(node, (ast.Import, ast.ImportFrom)):
            return False
    return True


def build_math_replay_code(source: str, trig_mode: str, render_mode: str) -> str:
    return "\n".join(
        [
            "from sugarpy.math_cell import render_math_cell",
            f"_ = render_math_cell({json.dumps(source)}, mode={json.dumps(trig_mode)}, render_mode={json.dumps(render_mode)})",
        ]
    )


def wrap_replay_code(source: str) -> str:
    lines = source.splitlines() or [source]
    indented = "\n".join(f"        {line}" if line else "" for line in lines)
    return "\n".join(
        [
            "import contextlib",
            "import io",
            "__sugarpy_replay_stdout = io.StringIO()",
            "__sugarpy_replay_stderr = io.StringIO()",
            "__sugarpy_prev_display = globals().get('__sugarpy_display')",
            "__sugarpy_display = lambda *args, **kwargs: None",
            "try:",
            "    with contextlib.redirect_stdout(__sugarpy_replay_stdout), contextlib.redirect_stderr(__sugarpy_replay_stderr):",
            indented,
            "finally:",
            "    if __sugarpy_prev_display is not None:",
            "        __sugarpy_display = __sugarpy_prev_display",
        ]
    )


def build_sandbox_replay_chunks(
    notebook_cells: list[dict[str, Any]],
    context_preset: str,
    selected_cell_ids: list[str],
    trig_mode: str,
    render_mode: str,
) -> tuple[list[str], list[str], list[str]]:
    if context_preset in {"none", "bootstrap-only"}:
        return [], [], []

    selected_lookup = {cell_id for cell_id in selected_cell_ids if cell_id}
    replayed_ids: list[str] = []
    context_sources: list[str] = []
    chunks: list[str] = []
    for cell in notebook_cells:
        if not is_replayable_sandbox_cell(cell):
            continue
        cell_id = sandbox_cell_id(cell)
        cell_type = str(cell.get("type") or "code")
        if context_preset == "imports-only":
            if cell_type != "code" or not is_import_only_source(str(cell.get("source") or "")):
                continue
        elif context_preset == "selected-cells":
            if cell_id not in selected_lookup:
                continue
        source = str(cell.get("source") or "")
        if cell_type == "code":
            chunks.append(wrap_replay_code(source))
        else:
            chunks.append(
                wrap_replay_code(
                    build_math_replay_code(
                        source,
                        "rad" if cell.get("mathTrigMode") == "rad" else trig_mode,
                        "decimal" if cell.get("mathRenderMode") == "decimal" else render_mode,
                    )
                )
            )
        replayed_ids.append(cell_id)
        source_kind = sandbox_cell_context_source(cell)
        if source_kind not in context_sources:
            context_sources.append(source_kind)
    return chunks, replayed_ids, context_sources


async def execute_sandbox_request(
    payload: dict[str, Any],
    *,
    runtime_manager_factory: Callable[[], RuntimeManager],
    assistant_sandbox_available_provider: Callable[[], bool],
    sandbox_code_cells_restricted_provider: Callable[[], bool],
    security_profile_provider: Callable[[], str],
) -> dict[str, Any]:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else payload
    notebook_cells = [cell for cell in payload.get("notebookCells", []) if isinstance(cell, dict)]
    bootstrap_code = str(payload.get("bootstrapCode") or "").strip()
    target = "math" if request.get("target") == "math" else "code"
    context_preset = normalize_sandbox_context_preset(request.get("contextPreset"))
    selected_cell_ids = [str(item) for item in request.get("selectedCellIds", [])] if isinstance(request.get("selectedCellIds"), list) else []
    timeout_s = min(
        max(float(request.get("timeoutMs") or DEFAULT_SANDBOX_TIMEOUT_S * 1000.0) / 1000.0, 0.25),
        DEFAULT_SANDBOX_TIMEOUT_S,
    )
    trig_mode = "rad" if request.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if request.get("renderMode") == "decimal" else "exact"
    manager = runtime_manager_factory()
    replay_chunks, replayed_cell_ids, replay_context_sources = build_sandbox_replay_chunks(
        notebook_cells,
        context_preset,
        selected_cell_ids,
        trig_mode,
        render_mode,
    )
    executed_bootstrap = bool(bootstrap_code)
    context_sources_used = (["bootstrap"] if executed_bootstrap else []) + replay_context_sources

    if not assistant_sandbox_available_provider():
        return {
            "target": target,
            "status": "error",
            "stdout": "",
            "stderr": "",
            "mimeData": {},
            "errorName": "SandboxUnavailable",
            "errorValue": "Assistant validation is unavailable because restricted mode requires Docker-backed isolation.",
            "durationMs": 0,
            "contextPresetUsed": context_preset,
            "selectedCellIds": selected_cell_ids,
            "executedBootstrap": executed_bootstrap,
            "replayedCellIds": replayed_cell_ids,
            "contextSourcesUsed": context_sources_used,
        }

    if target == "code":
        code = str(request.get("code") or "").strip()
        if not code:
            return {
                "target": target,
                "status": "error",
                "stdout": "",
                "stderr": "",
                "mimeData": {},
                "errorName": "ValidationError",
                "errorValue": "Sandbox code cannot be empty.",
                "durationMs": 0,
                "contextPresetUsed": context_preset,
                "selectedCellIds": selected_cell_ids,
                "executedBootstrap": executed_bootstrap,
                "replayedCellIds": replayed_cell_ids,
                "contextSourcesUsed": context_sources_used,
            }
        if sandbox_code_cells_restricted_provider():
            replay_code_sources = [
                str(cell.get("source") or "")
                for cell in notebook_cells
                if str(cell.get("type") or "code") == "code" and sandbox_cell_id(cell) in set(replayed_cell_ids)
            ]
            errors = [*validate_restricted_python(code)]
            for replay_source in replay_code_sources:
                errors.extend(validate_restricted_python(replay_source))
            if errors:
                return {
                    "target": target,
                    "status": "error",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {},
                    "errorName": "RestrictedExecution",
                    "errorValue": "; ".join(errors),
                    "durationMs": 0,
                    "contextPresetUsed": context_preset,
                    "selectedCellIds": selected_cell_ids,
                    "executedBootstrap": executed_bootstrap,
                    "replayedCellIds": replayed_cell_ids,
                    "contextSourcesUsed": context_sources_used,
                }
        target_code = wrap_code_for_notebook_display(code)
    else:
        source = str(request.get("source") or "").strip()
        if not source:
            return {
                "target": target,
                "status": "error",
                "stdout": "",
                "stderr": "",
                "mimeData": {},
                "errorName": "ValidationError",
                "errorValue": "Math sandbox source cannot be empty.",
                "durationMs": 0,
                "contextPresetUsed": context_preset,
                "selectedCellIds": selected_cell_ids,
                "executedBootstrap": executed_bootstrap,
                "replayedCellIds": replayed_cell_ids,
                "contextSourcesUsed": context_sources_used,
            }
        target_code = build_math_replay_code(source, trig_mode, render_mode)

    execution_chunks = [chunk for chunk in [bootstrap_code, *replay_chunks, target_code] if chunk.strip()]
    sandbox_notebook_id = f"assistant-sandbox-{uuid.uuid4().hex}"
    started_at = time.perf_counter()
    try:
        result, _runtime_payload = await manager.execute_in_runtime(
            sandbox_notebook_id,
            join_execution_chunks(execution_chunks),
            timeout_s,
        )
    except Exception as exc:
        return {
            "target": target,
            "status": "error",
            "stdout": "",
            "stderr": "",
            "mimeData": {},
            "errorName": exc.__class__.__name__,
            "errorValue": str(exc),
            "durationMs": int((time.perf_counter() - started_at) * 1000),
            "contextPresetUsed": context_preset,
            "selectedCellIds": selected_cell_ids,
            "executedBootstrap": executed_bootstrap,
            "replayedCellIds": replayed_cell_ids,
            "contextSourcesUsed": context_sources_used,
        }
    finally:
        with contextlib.suppress(Exception):
            await manager.delete_runtime(sandbox_notebook_id)

    response = {
        "target": target,
        **result,
        "contextPresetUsed": context_preset,
        "selectedCellIds": selected_cell_ids,
        "executedBootstrap": executed_bootstrap,
        "replayedCellIds": replayed_cell_ids,
        "contextSourcesUsed": context_sources_used,
    }
    if target == "math":
        from .execution import _parse_math_validation

        response["mathValidation"] = _parse_math_validation(result.get("stdout") or "") or {
            "error": result.get("errorValue") or "Math validation failed.",
            "warnings": [],
            "stepsPreview": [],
            "hasPlot": False,
        }
        if response["status"] == "ok" and response["mathValidation"].get("error"):
            response["status"] = "error"
    return response
