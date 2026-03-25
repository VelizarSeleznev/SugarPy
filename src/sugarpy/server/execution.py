from __future__ import annotations

import ast
import contextlib
import json
import os
import queue
import time
import uuid
from typing import Any, Callable

from tornado import web

from sugarpy.runtime_manager import RuntimeManager

from .config import DEFAULT_NOTEBOOK_TIMEOUT_S, DEFAULT_SECURITY_PROFILE
from .security import is_execution_timeout, truncate_mime_value, truncate_text, validate_restricted_python

MAX_EXEC_SOURCE_LENGTH = 8000


def bootstrap_code() -> str:
    return "\n".join(
        [
            "import math",
            "import json",
            "import sympy as sp",
            "from sympy import *",
            "from sympy import symbols",
            'x, y, z, t = symbols("x y z t")',
            "from IPython.display import display as __sugarpy_display",
            "from sugarpy.startup import plot",
            "def __sugarpy_emit_output(value):",
            "    payload = {'text/plain': repr(value)}",
            "    if isinstance(value, sp.Basic):",
            "        payload['text/plain'] = str(value)",
            "        payload['text/latex'] = sp.latex(value)",
            "    __sugarpy_display(payload, raw=True)",
        ]
    )


def build_math_code(source: str, trig_mode: str, render_mode: str) -> str:
    return "\n".join(
        [
            "from sugarpy.math_cell import display_math_cell",
            f"_ = display_math_cell({json.dumps(source)}, {json.dumps(trig_mode)}, {json.dumps(render_mode)})",
        ]
    )


def parse_math_validation(stdout: str) -> dict[str, Any] | None:
    lines = [line.strip() for line in stdout.splitlines() if line.strip()]
    for line in reversed(lines):
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(parsed, dict):
            continue
        return {
            "kind": parsed.get("kind") if isinstance(parsed.get("kind"), str) else None,
            "error": parsed.get("error") if isinstance(parsed.get("error"), str) else None,
            "warnings": [str(item) for item in parsed.get("warnings", [])] if isinstance(parsed.get("warnings"), list) else [],
            "stepsPreview": [str(item) for item in parsed.get("steps", [])[:6]] if isinstance(parsed.get("steps"), list) else [],
            "hasPlot": bool(parsed.get("plotly_figure")),
        }
    return None


_parse_math_validation = parse_math_validation


def build_stoich_code(reaction: str, inputs: dict[str, Any]) -> str:
    return "\n".join(
        [
            "from sugarpy.stoichiometry import display_stoichiometry",
            f"_ = display_stoichiometry({json.dumps(reaction)}, {json.dumps(inputs)})",
        ]
    )


def build_regression_code(points: list[dict[str, Any]], model: str, x_label: str, y_label: str) -> str:
    return "\n".join(
        [
            "from sugarpy.regression import display_regression",
            f"_ = display_regression({json.dumps(points)}, {json.dumps(model)}, x_label={json.dumps(x_label)}, y_label={json.dumps(y_label)})",
        ]
    )


def wrap_code_for_notebook_display(source: str) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    if not tree.body or not isinstance(tree.body[-1], ast.Expr):
        return source

    prefix = ""
    if len(tree.body) > 1:
        prefix = ast.unparse(ast.Module(body=tree.body[:-1], type_ignores=[])).strip()
    last_value = tree.body[-1].value
    if isinstance(last_value, ast.Call) and isinstance(last_value.func, ast.Name) and last_value.func.id == "print":
        return source
    last_expr = ast.unparse(last_value).strip()
    if not last_expr:
        return source
    lines = []
    if prefix:
        lines.append(prefix)
    lines.append(f"__sugarpy_value = {last_expr}")
    lines.append("__sugarpy_emit_output(__sugarpy_value)")
    return "\n".join(lines)


def merge_stdout_into_mime_data(stdout: str, mime_data: dict[str, Any]) -> dict[str, Any]:
    if not stdout:
        return dict(mime_data)
    merged = dict(mime_data)
    existing = str(merged.get("text/plain") or "")
    merged["text/plain"] = f"{stdout}{existing}"
    return merged


def join_execution_chunks(chunks: list[str]) -> str:
    return "\n\n".join(chunk for chunk in chunks if chunk.strip())


