from __future__ import annotations

import ast
import contextlib
import json
import logging
import os
import queue
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from jupyter_server.base.handlers import APIHandler
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest
from tornado.ioloop import IOLoop, PeriodicCallback

from sugarpy.runtime_manager import RuntimeManager

from .server.config import (
    assistant_secret_file_path as _assistant_secret_file_path,
    assistant_setting as _assistant_setting,
    assistant_traces_enabled as _assistant_traces_enabled,
    load_assistant_server_config as _build_assistant_server_config,
    project_root as _project_root,
    sandbox_code_cells_restricted as _sandbox_code_cells_restricted,
    security_profile as _security_profile,
)
from .server.execution import (
    bootstrap_code as _bootstrap_code,
    build_math_code as _build_math_code,
    build_regression_code as _build_regression_code,
    build_stoich_code as _build_stoich_code,
    cell_source_for_execution as _cell_source_for_execution,
    execute_notebook_request as _execute_notebook_request,
    join_execution_chunks as _join_execution_chunks,
    merge_stdout_into_mime_data as _merge_stdout_into_mime_data,
    wrap_code_for_notebook_display as _wrap_code_for_notebook_display,
)
from .server.proxy import proxy_gemini_generate_content, proxy_groq_chat_completions, proxy_openai_responses
from .server.sandbox import (
    build_math_replay_code as _build_math_replay_code,
    execute_sandbox_request as _execute_sandbox_request,
    is_import_only_source as _is_import_only_source,
    is_replayable_sandbox_cell as _is_replayable_sandbox_cell,
    normalize_sandbox_context_preset as _normalize_sandbox_context_preset,
    sandbox_cell_context_source as _sandbox_cell_context_source,
    sandbox_cell_id as _sandbox_cell_id,
    wrap_replay_code as _wrap_replay_code,
)
from .server.security import (
    is_execution_timeout as _is_execution_timeout,
    loopback_hostname as _loopback_hostname,
    origin_allowed_for_host as _origin_allowed_for_host,
    truncate_mime_value as _truncate_mime_value,
    truncate_text as _truncate_text,
    validate_restricted_python,
)
from .server.storage import (
    autosave_path as _autosave_path,
    json_dump as _json_dump,
    json_load as _json_load,
    notebook_path as _notebook_path,
    normalize_notebook_payload as _normalize_notebook_payload,
    normalize_trace_payload as _normalize_trace_payload,
    safe_identifier as _safe_identifier,
    storage_root as _storage_root,
    storage_subdir as _storage_subdir,
    trace_path as _trace_path,
)

OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
GROQ_API_ROOT = "https://api.groq.com/openai/v1"
DEFAULT_SECURITY_PROFILE = "restricted-demo"
DEFAULT_STORAGE_DIRNAME = "runtime"
DEFAULT_NOTEBOOK_TIMEOUT_S = 20.0
DEFAULT_SANDBOX_TIMEOUT_S = 5.0
DEFAULT_ASSISTANT_TRACES_ENABLED = False
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


def _live_runtime_backend() -> str:
    return _runtime_manager().backend


def _live_code_cells_restricted() -> bool:
    return _live_runtime_backend() != "docker" and _sandbox_code_cells_restricted()


def _live_runtime_network_enabled() -> bool:
    return _live_runtime_backend() == "docker"


def _assistant_sandbox_available() -> bool:
    return _runtime_manager().backend == "docker"


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


def _load_assistant_server_config() -> dict[str, Any]:
    manager = _runtime_manager()
    return _build_assistant_server_config(
        runtime_backend=manager.backend,
        assistant_sandbox_available=manager.backend == "docker",
    )


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


async def execute_notebook_request(payload: dict[str, Any]) -> dict[str, Any]:
    return await _execute_notebook_request(
        payload,
        runtime_manager_factory=_runtime_manager,
        security_profile_provider=_security_profile,
        live_code_cells_restricted_provider=_live_code_cells_restricted,
    )


async def execute_sandbox_request(payload: dict[str, Any]) -> dict[str, Any]:
    return await _execute_sandbox_request(
        payload,
        runtime_manager_factory=_runtime_manager,
        assistant_sandbox_available_provider=_assistant_sandbox_available,
        sandbox_code_cells_restricted_provider=_sandbox_code_cells_restricted,
        security_profile_provider=_security_profile,
    )


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

        status, content_type, body = await proxy_openai_responses(api_key, payload)
        self.set_status(status)
        self.set_header("Content-Type", content_type)
        self.finish(body)


class AssistantGeminiProxyHandler(SugarPyAPIHandler):
    async def post(self, model: str) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server Gemini key is not configured."})
            return

        status, content_type, body = await proxy_gemini_generate_content(api_key, model, self.request.body)
        self.set_status(status)
        self.set_header("Content-Type", content_type)
        self.finish(body)


class AssistantGroqProxyHandler(SugarPyAPIHandler):
    async def post(self) -> None:
        api_key = _assistant_setting("SUGARPY_ASSISTANT_GROQ_API_KEY")
        if not api_key:
            self.set_status(503)
            self.finish({"error": "Server Groq key is not configured."})
            return

        status, content_type, body = await proxy_groq_chat_completions(api_key, self.request.body)
        self.set_status(status)
        self.set_header("Content-Type", content_type)
        self.finish(body)


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
