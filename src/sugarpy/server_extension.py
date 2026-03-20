from __future__ import annotations

import ast
import contextlib
import json
import logging
import os
import queue
import re
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.ioloop import IOLoop, PeriodicCallback

from sugarpy.runtime_manager import RuntimeManager


OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
GROQ_API_ROOT = "https://api.groq.com/openai/v1"
DEFAULT_SECURITY_PROFILE = "restricted-demo"
DEFAULT_STORAGE_DIRNAME = "runtime"
DEFAULT_NOTEBOOK_TIMEOUT_S = 20.0
DEFAULT_SANDBOX_TIMEOUT_S = 5.0
DEFAULT_ASSISTANT_TRACES_ENABLED = False
MAX_EXEC_SOURCE_LENGTH = 8000
ALLOWED_IMPORTS = {
    "math",
    "cmath",
    "statistics",
    "fractions",
    "decimal",
    "numpy",
    "sympy",
    "sugarpy",
}
BLOCKED_IMPORT_PREFIXES = (
    "os",
    "sys",
    "subprocess",
    "socket",
    "shutil",
    "pathlib",
    "requests",
    "urllib",
    "http",
    "ftplib",
    "telnetlib",
    "asyncio.subprocess",
    "multiprocessing",
    "ctypes",
    "pexpect",
)
BLOCKED_CALL_NAMES = {
    "open",
    "exec",
    "eval",
    "compile",
    "__import__",
    "input",
    "breakpoint",
}
BLOCKED_ATTR_CALLS = {
    "os.system",
    "os.popen",
    "os.spawnl",
    "os.spawnlp",
    "os.spawnv",
    "os.spawnvp",
    "os.execv",
    "os.execve",
    "os.execl",
    "os.execlp",
    "os.execvp",
    "os.execvpe",
    "subprocess.run",
    "subprocess.Popen",
    "subprocess.call",
    "subprocess.check_call",
    "subprocess.check_output",
    "socket.socket",
    "pathlib.Path.open",
}
_RUNTIME_MANAGER: RuntimeManager | None = None
_RUNTIME_CLEANUP_CALLBACK: PeriodicCallback | None = None
_LOGGER = logging.getLogger(__name__)


def _assistant_secret_file_path() -> str:
    configured = os.environ.get("SUGARPY_ASSISTANT_ENV_FILE", "").strip()
    if configured:
        return os.path.expanduser(configured)
    return os.path.expanduser("~/.config/sugarpy/assistant.env")