def cell_source_for_execution(cell: dict[str, Any], trig_mode: str, render_mode: str) -> str:
    cell_type = str(cell.get("type") or "code")
    if cell_type == "math":
        return build_math_code(
            str(cell.get("source") or ""),
            "rad" if cell.get("mathTrigMode") == "rad" else trig_mode,
            "decimal" if cell.get("mathRenderMode") == "decimal" else render_mode,
        )
    if cell_type == "stoich":
        state = cell.get("stoichState") if isinstance(cell.get("stoichState"), dict) else {}
        reaction = str(state.get("reaction") or "")
        inputs = state.get("inputs") if isinstance(state.get("inputs"), dict) else {}
        return build_stoich_code(reaction, inputs)
    if cell_type == "regression":
        state = cell.get("regressionState") if isinstance(cell.get("regressionState"), dict) else {}
        points = state.get("points") if isinstance(state.get("points"), list) else []
        model = str(state.get("model") or "linear")
        labels = state.get("labels") if isinstance(state.get("labels"), dict) else {}
        x_label = str(labels.get("x") or "x")
        y_label = str(labels.get("y") or "y")
        return build_regression_code(points, model, x_label, y_label)
    return wrap_code_for_notebook_display(str(cell.get("source") or ""))


def runtime_manager(
    *,
    storage_root,
    project_root,
    bootstrap_code_value: str,
    executor,
) -> RuntimeManager:
    return RuntimeManager(
        storage_root=storage_root,
        project_root=project_root,
        bootstrap_code=bootstrap_code_value,
        executor=executor,
    )


def _build_execute_response(
    *,
    notebook_id: str,
    target_cell_id: str,
    target_type: str,
    runtime: dict[str, Any],
    result: dict[str, Any],
    security_profile: str,
    fresh_runtime: bool,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        "notebookId": notebook_id,
        "cellId": target_cell_id,
        "cellType": target_type,
        "status": result["status"],
        "execCountIncrement": result["status"] == "ok",
        "securityProfile": security_profile,
        "freshRuntime": fresh_runtime,
        "replayedCellIds": [],
        "runtime": {**runtime, "sessionState": runtime.get("sessionState", "existing"), "freshRuntime": fresh_runtime},
    }
    if target_type == "math":
        math_payload = result["mimeData"].get("application/vnd.sugarpy.math+json")
        if isinstance(math_payload, dict):
            response["mathOutput"] = math_payload
            figure = math_payload.get("plotly_figure")
            if figure:
                response["output"] = {"type": "mime", "data": {"application/vnd.plotly.v1+json": figure}}
        else:
            response["mathOutput"] = {
                "kind": "expression",
                "steps": [],
                "mode": "deg",
                "error": result.get("errorValue") or "Math execution failed.",
                "warnings": [],
            }
        return response
    if target_type == "stoich":
        stoich_payload = result["mimeData"].get("application/vnd.sugarpy.stoich+json")
        if isinstance(stoich_payload, dict):
            response["stoichOutput"] = stoich_payload
        else:
            response["stoichOutput"] = {
                "ok": False,
                "error": result.get("errorValue") or "Stoichiometry execution failed.",
                "species": [],
            }
        return response
    if target_type == "regression":
        regression_payload = result["mimeData"].get("application/vnd.sugarpy.regression+json")
        if isinstance(regression_payload, dict):
            response["regressionOutput"] = regression_payload
            figure = regression_payload.get("plotly_figure")
            if figure:
                response["output"] = {"type": "mime", "data": {"application/vnd.plotly.v1+json": figure}}
        else:
            response["regressionOutput"] = {
                "ok": False,
                "model": "linear",
                "error": result.get("errorValue") or "Regression execution failed.",
                "points": [],
                "invalid_rows": [],
            }
        return response
    if result["status"] == "error":
        response["output"] = {
            "type": "error",
            "ename": result.get("errorName") or "ExecutionError",
            "evalue": result.get("errorValue") or "",
        }
        return response
    response["output"] = {
        "type": "mime",
        "data": merge_stdout_into_mime_data(str(result.get("stdout") or ""), result["mimeData"]),
    }
    return response


