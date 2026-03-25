from __future__ import annotations

import asyncio
import contextlib
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol

from IPython.core.interactiveshell import InteractiveShell
from ipykernel.inprocess.ipkernel import InProcessInteractiveShell
from ipykernel.inprocess.manager import InProcessKernelManager
from jupyter_client.asynchronous.client import AsyncKernelClient


DEFAULT_RUNTIME_IMAGE = "sugarpy-runtime:latest"
DEFAULT_RUNTIME_BACKEND = "docker"
DEFAULT_IDLE_TIMEOUT_S = 1800.0
DEFAULT_RUNTIME_START_TIMEOUT_S = 20.0
DEFAULT_EXEC_TIMEOUT_S = 20.0
CONTAINER_WORKDIR = "/runtime/workspace"
RUNTIME_CONTAINER_PREFIX = "sugarpy-rt"
MAX_STREAM_TEXT_LENGTH = 4000
MAX_MIME_TEXT_LENGTH = 4000
MAX_MIME_OBJECT_ENTRIES = 20
RESTRICTED_DOCKER_ONLY_PROFILES = {"restricted-demo", "school-secure"}

KernelExecutor = Callable[[Any, str, float], Awaitable[dict[str, Any]]]


def _runtime_manager_override(name: str, fallback: Any) -> Any:
    runtime_manager_module = sys.modules.get("sugarpy.runtime_manager")
    if runtime_manager_module is None:
        return fallback
    return getattr(runtime_manager_module, name, fallback)


class RuntimeSession(Protocol):
    record: "RuntimeRecord"

    async def start(self) -> None: ...

    async def attach(self) -> bool: ...

    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]: ...

    async def interrupt(self) -> bool: ...

    async def restart(self) -> None: ...

    async def stop(self, remove_workspace: bool) -> None: ...

    async def is_running(self) -> bool: ...


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _safe_identifier(value: str, fallback: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in (value or "").strip())
    normalized = normalized.strip("-.")
    return normalized or fallback


def _reserve_kernel_ports() -> dict[str, int]:
    names = ("shell_port", "iopub_port", "stdin_port", "control_port", "hb_port")
    sockets: list[socket.socket] = []
    try:
        reserved: dict[str, int] = {}
        for name in names:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(("127.0.0.1", 0))
            reserved[name] = int(sock.getsockname()[1])
            sockets.append(sock)
        return reserved
    finally:
        for sock in sockets:
            with contextlib.suppress(OSError):
                sock.close()


def _container_user_flag() -> list[str]:
    getuid = getattr(os, "getuid", None)
    getgid = getattr(os, "getgid", None)
    if getuid is None or getgid is None:
        return []
    return ["--user", f"{getuid()}:{getgid()}"]


async def _run_command(args: list[str]) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await process.communicate()
    return (
        process.returncode,
        stdout_bytes.decode("utf-8", errors="replace").strip(),
        stderr_bytes.decode("utf-8", errors="replace").strip(),
    )


def _truncate_text(value: str, limit: int = MAX_STREAM_TEXT_LENGTH) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: max(0, limit - 1)]}…"