def _load_env_file_values(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except FileNotFoundError:
        return values
    except OSError:
        return values
    return values


def _assistant_setting(name: str) -> str:
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value
    return _load_env_file_values(_assistant_secret_file_path()).get(name, "").strip()


def _security_profile() -> str:
    return os.environ.get("SUGARPY_SECURITY_PROFILE", DEFAULT_SECURITY_PROFILE).strip() or DEFAULT_SECURITY_PROFILE


def _assistant_traces_enabled() -> bool:
    raw = os.environ.get("SUGARPY_ENABLE_ASSISTANT_TRACES", "").strip().lower()
    if not raw:
        return DEFAULT_ASSISTANT_TRACES_ENABLED
    return raw in {"1", "true", "yes", "on"}


def _sandbox_code_cells_restricted() -> bool:
    return _security_profile() in {"restricted-demo", "school-secure"}


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _live_runtime_backend() -> str:
    return _runtime_manager().backend


def _live_code_cells_restricted() -> bool:
    return _live_runtime_backend() != "docker" and _sandbox_code_cells_restricted()


def _live_runtime_network_enabled() -> bool:
    return _live_runtime_backend() == "docker"


def _assistant_sandbox_available() -> bool:
    return _runtime_manager().backend == "docker"


def _storage_root() -> Path:
    configured = os.environ.get("SUGARPY_STORAGE_ROOT", "").strip()
    if configured:
        root = Path(os.path.expanduser(configured))
    else:
        root = Path.home() / ".local" / "share" / "sugarpy" / DEFAULT_STORAGE_DIRNAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def _storage_subdir(name: str) -> Path:
    path = _storage_root() / name
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_identifier(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "-", (value or "").strip())
    normalized = normalized.strip("-.")
    return normalized or fallback


def _autosave_path(notebook_id: str) -> Path:
    return _storage_subdir("autosave") / f"{_safe_identifier(notebook_id, 'notebook')}.sugarpy"


def _notebook_path(notebook_id: str) -> Path:
    return _storage_subdir("notebooks") / f"{_safe_identifier(notebook_id, 'notebook')}.sugarpy"


def _trace_path(notebook_id: str, trace_id: str) -> Path:
    trace_dir = _storage_subdir("assistant-traces") / _safe_identifier(notebook_id, "notebook")
    trace_dir.mkdir(parents=True, exist_ok=True)
    return trace_dir / f"{_safe_identifier(trace_id, 'trace')}.json"


def _json_dump(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _json_load(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None


def _load_assistant_server_config() -> dict[str, Any]:
    runtime_backend = _live_runtime_backend()
    return {
        "mode": _security_profile(),
        "model": _assistant_setting("SUGARPY_ASSISTANT_MODEL") or None,
        "assistantTracesEnabled": _assistant_traces_enabled(),
        "providers": {
            "openai": bool(_assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")),
            "gemini": bool(_assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")),
            "groq": bool(_assistant_setting("SUGARPY_ASSISTANT_GROQ_API_KEY")),
        },
        "execution": {
            "ephemeral": False,
            "networkEnabled": _live_runtime_network_enabled(),
            "directBrowserKernelAccess": False,
            "codeCellsRestricted": _live_code_cells_restricted(),
            "assistantSandboxEphemeral": True,
            "assistantSandboxCodeCellsRestricted": _sandbox_code_cells_restricted(),
            "assistantSandboxAvailable": _assistant_sandbox_available(),
            "assistantSandboxDockerOnly": _security_profile() in {"restricted-demo", "school-secure"},
            "coldStartReplay": False,
            "runtimeBackend": runtime_backend,
        },
    }


def _normalize_notebook_payload(payload: dict[str, Any]) -> dict[str, Any]:
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


def _normalize_trace_payload(payload: dict[str, Any]) -> dict[str, Any]:
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


def _node_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _node_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""


def validate_restricted_python(source: str) -> list[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"Syntax error: {exc.msg}"]

    errors: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            else:
                module = node.module or ""
                names = [module] if module else []
            for name in names:
                if any(name == blocked or name.startswith(f"{blocked}.") for blocked in BLOCKED_IMPORT_PREFIXES):
                    errors.append(f"Import blocked in restricted mode: {name}")
                elif name and name.split(".", 1)[0] not in ALLOWED_IMPORTS:
                    errors.append(f"Import not allowed in restricted mode: {name}")
        elif isinstance(node, ast.Call):
            call_name = _node_name(node.func)
            if call_name in BLOCKED_CALL_NAMES or call_name in BLOCKED_ATTR_CALLS:
                errors.append(f"Call blocked in restricted mode: {call_name}")
            elif call_name.endswith(".open"):
                errors.append(f"File access blocked in restricted mode: {call_name}")
        elif isinstance(node, ast.Attribute):
            attr_name = _node_name(node)
            if attr_name.startswith("os.environ"):
                errors.append("Environment access blocked in restricted mode: os.environ")
    return sorted(set(errors))


def _truncate_text(value: str, limit: int = 4000) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: max(0, limit - 1)]}…"


def _truncate_mime_value(value: Any) -> Any:
    if isinstance(value, str):
        return _truncate_text(value, limit=4000)
    if isinstance(value, list):
        return [_truncate_mime_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _truncate_mime_value(entry) for key, entry in value.items()}


def _loopback_hostname(hostname: str) -> bool:
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _origin_allowed_for_host(candidate: str, host: str) -> bool:
    parsed = urlparse(candidate)
    if not parsed.netloc:
        return False
    candidate_host = parsed.hostname or ""
    host_name = host.split(":", 1)[0].strip("[]")
    if parsed.netloc == host:
        return True
    return _loopback_hostname(candidate_host) and _loopback_hostname(host_name)


def _is_execution_timeout(exc: Exception) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    return "timed out" in str(exc).lower()


async def _execute_kernel_code(client: Any, code: str, timeout_s: float) -> dict[str, Any]:
    started_at = time.perf_counter()
    deadline = time.monotonic() + timeout_s
    stdout = ""
    stderr = ""
    mime_data: dict[str, Any] = {}
    error_name: str | None = None
    error_value: str | None = None
    msg_id = client.execute(code, stop_on_error=True)
    idle = False

    while not idle:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"Notebook execution timed out after {timeout_s:.1f}s.")
        try:
            msg = await client.get_iopub_msg(timeout=remaining)
        except queue.Empty as exc:
            raise TimeoutError(f"Notebook execution timed out after {timeout_s:.1f}s.") from exc
        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        msg_type = msg.get("msg_type")
        content = msg.get("content", {})
        if msg_type == "status" and content.get("execution_state") == "idle":
            idle = True
            continue
        if msg_type == "stream":
            text = str(content.get("text") or "")
            if content.get("name") == "stderr":
                stderr = _truncate_text(stderr + text)
            else:
                stdout = _truncate_text(stdout + text)
            continue
        if msg_type in {"execute_result", "display_data"}:
            data = content.get("data") or {}
            if isinstance(data, dict):
                for mime, value in data.items():
                    if mime == "text/plain":
                        mime_data[mime] = _truncate_text(str(mime_data.get(mime, "")) + str(value))
                    else:
                        mime_data[mime] = _truncate_mime_value(value)
            continue
        if msg_type == "error":
            error_name = str(content.get("ename") or "Error")
            error_value = str(content.get("evalue") or "")
            traceback = content.get("traceback")
            if isinstance(traceback, list):
                stderr = stderr or "\n".join(str(line) for line in traceback)

    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError(f"Notebook execution timed out after {timeout_s:.1f}s.")
    try:
        shell_reply = await client.get_shell_msg(timeout=remaining)
    except queue.Empty as exc:
        raise TimeoutError(f"Notebook execution timed out after {timeout_s:.1f}s.") from exc
    if shell_reply.get("parent_header", {}).get("msg_id") != msg_id:
        raise RuntimeError("Kernel shell reply did not match the execution request.")

    return {
        "status": "error" if error_name else "ok",
        "stdout": _truncate_text(stdout),
        "stderr": _truncate_text(stderr),
        "mimeData": mime_data,
        "errorName": error_name,
        "errorValue": error_value,
        "durationMs": int((time.perf_counter() - started_at) * 1000),
    }


def _bootstrap_code() -> str:
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


def _build_math_code(source: str, trig_mode: str, render_mode: str) -> str:
    return "\n".join(
        [
            "from sugarpy.math_cell import display_math_cell",
            f"_ = display_math_cell({json.dumps(source)}, {json.dumps(trig_mode)}, {json.dumps(render_mode)})",
        ]
    )


def _build_stoich_code(reaction: str, inputs: dict[str, Any]) -> str:
    return "\n".join(
        [
            "from sugarpy.stoichiometry import display_stoichiometry",
            f"_ = display_stoichiometry({json.dumps(reaction)}, {json.dumps(inputs)})",
        ]
    )


def _build_regression_code(points: list[dict[str, Any]], model: str, x_label: str, y_label: str) -> str:
    return "\n".join(
        [
            "from sugarpy.regression import display_regression",
            f"_ = display_regression({json.dumps(points)}, {json.dumps(model)}, x_label={json.dumps(x_label)}, y_label={json.dumps(y_label)})",
        ]
    )


def _wrap_code_for_notebook_display(source: str) -> str:
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
    if (
        isinstance(last_value, ast.Call)
        and isinstance(last_value.func, ast.Name)
        and last_value.func.id == "print"
    ):
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


def _cell_source_for_execution(cell: dict[str, Any], trig_mode: str, render_mode: str) -> str:
    cell_type = str(cell.get("type") or "code")
    if cell_type == "math":
        return _build_math_code(
            str(cell.get("source") or ""),
            "rad" if cell.get("mathTrigMode") == "rad" else trig_mode,
            "decimal" if cell.get("mathRenderMode") == "decimal" else render_mode,
        )
    if cell_type == "stoich":
        state = cell.get("stoichState") if isinstance(cell.get("stoichState"), dict) else {}
        reaction = str(state.get("reaction") or "")
        inputs = state.get("inputs") if isinstance(state.get("inputs"), dict) else {}
        return _build_stoich_code(reaction, inputs)
    if cell_type == "regression":
        state = cell.get("regressionState") if isinstance(cell.get("regressionState"), dict) else {}
        points = state.get("points") if isinstance(state.get("points"), list) else []
        model = str(state.get("model") or "linear")
        labels = state.get("labels") if isinstance(state.get("labels"), dict) else {}
        x_label = str(labels.get("x") or "x")
        y_label = str(labels.get("y") or "y")
        return _build_regression_code(points, model, x_label, y_label)
    return _wrap_code_for_notebook_display(str(cell.get("source") or ""))


def _join_execution_chunks(chunks: list[str]) -> str:
    return "\n\n".join(chunk for chunk in chunks if chunk.strip())


def _merge_stdout_into_mime_data(stdout: str, mime_data: dict[str, Any]) -> dict[str, Any]:
    if not stdout:
        return dict(mime_data)
    merged = dict(mime_data)
    existing = str(merged.get("text/plain") or "")
    merged["text/plain"] = f"{stdout}{existing}"
    return merged


def _runtime_manager() -> RuntimeManager:
    global _RUNTIME_MANAGER
    if _RUNTIME_MANAGER is None:
        _RUNTIME_MANAGER = RuntimeManager(
            storage_root=_storage_root(),
            project_root=_project_root(),
            bootstrap_code=_bootstrap_code(),
            executor=_execute_kernel_code,
        )
    return _RUNTIME_MANAGER


def _runtime_cleanup_interval_ms() -> int:
    raw = os.environ.get("SUGARPY_RUNTIME_CLEANUP_INTERVAL_MS", "").strip()
    if not raw:
        return 60_000
    try:
        parsed = int(raw)
    except ValueError:
        return 60_000
    return max(1_000, parsed)


async def _background_runtime_cleanup() -> None:
    manager = _runtime_manager()
    try:
        await manager.cleanup_orphans()
        await manager.cleanup_idle_runtimes()
    except Exception:
        _LOGGER.exception("Background runtime cleanup failed.")


async def execute_notebook_request(payload: dict[str, Any]) -> dict[str, Any]:
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

    if target_type == "code" and _live_code_cells_restricted():
        errors = validate_restricted_python(target_source)
        if errors:
            return {
                "notebookId": notebook_id,
                "cellId": target_cell_id,
                "cellType": target_type,
                "status": "error",
                "output": {"type": "error", "ename": "RestrictedExecution", "evalue": "; ".join(errors)},
                "execCountIncrement": False,
                "securityProfile": _security_profile(),
            }

    trig_mode = "rad" if payload.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if payload.get("defaultMathRenderMode") == "decimal" else "exact"
    timeout_s = min(
        max(float(payload.get("timeoutMs") or DEFAULT_NOTEBOOK_TIMEOUT_S * 1000.0) / 1000.0, 0.25),
        DEFAULT_NOTEBOOK_TIMEOUT_S,
    )
    manager = _runtime_manager()
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
            "securityProfile": _security_profile(),
            "freshRuntime": False,
            "replayedCellIds": [],
            "runtime": runtime_status,
        }

    replay_cells: list[dict[str, Any]] = []
    execution_chunks = [_cell_source_for_execution(target_cell, trig_mode, render_mode)]
    try:
        result, runtime_payload = await manager.execute_code(
            notebook_id,
            _join_execution_chunks(execution_chunks),
            timeout_s,
        )
    except Exception as exc:
        if _is_execution_timeout(exc):
            recovery_error = ""
            try:
                recovered_runtime = await _runtime_manager().restart_runtime(notebook_id)
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
                "securityProfile": _security_profile(),
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
            "securityProfile": _security_profile(),
            "freshRuntime": False,
            "replayedCellIds": [],
            "runtime": {**runtime, "status": "error", "error": str(exc)},
        }

    fresh_runtime = runtime.get("sessionState") == "created"
    response: dict[str, Any] = {
        "notebookId": notebook_id,
        "cellId": target_cell_id,
        "cellType": target_type,
        "status": result["status"],
        "execCountIncrement": result["status"] == "ok",
        "securityProfile": _security_profile(),
        "freshRuntime": fresh_runtime,
        "replayedCellIds": [],
        "runtime": {**runtime_payload, "sessionState": runtime.get("sessionState", "existing"), "freshRuntime": fresh_runtime},
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
                "mode": trig_mode,
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
        "data": _merge_stdout_into_mime_data(str(result.get("stdout") or ""), result["mimeData"]),
    }
    return response


