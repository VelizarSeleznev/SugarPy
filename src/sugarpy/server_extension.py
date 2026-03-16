from __future__ import annotations

import ast
import json
import os
import re
import shutil
import tempfile
import textwrap
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

from jupyter_client.manager import AsyncKernelManager
from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest

from sugarpy.runtime_manager import RuntimeManager


OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
GROQ_API_ROOT = "https://api.groq.com/openai/v1"
DEFAULT_SECURITY_PROFILE = "restricted-demo"
DEFAULT_STORAGE_DIRNAME = "runtime"
DEFAULT_TIMEOUT_MS = 5.0
DEFAULT_START_TIMEOUT_MS = 12.0
DEFAULT_ASSISTANT_TRACES_ENABLED = False
MAX_EXEC_SOURCE_LENGTH = 8000
MAX_REPLAY_CELLS = 64
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
    profile = _security_profile()
    return profile in {"restricted-demo", "school-secure"}


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _storage_root() -> Path:
    configured = os.environ.get("SUGARPY_STORAGE_ROOT", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(os.path.expanduser(configured)))
    else:
        candidates.append(Path.home() / ".local" / "share" / "sugarpy" / DEFAULT_STORAGE_DIRNAME)
        candidates.append(_project_root() / ".sugarpy-runtime")

    for root in candidates:
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe = root / ".write-probe"
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
            return root
        except OSError:
            continue
    raise PermissionError("SugarPy could not find a writable runtime storage directory.")


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
    profile = _security_profile()
    return {
        "mode": profile,
        "model": _assistant_setting("SUGARPY_ASSISTANT_MODEL") or None,
        "assistantTracesEnabled": _assistant_traces_enabled(),
        "providers": {
            "openai": bool(_assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")),
            "gemini": bool(_assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")),
            "groq": bool(_assistant_setting("SUGARPY_ASSISTANT_GROQ_API_KEY")),
        },
        "execution": {
            "ephemeral": False,
            "networkEnabled": True,
            "directBrowserKernelAccess": False,
            "codeCellsRestricted": False,
            "assistantSandboxEphemeral": True,
            "runtimeBackend": os.environ.get("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "docker").strip() or "docker",
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


async def _execute_kernel_code(client: Any, code: str, timeout_s: float) -> dict[str, Any]:
    started_at = time.perf_counter()
    stdout = ""
    stderr = ""
    mime_data: dict[str, Any] = {}
    error_name: str | None = None
    error_value: str | None = None
    msg_id = client.execute(code, stop_on_error=True)
    idle = False

    while not idle:
        msg = await client.get_iopub_msg(timeout=timeout_s)
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
                stderr += text
            else:
                stdout += text
            continue
        if msg_type in {"execute_result", "display_data"}:
            data = content.get("data") or {}
            if isinstance(data, dict):
                for mime, value in data.items():
                    if mime == "text/plain":
                        mime_data[mime] = _truncate_text(str(mime_data.get(mime, "")) + str(value))
                    else:
                        mime_data[mime] = value
            continue
        if msg_type == "error":
            error_name = str(content.get("ename") or "Error")
            error_value = str(content.get("evalue") or "")
            traceback = content.get("traceback")
            if isinstance(traceback, list):
                stderr = stderr or "\n".join(str(line) for line in traceback)

    shell_reply = await client.get_shell_msg(timeout=timeout_s)
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
            "import io",
            "import sys",
            "import contextlib",
            "import sympy as sp",
            "from sympy import *",
            "from sympy import symbols",
            'x, y, z, t = symbols("x y z t")',
            "from IPython.display import display as __sugarpy_display",
            "from sugarpy.startup import plot",
            "def __sugarpy_emit_text(value):",
            "    if not value:",
            "        return",
            "    __sugarpy_display({'text/plain': str(value)}, raw=True)",
            "def __sugarpy_emit_output(value):",
            "    if value is None:",
            "        return",
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


def _wrap_code_for_notebook_display(source: str) -> str:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    if not tree.body:
        return source

    body_lines: list[str] = [
        "__sugarpy_stdout = io.StringIO()",
        "__sugarpy_stderr = io.StringIO()",
        "__sugarpy_has_value = False",
        "__sugarpy_value = None",
        "with contextlib.redirect_stdout(__sugarpy_stdout), contextlib.redirect_stderr(__sugarpy_stderr):",
    ]

    if isinstance(tree.body[-1], ast.Expr):
        prefix = ast.unparse(ast.Module(body=tree.body[:-1], type_ignores=[])).strip() if len(tree.body) > 1 else ""
        if prefix:
            body_lines.append(textwrap.indent(prefix, "    "))
        last_expr = ast.unparse(tree.body[-1].value).strip()
        if last_expr:
            body_lines.append(f"    __sugarpy_value = {last_expr}")
            body_lines.append("    __sugarpy_has_value = True")
    else:
        body_lines.append(textwrap.indent(source, "    "))

    body_lines.extend(
        [
            "__sugarpy_emit_text(__sugarpy_stdout.getvalue())",
            "if __sugarpy_stderr.getvalue():",
            "    print(__sugarpy_stderr.getvalue(), file=sys.stderr, end='')",
            "if __sugarpy_has_value:",
            "    __sugarpy_emit_output(__sugarpy_value)",
        ]
    )
    return "\n".join(body_lines)


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
    if cell_type == "custom":
        raise web.HTTPError(400, reason="Unsupported custom cell template")
    return _wrap_code_for_notebook_display(str(cell.get("source") or ""))


def _join_execution_chunks(chunks: list[str]) -> str:
    return "\n\n".join(chunk for chunk in chunks if chunk.strip())


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


async def execute_notebook_request(payload: dict[str, Any]) -> dict[str, Any]:
    cells = payload.get("cells")
    if not isinstance(cells, list):
        raise web.HTTPError(400, reason="cells must be a list")
    notebook_id = str(payload.get("notebookId") or "").strip()
    if not notebook_id:
        raise web.HTTPError(400, reason="notebookId is required")
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

    trig_mode = "rad" if payload.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if payload.get("defaultMathRenderMode") == "decimal" else "exact"
    timeout_s = min(
        max(float(payload.get("timeoutMs") or DEFAULT_TIMEOUT_MS), 0.25),
        DEFAULT_TIMEOUT_MS,
    )
    runtime_code = _cell_source_for_execution(target_cell, trig_mode, render_mode)
    try:
        result, runtime = await _runtime_manager().execute_in_runtime(notebook_id, runtime_code, timeout_s)
    except Exception as exc:
        return {
            "notebookId": notebook_id,
            "cellId": target_cell_id,
            "cellType": target_type,
            "status": "error",
            "output": {"type": "error", "ename": exc.__class__.__name__, "evalue": str(exc)},
            "execCountIncrement": False,
            "securityProfile": _security_profile(),
            "runtime": {
                "notebookId": notebook_id,
                "status": "error",
                "error": str(exc),
            },
        }

    response: dict[str, Any] = {
        "notebookId": notebook_id,
        "cellId": target_cell_id,
        "cellType": target_type,
        "status": result["status"],
        "execCountIncrement": result["status"] == "ok",
        "securityProfile": _security_profile(),
        "replayedCellIds": [],
        "runtime": runtime,
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

    if target_type == "custom":
        custom_payload = result["mimeData"].get("application/vnd.sugarpy.custom+json")
        if isinstance(custom_payload, dict):
            response["customOutput"] = custom_payload
        else:
            response["customOutput"] = {
                "schema_version": 1,
                "template_id": "unknown",
                "ok": False,
                "error": result.get("errorValue") or "Custom cell execution failed.",
            }
        return response

    if result["status"] == "error":
        response["output"] = {
            "type": "error",
            "ename": result.get("errorName") or "ExecutionError",
            "evalue": result.get("errorValue") or "",
        }
        return response

    output_data = dict(result["mimeData"])
    stdout = result.get("stdout") or ""
    if stdout:
        existing_plain = str(output_data.get("text/plain") or "")
        output_data["text/plain"] = f"{stdout}{existing_plain}"
    response["output"] = {"type": "mime", "data": output_data}
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


async def execute_sandbox_request(payload: dict[str, Any]) -> dict[str, Any]:
    request = payload.get("request") if isinstance(payload.get("request"), dict) else payload
    notebook_cells = payload.get("notebookCells") if isinstance(payload.get("notebookCells"), list) else []
    bootstrap_code = str(payload.get("bootstrapCode") or "").strip()
    target = "math" if request.get("target") == "math" else "code"
    context_preset = str(request.get("contextPreset") or ("selected-cells" if target == "math" else "bootstrap-only"))
    selected_cell_ids = {str(value) for value in request.get("selectedCellIds", [])} if isinstance(request.get("selectedCellIds"), list) else set()
    timeout_s = min(
        max(float(request.get("timeoutMs") or DEFAULT_TIMEOUT_MS) / 1000.0, 0.25),
        DEFAULT_TIMEOUT_MS,
    )
    trig_mode = "rad" if request.get("trigMode") == "rad" else "deg"
    render_mode = "decimal" if request.get("renderMode") == "decimal" else "exact"
    replayed_cell_ids: list[str] = []

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
                "executedBootstrap": False,
                "replayedCellIds": [],
            }
        if _sandbox_code_cells_restricted():
            errors = validate_restricted_python(code)
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
                    "executedBootstrap": False,
                    "replayedCellIds": [],
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
                "executedBootstrap": False,
                "replayedCellIds": [],
            }
        target_code = _build_math_validation_code(source, trig_mode, render_mode)

    replay_cells: list[dict[str, Any]] = []
    if context_preset == "imports-only":
        replay_cells = [
            cell
            for cell in notebook_cells[:MAX_REPLAY_CELLS]
            if isinstance(cell, dict)
            and str(cell.get("type") or "code") == "code"
            and str(cell.get("source") or "").strip().startswith(("import ", "from "))
        ]
    elif context_preset == "selected-cells":
        replay_cells = [
            cell
            for cell in notebook_cells[:MAX_REPLAY_CELLS]
            if isinstance(cell, dict)
            and str(cell.get("id") or "") in selected_cell_ids
            and str(cell.get("type") or "code") in ({"code", "math"} if target == "math" else {"code"})
        ]
    elif context_preset == "full-notebook-replay":
        replay_cells = [
            cell
            for cell in notebook_cells[:MAX_REPLAY_CELLS]
            if isinstance(cell, dict) and str(cell.get("type") or "code") in ({"code", "math"} if target == "math" else {"code"})
        ]

    kernel = AsyncKernelManager(kernel_name="python3")
    tmp_home = tempfile.mkdtemp(prefix="sugarpy-sandbox-")
    env = {
        "HOME": tmp_home,
        "PYTHONNOUSERSITE": "1",
        "IPYTHONDIR": tmp_home,
        "MPLCONFIGDIR": tmp_home,
        "SUGARPY_SECURITY_PROFILE": _security_profile(),
    }
    started_at = time.perf_counter()
    executed_bootstrap = False

    await kernel.start_kernel(env={**os.environ, **env})
    client = kernel.client()
    client.start_channels()
    try:
        await client.wait_for_ready(timeout=DEFAULT_START_TIMEOUT_MS)
        execution_chunks: list[str] = [_bootstrap_code()]
        if bootstrap_code:
            execution_chunks.append(bootstrap_code)
            executed_bootstrap = True
        for cell in replay_cells:
            execution_chunks.append(
                _build_math_validation_code(
                    str(cell.get("source") or ""),
                    "rad" if cell.get("mathTrigMode") == "rad" else "deg",
                    "decimal" if cell.get("mathRenderMode") == "decimal" else "exact",
                )
                if str(cell.get("type") or "code") == "math"
                else _wrap_code_for_notebook_display(str(cell.get("source") or ""))
            )
            replayed_cell_ids.append(str(cell.get("id") or ""))
        execution_chunks.append(target_code)

        result = await _execute_kernel_code(client, _join_execution_chunks(execution_chunks), timeout_s)
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
            "executedBootstrap": executed_bootstrap,
            "replayedCellIds": replayed_cell_ids,
        }
    finally:
        try:
            await kernel.shutdown_kernel(now=True)
        except Exception:
            pass
        try:
            client.stop_channels()
        except Exception:
            pass
        shutil.rmtree(tmp_home, ignore_errors=True)

    response = {
        "target": target,
        **result,
        "contextPresetUsed": context_preset,
        "executedBootstrap": executed_bootstrap,
        "replayedCellIds": replayed_cell_ids,
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


class RuntimeConnectHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        notebook_id = str(payload.get("notebookId") or "")
        if not notebook_id:
            raise web.HTTPError(400, reason="notebookId is required")
        self.finish(await _runtime_manager().ensure_runtime(notebook_id))


class RuntimeRestartHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        payload = self.get_json_body() or {}
        if not isinstance(payload, dict):
            raise web.HTTPError(400, reason="JSON body must be an object")
        notebook_id = str(payload.get("notebookId") or "")
        if not notebook_id:
            raise web.HTTPError(400, reason="notebookId is required")
        self.finish(await _runtime_manager().restart_runtime(notebook_id))


class RuntimeStatusHandler(SugarPyAPIHandler):
    async def get(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().get_runtime_status(notebook_id))

    async def delete(self, notebook_id: str) -> None:
        self.finish(await _runtime_manager().delete_runtime(notebook_id))


class RuntimeCleanupHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        self.finish(await _runtime_manager().cleanup_orphans())


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
    base_url = server_app.web_app.settings.get("base_url", "/")
    handlers = [
        (r"/sugarpy/api/config", SecurityConfigHandler),
        (r"/sugarpy/api/notebooks", NotebookCollectionHandler),
        (r"/sugarpy/api/notebooks/(.+)", NotebookHandler),
        (r"/sugarpy/api/autosave", AutosaveHandler),
        (r"/sugarpy/api/autosave/(.+)", AutosaveByIdHandler),
        (r"/sugarpy/api/runtime/connect", RuntimeConnectHandler),
        (r"/sugarpy/api/runtime/restart", RuntimeRestartHandler),
        (r"/sugarpy/api/runtime/cleanup", RuntimeCleanupHandler),
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


load_jupyter_server_extension = _load_jupyter_server_extension