def _truncate_mime_value(value: Any) -> Any:
    if isinstance(value, str):
        return _truncate_text(value, limit=MAX_MIME_TEXT_LENGTH)
    if isinstance(value, list):
        return [_truncate_mime_value(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _truncate_mime_value(entry) for key, entry in value.items()}


@dataclass
class RuntimeRecord:
    notebook_id: str
    status: str
    backend: str
    container_name: str
    workspace_path: str
    connection_file_path: str
    created_at: str
    last_activity_at: str
    image: str
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "notebookId": self.notebook_id,
            "status": self.status,
            "backend": self.backend,
            "containerName": self.container_name,
            "workspacePath": self.workspace_path,
            "connectionFilePath": self.connection_file_path,
            "createdAt": self.created_at,
            "lastActivityAt": self.last_activity_at,
            "image": self.image,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "RuntimeRecord":
        return cls(
            notebook_id=str(payload.get("notebookId") or "notebook"),
            status=str(payload.get("status") or "disconnected"),
            backend=str(payload.get("backend") or DEFAULT_RUNTIME_BACKEND),
            container_name=str(payload.get("containerName") or ""),
            workspace_path=str(payload.get("workspacePath") or ""),
            connection_file_path=str(payload.get("connectionFilePath") or ""),
            created_at=str(payload.get("createdAt") or _utc_now()),
            last_activity_at=str(payload.get("lastActivityAt") or _utc_now()),
            image=str(payload.get("image") or DEFAULT_RUNTIME_IMAGE),
            error=str(payload.get("error")) if payload.get("error") else None,
        )


class DockerCommandError(RuntimeError):
    pass


class DockerKernelRuntime:
    def __init__(
        self,
        record: RuntimeRecord,
        *,
        project_root: Path,
        bootstrap_code: str,
        executor: KernelExecutor,
        start_timeout_s: float,
        exec_timeout_s: float,
    ) -> None:
        self.record = record
        self.project_root = project_root
        self.bootstrap_code = bootstrap_code
        self.executor = executor
        self.start_timeout_s = start_timeout_s
        self.exec_timeout_s = exec_timeout_s
        self.workspace_path = Path(record.workspace_path)
        self.connection_file = Path(record.connection_file_path)
        self.client: AsyncKernelClient | None = None
        self.connection_ports: dict[str, int] = {}
        self.last_interrupt_recovered = False

    async def start(self) -> None:
        self.workspace_path.mkdir(parents=True, exist_ok=True)
        self.connection_file.unlink(missing_ok=True)
        await self._remove_container()
        await self._run_container()
        await self._wait_for_connection_file()
        await self._connect_client()
        await self.executor(self.client, self.bootstrap_code, self.exec_timeout_s)  # type: ignore[arg-type]

    async def attach(self) -> bool:
        if not self.connection_file.exists():
            return False
        if not await self.is_running():
            return False
        try:
            await self._connect_client()
        except OSError:
            return False
        return True

    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("Notebook runtime client is not connected.")
        return await self.executor(self.client, code, timeout_s)

    async def interrupt(self) -> bool:
        self.last_interrupt_recovered = False
        if self.client is not None:
            with contextlib.suppress(Exception):
                msg = self.client.session.msg("interrupt_request", content={})
                self.client.control_channel.send(msg)
                self.last_interrupt_recovered = await self._wait_for_kernel_responsive()
                return True
        run_command = _runtime_manager_override("_run_command", _run_command)
        code, _stdout, _stderr = await run_command(["docker", "kill", "--signal=SIGINT", self.record.container_name])
        if code != 0:
            return False
        self.last_interrupt_recovered = await self._wait_for_kernel_responsive()
        return True

    async def restart(self) -> None:
        await self.stop(remove_workspace=False)
        await self.start()

    async def stop(self, remove_workspace: bool) -> None:
        if self.client is not None:
            with contextlib.suppress(Exception):
                self.client.stop_channels()
            self.client = None
        await self._remove_container()
        if remove_workspace:
            shutil.rmtree(self.workspace_path, ignore_errors=True)

    async def is_running(self) -> bool:
        run_command = _runtime_manager_override("_run_command", _run_command)
        code, stdout, _stderr = await run_command(["docker", "inspect", "-f", "{{.State.Running}}", self.record.container_name])
        return code == 0 and stdout.strip().lower() == "true"

    async def _run_container(self) -> None:
        reserve_kernel_ports = _runtime_manager_override("_reserve_kernel_ports", _reserve_kernel_ports)
        container_user_flag = _runtime_manager_override("_container_user_flag", _container_user_flag)
        run_command = _runtime_manager_override("_run_command", _run_command)
        self.connection_ports = reserve_kernel_ports()
        publish_args: list[str] = []
        for port in self.connection_ports.values():
            publish_args.extend(["-p", f"{port}:{port}"])
        args = [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            self.record.container_name,
            *container_user_flag(),
            "--memory",
            os.environ.get("SUGARPY_RUNTIME_MEMORY", "1g"),
            "--cpus",
            os.environ.get("SUGARPY_RUNTIME_CPUS", "1.0"),
            "--pids-limit",
            os.environ.get("SUGARPY_RUNTIME_PIDS_LIMIT", "128"),
            *publish_args,
            "-e",
            "PYTHONUNBUFFERED=1",
            "-e",
            "PYTHONDONTWRITEBYTECODE=1",
            "-e",
            "PYTHONPATH=/opt/sugarpy/app/src",
            "-e",
            f"HOME={CONTAINER_WORKDIR}",
            "-e",
            f"IPYTHONDIR={CONTAINER_WORKDIR}/.ipython",
            "-e",
            f"MPLCONFIGDIR={CONTAINER_WORKDIR}/.config/matplotlib",
            "-e",
            f"SUGARPY_SECURITY_PROFILE={os.environ.get('SUGARPY_SECURITY_PROFILE', 'container-live')}",
            "-v",
            f"{self.project_root.resolve()}:/opt/sugarpy/app:ro",
            "-v",
            f"{self.workspace_path.resolve()}:{CONTAINER_WORKDIR}",
            "-w",
            CONTAINER_WORKDIR,
            self.record.image,
            "python",
            "-m",
            "ipykernel_launcher",
            "-f",
            f"{CONTAINER_WORKDIR}/{self.connection_file.name}",
            "--IPKernelApp.ip=0.0.0.0",
            f"--IPKernelApp.shell_port={self.connection_ports['shell_port']}",
            f"--IPKernelApp.iopub_port={self.connection_ports['iopub_port']}",
            f"--IPKernelApp.stdin_port={self.connection_ports['stdin_port']}",
            f"--IPKernelApp.control_port={self.connection_ports['control_port']}",
            f"--IPKernelApp.hb_port={self.connection_ports['hb_port']}",
        ]
        code, stdout, stderr = await run_command(args)
        if code != 0:
            raise DockerCommandError(stderr or stdout or "docker run failed")

    async def _remove_container(self) -> None:
        run_command = _runtime_manager_override("_run_command", _run_command)
        await run_command(["docker", "rm", "-f", self.record.container_name])

    async def _wait_for_connection_file(self) -> None:
        deadline = time.monotonic() + self.start_timeout_s
        while time.monotonic() < deadline:
            if self.connection_file.exists():
                payload = json.loads(self.connection_file.read_text(encoding="utf-8"))
                payload["ip"] = "127.0.0.1"
                for key, value in self.connection_ports.items():
                    payload[key] = value
                self.connection_file.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
                return
            await asyncio.sleep(0.2)
        raise RuntimeError(f"Notebook runtime did not create {self.connection_file.name} within {self.start_timeout_s:.0f}s.")

    async def _connect_client(self) -> None:
        if self.client is not None:
            with contextlib.suppress(Exception):
                self.client.stop_channels()
        client = AsyncKernelClient()
        client.load_connection_file(str(self.connection_file))
        client.start_channels()
        try:
            await client.wait_for_ready(timeout=self.start_timeout_s)
        except Exception:
            with contextlib.suppress(Exception):
                client.stop_channels()
            raise
        self.client = client

    async def _wait_for_kernel_responsive(self, timeout_s: float = 2.0) -> bool:
        if self.client is None:
            return False
        await asyncio.sleep(0.15)
        try:
            await self.client.kernel_info(reply=True, timeout=timeout_s)
            return True
        except Exception:
            return False


class InProcessKernelRuntime:
    def __init__(
        self,
        record: RuntimeRecord,
        *,
        bootstrap_code: str,
        executor: KernelExecutor,
        exec_timeout_s: float,
    ) -> None:
        self.record = record
        self.bootstrap_code = bootstrap_code
        self.executor = executor
        self.exec_timeout_s = exec_timeout_s
        self.workspace_path = Path(record.workspace_path)
        self.kernel: InProcessKernelManager | None = None
        self.client: Any = None
        self.previous_shell_instance: Any = None

    async def start(self) -> None:
        self.workspace_path.mkdir(parents=True, exist_ok=True)
        self.previous_shell_instance = getattr(InteractiveShell, "_instance", None)
        self._clear_shell_singletons(InProcessInteractiveShell)
        if self.previous_shell_instance is not None:
            self._clear_shell_singletons(type(self.previous_shell_instance))
        original_home = os.environ.get("HOME")
        original_ipython = os.environ.get("IPYTHONDIR")
        original_mpl = os.environ.get("MPLCONFIGDIR")
        try:
            os.environ["HOME"] = str(self.workspace_path)
            os.environ["IPYTHONDIR"] = str(self.workspace_path / ".ipython")
            os.environ["MPLCONFIGDIR"] = str(self.workspace_path / ".config" / "matplotlib")
            self.kernel = InProcessKernelManager()
            self.kernel.start_kernel()
            shell = getattr(getattr(self.kernel, "kernel", None), "shell", None)
            history_manager = getattr(shell, "history_manager", None)
            if history_manager is not None:
                with contextlib.suppress(Exception):
                    history_manager.enabled = False
                    history_manager.hist_file = ":memory:"
                    history_manager.end_session = lambda *args, **kwargs: None
            if shell is not None:
                with contextlib.suppress(Exception):
                    shell.atexit_operations = lambda: None
            self.client = self.kernel.client()
            self.client.start_channels()
            await self._execute_inprocess(self.bootstrap_code, self.exec_timeout_s)
        except Exception:
            self._restore_previous_shell_instance()
            raise
        finally:
            if original_home is None:
                os.environ.pop("HOME", None)
            else:
                os.environ["HOME"] = original_home
            if original_ipython is None:
                os.environ.pop("IPYTHONDIR", None)
            else:
                os.environ["IPYTHONDIR"] = original_ipython
            if original_mpl is None:
                os.environ.pop("MPLCONFIGDIR", None)
            else:
                os.environ["MPLCONFIGDIR"] = original_mpl

    async def attach(self) -> bool:
        return await self.is_running()

    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("Notebook runtime client is not connected.")
        return await self._execute_inprocess(code, timeout_s)

    async def interrupt(self) -> bool:
        return False

    async def restart(self) -> None:
        await self.stop(remove_workspace=False)
        await self.start()

    async def stop(self, remove_workspace: bool) -> None:
        shell = getattr(getattr(self.kernel, "kernel", None), "shell", None)
        if self.kernel is not None:
            with contextlib.suppress(Exception):
                self.kernel.shutdown_kernel()
        if self.client is not None:
            with contextlib.suppress(Exception):
                self.client.stop_channels()
        if shell is not None:
            self._clear_shell_singletons(type(shell))
        self._restore_previous_shell_instance()
        self.kernel = None
        self.client = None
        if remove_workspace:
            shutil.rmtree(self.workspace_path, ignore_errors=True)

    async def is_running(self) -> bool:
        return self.kernel is not None and self.client is not None

    @staticmethod
    def _clear_shell_singletons(shell_type: type[Any]) -> None:
        for cls in shell_type.mro():
            if hasattr(cls, "_instance"):
                setattr(cls, "_instance", None)

    def _restore_previous_shell_instance(self) -> None:
        if self.previous_shell_instance is None:
            return
        for cls in type(self.previous_shell_instance).mro():
            if hasattr(cls, "_instance"):
                setattr(cls, "_instance", self.previous_shell_instance)
        self.previous_shell_instance = None

    async def _execute_inprocess(self, code: str, timeout_s: float) -> dict[str, Any]:
        started_at = time.perf_counter()
        stdout = ""
        stderr = ""
        mime_data: dict[str, Any] = {}
        error_name: str | None = None
        error_value: str | None = None
        stdout_buffer = io.StringIO()
        stderr_buffer = io.StringIO()
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            msg_id = self.client.execute(code, stop_on_error=True)
            idle = False
            deadline = time.monotonic() + timeout_s
            while not idle:
                if time.monotonic() > deadline:
                    raise TimeoutError(f"In-process notebook execution timed out after {timeout_s:.1f}s.")
                msg = self.client.get_iopub_msg(timeout=timeout_s)
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
                                mime_data[mime] = _truncate_text(f"{mime_data.get(mime, '')}{value}", limit=MAX_MIME_TEXT_LENGTH)
                            else:
                                mime_data[mime] = _truncate_mime_value(value)
                    continue
                if msg_type == "error":
                    error_name = str(content.get("ename") or "Error")
                    error_value = str(content.get("evalue") or "")
            shell_reply = self.client.get_shell_msg(timeout=timeout_s)
        if shell_reply.get("parent_header", {}).get("msg_id") != msg_id:
            raise RuntimeError("Kernel shell reply did not match the execution request.")
        return {
            "status": "error" if error_name else "ok",
            "stdout": _truncate_text(f"{stdout}{stdout_buffer.getvalue()}"),
            "stderr": _truncate_text(f"{stderr}{stderr_buffer.getvalue()}"),
            "mimeData": mime_data,
            "errorName": error_name,
            "errorValue": error_value,
            "durationMs": int((time.perf_counter() - started_at) * 1000),
        }