def _parse_math_validation(stdout: str) -> dict[str, Any] | None:
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


def _build_math_validation_code(source: str, trig_mode: str, render_mode: str) -> str:
    return "\n".join(
        [
            "import json",
            "from sugarpy.math_cell import render_math_cell",
            f"_result = render_math_cell({json.dumps(source)}, mode={json.dumps(trig_mode)}, render_mode={json.dumps(render_mode)})",
            "_summary = {",
            "  'kind': _result.get('kind'),",
            "  'error': _result.get('error'),",
            "  'warnings': _result.get('warnings') or [],",
            "  'steps': (_result.get('steps') or [])[:6],",
            "  'plotly_figure': bool(_result.get('plotly_figure')),",
            "}",
            "print(json.dumps(_summary))",
        ]
    )


def _normalize_sandbox_context_preset(value: Any) -> str:
    raw = str(value or "").strip()
    if raw in {"none", "bootstrap-only", "imports-only", "selected-cells", "full-notebook-replay"}:
        return raw
    return "none"


def _sandbox_cell_id(cell: dict[str, Any]) -> str:
    return str(cell.get("id") or "").strip()


def _sandbox_cell_context_source(cell: dict[str, Any]) -> str:
    return "draft" if str(cell.get("contextSource") or "").strip() == "draft" else "notebook"