async def execute_notebook_request(
    payload: dict[str, Any],
    *,
    runtime_manager_factory: Callable[[], RuntimeManager],
    security_profile_provider: Callable[[], str],
    live_code_cells_restricted_provider: Callable[[], bool],
) -> dict[str, Any]:
    cells = payload.get("cells")
    if not isinstance(cells, list):
        raise web.HTTPError(400, reason="cells must be a list")
    notebook_id = str(payload.get("notebookId") or "notebook").strip() or "notebook"
    target_cell_id = str(payload.get("targetCellId") or "")
    notebook_cells = [cell for cell in cells if isinstance(cell, dict)]
    target_index = next((index for index, cell in enumerate(notebook_cells) if str(cell.get("id")) == target_cell_id), -1)
    if target_index == -1:
        raise web.HTTPError(400, reason="targetCellId was not found")

    target_cell = notebook_cells[target_index]
    target_type = str(target_cell.get("type") or "code")
    target_source = str(target_cell.get("source") or "")
    if len(target_source) > MAX_EXEC_SOURCE_LENGTH:
        raise web.HTTPError(400, reason=f"Cell source exceeds the {MAX_EXEC_SOURCE_LENGTH} character limit")

    if target_type == "code" and live_code_cells_restricted_provider():
        errors = validate_restricted_python(target_source)
        if errors:
            return {
                "notebookId": notebook_id,
                "cellId": target_cell_id,
                "cellType": target_type,
                "status": "error",
                "output": {"type": "error", "ename": "RestrictedExecution", "evalue": "; ".join(errors)},
                "execCountIncrement": False,
                "securityProfile": security_profile_provider(),
            }

    trig_mode = "rad" if payload.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if payload.get("defaultMathRenderMode") == "decimal" else "exact"
    timeout_s = min(
        max(float(payload.get("timeoutMs") or DEFAULT_NOTEBOOK_TIMEOUT_S * 1000.0) / 1000.0, 0.25),
        DEFAULT_NOTEBOOK_TIMEOUT_S,
    )
    manager = runtime_manager_factory()
    try:
        runtime = await manager.ensure_runtime(notebook_id)
    except Exception as exc:
        runtime_status = await manager.get_runtime_status(notebook_id)
        return {
            "notebookId": notebook_id,
            "cellId": target_cell_id,
            "cellType": target_type,
            "status": "error",
            "output": {"type": "error", "ename": exc.__class__.__name__, "evalue": str(exc)},
            "execCountIncrement": False,
            "securityProfile": security_profile_provider(),
            "freshRuntime": False,
            "replayedCellIds": [],
            "runtime": runtime_status,
        }

    execution_chunks = [cell_source_for_execution(target_cell, trig_mode, render_mode)]
    try:
        result, runtime_payload = await manager.execute_code(
            notebook_id,
            join_execution_chunks(execution_chunks),
            timeout_s,
        )
    except Exception as exc:
        if is_execution_timeout(exc):
            recovery_error = ""
            try:
                recovered_runtime = await manager.restart_runtime(notebook_id)
            except Exception as recovery_exc:
                recovered_runtime = {**runtime, "status": "error", "error": str(recovery_exc)}
                recovery_error = f" Runtime restart failed: {recovery_exc}"
            return {
                "notebookId": notebook_id,
                "cellId": target_cell_id,
                "cellType": target_type,
                "status": "error",
                "output": {
                    "type": "error",
                    "ename": exc.__class__.__name__,
                    "evalue": f"{exc} Runtime was restarted to recover from the timeout.{recovery_error}",
                },
                "execCountIncrement": False,
                "securityProfile": security_profile_provider(),
                "freshRuntime": True,
                "replayedCellIds": [],
                "runtime": {**recovered_runtime, "sessionState": "recreated-after-timeout", "freshRuntime": True},
            }
        return {
            "notebookId": notebook_id,
            "cellId": target_cell_id,
            "cellType": target_type,
            "status": "error",
            "output": {"type": "error", "ename": exc.__class__.__name__, "evalue": str(exc)},
            "execCountIncrement": False,
            "securityProfile": security_profile_provider(),
            "freshRuntime": False,
            "replayedCellIds": [],
            "runtime": {**runtime, "status": "error", "error": str(exc)},
        }

    fresh_runtime = runtime.get("sessionState") == "created"
    response = _build_execute_response(
        notebook_id=notebook_id,
        target_cell_id=target_cell_id,
        target_type=target_type,
        runtime={**runtime_payload, "sessionState": runtime.get("sessionState", "existing"), "freshRuntime": fresh_runtime},
        result=result,
        security_profile=security_profile_provider(),
        fresh_runtime=fresh_runtime,
    )
    return response