def _is_replayable_sandbox_cell(cell: dict[str, Any]) -> bool:
    return str(cell.get("type") or "code") in {"code", "math"} and bool(str(cell.get("source") or "").strip())


def _is_import_only_source(source: str) -> bool:
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


def _build_math_replay_code(source: str, trig_mode: str, render_mode: str) -> str:
    return "\n".join(
        [
            "from sugarpy.math_cell import render_math_cell",
            f"_ = render_math_cell({json.dumps(source)}, mode={json.dumps(trig_mode)}, render_mode={json.dumps(render_mode)})",
        ]
    )


def _wrap_replay_code(source: str) -> str:
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


def _build_sandbox_replay_chunks(
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
        if not _is_replayable_sandbox_cell(cell):
            continue
        cell_id = _sandbox_cell_id(cell)
        cell_type = str(cell.get("type") or "code")
        if context_preset == "imports-only":
            if cell_type != "code" or not _is_import_only_source(str(cell.get("source") or "")):
                continue
        elif context_preset == "selected-cells":
            if cell_id not in selected_lookup:
                continue
        source = str(cell.get("source") or "")
        if cell_type == "code":
            chunks.append(_wrap_replay_code(source))
        else:
            chunks.append(
                _wrap_replay_code(
                    _build_math_replay_code(
                        source,
                        "rad" if cell.get("mathTrigMode") == "rad" else trig_mode,
                        "decimal" if cell.get("mathRenderMode") == "decimal" else render_mode,
                    )
                )
            )
        replayed_ids.append(cell_id)
        source_kind = _sandbox_cell_context_source(cell)
        if source_kind not in context_sources:
            context_sources.append(source_kind)
    return chunks, replayed_ids, context_sources


async def execute_sandbox_request(payload: dict[str, Any]) -> dict[str, Any]:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else payload
    _notebook_cells = [cell for cell in payload.get("notebookCells", []) if isinstance(cell, dict)]
    _bootstrap_code = str(payload.get("bootstrapCode") or "").strip()
    target = "math" if request.get("target") == "math" else "code"
    context_preset = _normalize_sandbox_context_preset(request.get("contextPreset"))
    selected_cell_ids = [str(item) for item in request.get("selectedCellIds", [])] if isinstance(request.get("selectedCellIds"), list) else []
    timeout_s = min(
        max(float(request.get("timeoutMs") or DEFAULT_SANDBOX_TIMEOUT_S * 1000.0) / 1000.0, 0.25),
        DEFAULT_SANDBOX_TIMEOUT_S,
    )
    trig_mode = "rad" if request.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if request.get("renderMode") == "decimal" else "exact"
    manager = _runtime_manager()
    replay_chunks, replayed_cell_ids, replay_context_sources = _build_sandbox_replay_chunks(
        _notebook_cells,
        context_preset,
        selected_cell_ids,
        trig_mode,
        render_mode,
    )
    executed_bootstrap = bool(_bootstrap_code)
    context_sources_used = (["bootstrap"] if executed_bootstrap else []) + replay_context_sources

    if not _assistant_sandbox_available():
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
        if _sandbox_code_cells_restricted():
            replay_code_sources = [
                str(cell.get("source") or "")
                for cell in _notebook_cells
                if str(cell.get("type") or "code") == "code" and _sandbox_cell_id(cell) in set(replayed_cell_ids)
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
        target_code = _wrap_code_for_notebook_display(code)
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
        target_code = _build_math_validation_code(source, trig_mode, render_mode)

    execution_chunks = [chunk for chunk in [_bootstrap_code, *replay_chunks, target_code] if chunk.strip()]
    sandbox_notebook_id = f"assistant-sandbox-{uuid.uuid4().hex}"
    started_at = time.perf_counter()
    try:
        result, _runtime_payload = await manager.execute_in_runtime(
            sandbox_notebook_id,
            _join_execution_chunks(execution_chunks),
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
        response["mathValidation"] = _parse_math_validation(result.get("stdout") or "") or {
            "error": result.get("errorValue") or "Math validation failed.",
            "warnings": [],
            "stepsPreview": [],
            "hasPlot": False,
        }
        if response["status"] == "ok" and response["mathValidation"].get("error"):
            response["status"] = "error"
    return response

class SugarPyAPIHandler(APIHandler):
    def check_xsrf_cookie(self) -> None:
        origin = self.request.headers.get("Origin", "").strip()
        referer = self.request.headers.get("Referer", "").strip()
        host = self.request.headers.get("Host", "").strip()
        for candidate in (origin, referer):
            if not candidate or not host:
                continue
            if _origin_allowed_for_host(candidate, host):
                return
        super().check_xsrf_cookie()


class SecurityConfigHandler(SugarPyAPIHandler):
    async def get(self) -> None:
        self.finish(_load_assistant_server_config())


class NotebookHandler(SugarPyAPIHandler):
    async def get(self, notebook_id: str) -> None:
        payload = _json_load(_notebook_path(notebook_id))
        if not payload:
            self.set_status(404)
            self.finish({"error": "Notebook not found."})
            return
        self.finish(payload)

    async def put(self, notebook_id: str) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        normalized = _normalize_notebook_payload({**payload, "id": notebook_id})
        _json_dump(_notebook_path(notebook_id), normalized)
        self.finish(normalized)


class NotebookCollectionHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        normalized = _normalize_notebook_payload(payload)
        _json_dump(_notebook_path(normalized["id"]), normalized)
        self.set_status(201)
        self.finish(normalized)


class AutosaveHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        normalized = _normalize_notebook_payload(payload)
        _json_dump(_autosave_path(normalized["id"]), normalized)
        self.finish(normalized)


class AutosaveByIdHandler(SugarPyAPIHandler):
    async def get(self, notebook_id: str) -> None:
        payload = _json_load(_autosave_path(notebook_id))
        if not payload:
            self.set_status(404)
            self.finish({"error": "Autosave not found."})
            return
        self.finish(payload)


class RuntimeStatusHandler(SugarPyAPIHandler):
    async def get(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().get_runtime_status(notebook_id))


class RuntimeInterruptHandler(SugarPyAPIHandler):
    async def post(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().interrupt_runtime(notebook_id))


class RuntimeRestartHandler(SugarPyAPIHandler):
    async def post(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().restart_runtime(notebook_id))


class RuntimeDeleteHandler(SugarPyAPIHandler):
    async def post(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().delete_runtime(notebook_id))


class TraceHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        if not _assistant_traces_enabled():
            self.finish({"stored": False, "reason": "assistant traces disabled"})
            return
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        notebook_id = str(payload.get("notebookId") or "")
        trace_id = str(payload.get("id") or "")
        if not notebook_id or not trace_id:
            raise web.HTTPError(400, reason="Trace requires notebookId and id")
        _json_dump(_trace_path(notebook_id, trace_id), _normalize_trace_payload(payload))
        self.finish({"stored": True})


class ExecuteHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        self.finish(await execute_notebook_request(payload))


class SandboxHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        self.finish(await execute_sandbox_request(payload))


class AssistantConfigHandler(SugarPyAPIHandler):
    async def get(self) -> None:
        self.finish(_load_assistant_server_config())


class AssistantOpenAIProxyHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server OpenAI key is not configured."})
            return

        try:
            payload = self.get_json_body() or {}
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        payload["stream"] = False

        client = AsyncHTTPClient()
        response = await client.fetch(
            HTTPRequest(
                OPENAI_API_URL,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                body=json.dumps(payload),
                request_timeout=120,
                connect_timeout=20,
                follow_redirects=False,
            ),
            raise_error=False,
        )
        self.set_status(response.code or 502)
        self.set_header(
            "Content-Type",
            response.headers.get("Content-Type", "application/json"),
        )
        self.finish(response.body or b"")


class AssistantGeminiProxyHandler(SugarPyAPIHandler):
    async def post(self, model: str) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server Gemini key is not configured."})
            return

        query = urlencode({"key": api_key})
        upstream_url = f"{GEMINI_API_ROOT}/models/{model}:generateContent?{query}"
        client = AsyncHTTPClient()
        response = await client.fetch(
            HTTPRequest(
                upstream_url,
                method="POST",
                headers={"Content-Type": "application/json"},
                body=self.request.body,
                request_timeout=120,
                connect_timeout=20,
                follow_redirects=False,
            ),
            raise_error=False,
        )
        self.set_status(response.code)
        self.set_header(
            "Content-Type",
            response.headers.get("Content-Type", "application/json"),
        )
        self.finish(response.body or b"")


class AssistantGroqProxyHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_GROQ_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server Groq key is not configured."})
            return

        client = AsyncHTTPClient()
        response = await client.fetch(
            HTTPRequest(
                f"{GROQ_API_ROOT}/chat/completions",
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                body=self.request.body,
                request_timeout=120,
                connect_timeout=20,
                follow_redirects=False,
            ),
            raise_error=False,
        )
        self.set_status(response.code or 502)
        self.set_header(
            "Content-Type",
            response.headers.get("Content-Type", "application/json"),
        )
        self.finish(response.body or b"")


def _jupyter_server_extension_points() -> list[dict[str, str]]:
    return [{"module": "sugarpy.server_extension"}]


def _load_jupyter_server_extension(server_app: Any) -> None:
    global _RUNTIME_CLEANUP_CALLBACK
    base_url = server_app.web_app.settings.get("base_url", "/")
    handlers = [
        (r"/sugarpy/api/config", SecurityConfigHandler),
        (r"/sugarpy/api/notebooks", NotebookCollectionHandler),
        (r"/sugarpy/api/notebooks/(.+)", NotebookHandler),
        (r"/sugarpy/api/autosave", AutosaveHandler),
        (r"/sugarpy/api/autosave/(.+)", AutosaveByIdHandler),
        (r"/sugarpy/api/runtime/(.+)/interrupt", RuntimeInterruptHandler),
        (r"/sugarpy/api/runtime/(.+)/restart", RuntimeRestartHandler),
        (r"/sugarpy/api/runtime/(.+)/delete", RuntimeDeleteHandler),
        (r"/sugarpy/api/runtime/(.+)", RuntimeStatusHandler),
        (r"/sugarpy/api/execute", ExecuteHandler),
        (r"/sugarpy/api/sandbox", SandboxHandler),
        (r"/sugarpy/api/traces", TraceHandler),
        (r"/sugarpy/api/assistant/config", AssistantConfigHandler),
        (r"/sugarpy/api/assistant/openai/responses", AssistantOpenAIProxyHandler),
        (r"/sugarpy/api/assistant/gemini/models/(.+):generateContent", AssistantGeminiProxyHandler),
        (r"/sugarpy/api/assistant/groq/chat/completions", AssistantGroqProxyHandler),
    ]
    server_app.web_app.add_handlers(".*$", [(f"{base_url.rstrip('/')}{route}", handler) for route, handler in handlers])
    if _RUNTIME_CLEANUP_CALLBACK is not None:
        _RUNTIME_CLEANUP_CALLBACK.stop()
    io_loop = getattr(server_app, "io_loop", None) or IOLoop.current()

    def _schedule_runtime_cleanup() -> None:
        io_loop.spawn_callback(_background_runtime_cleanup)

    _RUNTIME_CLEANUP_CALLBACK = PeriodicCallback(_schedule_runtime_cleanup, _runtime_cleanup_interval_ms())
    _RUNTIME_CLEANUP_CALLBACK.start()
    _schedule_runtime_cleanup()


load_jupyter_server_extension = _load_jupyter_server_extension
