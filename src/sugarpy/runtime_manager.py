from __future__ import annotations

import asyncio
import calendar
import contextlib
import json
import os
import shutil
import io
import socket
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol

from IPython.core.interactiveshell import InteractiveShell
from jupyter_client.asynchronous.client import AsyncKernelClient
from ipykernel.inprocess.ipkernel import InProcessInteractiveShell
from ipykernel.inprocess.manager import InProcessKernelManager


DEFAULT_RUNTIME_IMAGE = "sugarpy-runtime:latest"
DEFAULT_RUNTIME_BACKEND = "docker"
DEFAULT_IDLE_TIMEOUT_S = 1800.0
DEFAULT_RUNTIME_START_TIMEOUT_S = 20.0
DEFAULT_EXEC_TIMEOUT_S = 5.0
CONTAINER_WORKDIR = "/runtime/workspace"
RUNTIME_CONTAINER_PREFIX = "sugarpy-rt"

KernelExecutor = Callable[[Any, str, float], Awaitable[dict[str, Any]]]


class RuntimeSession(Protocol):
    record: RuntimeRecord

    async def start(self) -> None: ...
    async def attach(self) -> bool: ...
    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]: ...
    async def restart(self) -> None: ...
    async def stop(self, remove_workspace: bool) -> None: ...
    async def is_running(self) -> bool: ...


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


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


def _safe_identifier(value: str, fallback: str) -> str:
    normalized = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in (value or "").strip())
    normalized = normalized.strip("-.")
    return normalized or fallback


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


async def _run_command(args: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = await process.communicate()
    return (
        process.returncode,
        stdout_bytes.decode("utf-8", errors="replace").strip(),
        stderr_bytes.decode("utf-8", errors="replace").strip(),
    )


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
        self.connection_file = Path(record.connection_file_path)
        self.workspace_path = Path(record.workspace_path)
        self.client: AsyncKernelClient | None = None
        self.connection_ports: dict[str, int] = {}

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
        await self._connect_client()
        return True

    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("Notebook runtime client is not connected.")
        return await self.executor(self.client, code, timeout_s)

    async def restart(self) -> None:
        await self.stop(remove_workspace=False)
        await self.start()

    async def stop(self, remove_workspace: bool) -> None:
        if self.client is not None:
            try:
                self.client.stop_channels()
            except Exception:
                pass
            self.client = None
        await self._remove_container()
        if remove_workspace:
            shutil.rmtree(self.workspace_path, ignore_errors=True)

    async def is_running(self) -> bool:
        code, stdout, stderr = await _run_command(
            ["docker", "inspect", "-f", "{{.State.Running}}", self.record.container_name]
        )
        if code != 0:
            return False
        if stderr and "No such object" in stderr:
            return False
        return stdout.strip().lower() == "true"

    async def _run_container(self) -> None:
        self.connection_ports = _reserve_kernel_ports()
        args = [
            "docker",
            "run",
            "-d",
            "--rm",
            "--name",
            self.record.container_name,
            "--memory",
            os.environ.get("SUGARPY_RUNTIME_MEMORY", "1g"),
            "--cpus",
            os.environ.get("SUGARPY_RUNTIME_CPUS", "1.0"),
            "--pids-limit",
            os.environ.get("SUGARPY_RUNTIME_PIDS_LIMIT", "128"),
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
        publish_args: list[str] = []
        for port in self.connection_ports.values():
            publish_args.extend(["-p", f"{port}:{port}"])
        args[6:6] = publish_args
        code, stdout, stderr = await _run_command(args)
        if code != 0:
            raise DockerCommandError(stderr or stdout or "docker run failed")

    async def _remove_container(self) -> None:
        await _run_command(["docker", "rm", "-f", self.record.container_name])

    async def _wait_for_connection_file(self) -> None:
        deadline = time.monotonic() + self.start_timeout_s
        while time.monotonic() < deadline:
            if self.connection_file.exists():
                self._rewrite_connection_file_for_host_access()
                return
            await asyncio.sleep(0.2)
        raise RuntimeError(f"Notebook runtime did not create {self.connection_file.name} within {self.start_timeout_s:.0f}s.")

    def _rewrite_connection_file_for_host_access(self) -> None:
        payload = json.loads(self.connection_file.read_text(encoding="utf-8"))
        payload["ip"] = "127.0.0.1"
        for key, value in self.connection_ports.items():
            payload[key] = value
        self.connection_file.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")

    async def _connect_client(self) -> None:
        if self.client is not None:
            try:
                self.client.stop_channels()
            except Exception:
                pass
        client = AsyncKernelClient()
        client.load_connection_file(str(self.connection_file))
        client.start_channels()
        try:
            await client.wait_for_ready(timeout=self.start_timeout_s)
        except Exception:
            try:
                client.stop_channels()
            except Exception:
                pass
            raise
        self.client = client


class InProcessKernelRuntime:
    def __init__(
        self,
        record: RuntimeRecord,
        *,
        bootstrap_code: str,
        executor: KernelExecutor,
        start_timeout_s: float,
        exec_timeout_s: float,
    ) -> None:
        self.record = record
        self.bootstrap_code = bootstrap_code
        self.executor = executor
        self.start_timeout_s = start_timeout_s
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
                try:
                    history_manager.enabled = False
                    history_manager.hist_file = ":memory:"
                    history_manager.end_session = lambda *args, **kwargs: None
                except Exception:
                    pass
            if shell is not None:
                try:
                    shell.atexit_operations = lambda: None
                except Exception:
                    pass
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

    async def attach(self) -> bool:
        return await self.is_running()

    async def execute(self, code: str, timeout_s: float) -> dict[str, Any]:
        if self.client is None:
            raise RuntimeError("Notebook runtime client is not connected.")
        return await self._execute_inprocess(code, timeout_s)

    async def restart(self) -> None:
        await self.stop(remove_workspace=False)
        await self.start()

    async def stop(self, remove_workspace: bool) -> None:
        shell = getattr(getattr(self.kernel, "kernel", None), "shell", None)
        if self.kernel is not None:
            try:
                self.kernel.shutdown_kernel()
            except Exception:
                pass
        if self.client is not None:
            try:
                self.client.stop_channels()
            except Exception:
                pass
        if shell is not None:
            self._clear_shell_singletons(type(shell))
        self._restore_previous_shell_instance()
        self.kernel = None
        self.client = None
        if remove_workspace:
            shutil.rmtree(self.workspace_path, ignore_errors=True)

    async def is_running(self) -> bool:
        return self.kernel is not None and self.client is not None

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
                        stderr += text
                    else:
                        stdout += text
                    continue
                if msg_type in {"execute_result", "display_data"}:
                    data = content.get("data") or {}
                    if isinstance(data, dict):
                        for mime, value in data.items():
                            if mime == "text/plain":
                                mime_data[mime] = f"{mime_data.get(mime, '')}{value}"
                            else:
                                mime_data[mime] = value
                    continue
                if msg_type == "error":
                    error_name = str(content.get("ename") or "Error")
                    error_value = str(content.get("evalue") or "")

            shell_reply = self.client.get_shell_msg(timeout=timeout_s)
        if shell_reply.get("parent_header", {}).get("msg_id") != msg_id:
            raise RuntimeError("Kernel shell reply did not match the execution request.")
        stdout = f"{stdout}{stdout_buffer.getvalue()}"
        stderr = f"{stderr}{stderr_buffer.getvalue()}"

        return {
            "status": "error" if error_name else "ok",
            "stdout": stdout,
            "stderr": stderr,
            "mimeData": mime_data,
            "errorName": error_name,
            "errorValue": error_value,
            "durationMs": int((time.perf_counter() - started_at) * 1000),
        }


class RuntimeManager:
    def __init__(
        self,
        *,
        storage_root: Path,
        project_root: Path,
        bootstrap_code: str,
        executor: KernelExecutor,
    ) -> None:
        self.storage_root = storage_root
        self.project_root = project_root
        self.bootstrap_code = bootstrap_code
        self.executor = executor
        requested_backend = os.environ.get("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", DEFAULT_RUNTIME_BACKEND).strip() or DEFAULT_RUNTIME_BACKEND
        self.backend = self._resolve_backend(requested_backend)
        self.image = os.environ.get("SUGARPY_NOTEBOOK_RUNTIME_IMAGE", DEFAULT_RUNTIME_IMAGE).strip() or DEFAULT_RUNTIME_IMAGE
        self.start_timeout_s = float(os.environ.get("SUGARPY_RUNTIME_START_TIMEOUT_S", DEFAULT_RUNTIME_START_TIMEOUT_S))
        self.exec_timeout_s = float(os.environ.get("SUGARPY_RUNTIME_EXEC_TIMEOUT_S", DEFAULT_EXEC_TIMEOUT_S))
        self.idle_timeout_s = float(os.environ.get("SUGARPY_RUNTIME_IDLE_TIMEOUT_S", DEFAULT_IDLE_TIMEOUT_S))
        self.workspace_root = self.storage_root / "live-runtimes" / "workspaces"
        self.metadata_root = self.storage_root / "live-runtimes" / "metadata"
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.metadata_root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, RuntimeSession] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def ensure_runtime(self, notebook_id: str) -> dict[str, Any]:
        await self._cleanup_idle_runtimes()
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                runtime = self._create_runtime(notebook_id)
                runtime.record.status = "starting"
                runtime.record.error = None
                self._persist_record(runtime.record)
                try:
                    await runtime.start()
                except Exception as exc:
                    runtime.record.status = "error"
                    runtime.record.error = str(exc)
                    self._persist_record(runtime.record)
                    raise
                runtime.record.status = "connected"
                runtime.record.last_activity_at = _utc_now()
                self._sessions[notebook_id] = runtime
                self._persist_record(runtime.record)
            else:
                runtime.record.status = "connected"
                runtime.record.error = None
                runtime.record.last_activity_at = _utc_now()
                self._sessions[notebook_id] = runtime
                self._persist_record(runtime.record)
            return runtime.record.to_dict()

    async def execute_in_runtime(self, notebook_id: str, code: str, timeout_s: float) -> tuple[dict[str, Any], dict[str, Any]]:
        await self.ensure_runtime(notebook_id)
        async with self._lock_for(notebook_id):
            runtime = self._sessions[notebook_id]
            try:
                result = await runtime.execute(code, timeout_s)
            except Exception as exc:
                runtime.record.status = "error"
                runtime.record.error = str(exc)
                runtime.record.last_activity_at = _utc_now()
                self._persist_record(runtime.record)
                raise
            runtime.record.status = "connected"
            runtime.record.error = None
            runtime.record.last_activity_at = _utc_now()
            self._persist_record(runtime.record)
            return result, runtime.record.to_dict()

    async def get_runtime_status(self, notebook_id: str) -> dict[str, Any]:
        await self._cleanup_idle_runtimes()
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                return self._disconnected_payload(notebook_id)
            if await runtime.is_running():
                runtime.record.status = "connected"
                runtime.record.error = None
                self._sessions[notebook_id] = runtime
                self._persist_record(runtime.record)
                return runtime.record.to_dict()
            runtime.record.status = "disconnected"
            runtime.record.error = "Notebook runtime container is not running."
            self._persist_record(runtime.record)
            self._sessions.pop(notebook_id, None)
            return runtime.record.to_dict()

    async def restart_runtime(self, notebook_id: str) -> dict[str, Any]:
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                runtime = self._create_runtime(notebook_id)
            runtime.record.status = "restarting"
            runtime.record.error = None
            self._persist_record(runtime.record)
            try:
                await runtime.restart()
            except Exception as exc:
                runtime.record.status = "error"
                runtime.record.error = str(exc)
                self._persist_record(runtime.record)
                raise
            runtime.record.status = "connected"
            runtime.record.last_activity_at = _utc_now()
            self._sessions[notebook_id] = runtime
            self._persist_record(runtime.record)
            return runtime.record.to_dict()

    async def delete_runtime(self, notebook_id: str) -> dict[str, Any]:
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is not None:
                runtime.record.status = "deleting"
                self._persist_record(runtime.record)
                try:
                    await runtime.stop(remove_workspace=True)
                finally:
                    self._sessions.pop(notebook_id, None)
            self._delete_record(notebook_id)
            return self._disconnected_payload(notebook_id)

    async def cleanup_orphans(self) -> dict[str, Any]:
        removed_notebooks: list[str] = []
        for metadata_path in self.metadata_root.glob("*.json"):
            payload = self._load_record_file(metadata_path)
            if not payload:
                continue
            record = RuntimeRecord.from_dict(payload)
            runtime = self._create_runtime(record.notebook_id, existing_record=record)
            if await runtime.is_running():
                continue
            await runtime.stop(remove_workspace=True)
            self._delete_record(record.notebook_id)
            removed_notebooks.append(record.notebook_id)
        return {"removedNotebookIds": removed_notebooks}

    def _create_runtime(self, notebook_id: str, existing_record: RuntimeRecord | None = None) -> RuntimeSession:
        record = existing_record or RuntimeRecord(
            notebook_id=notebook_id,
            status="disconnected",
            backend=self.backend,
            container_name=f"{RUNTIME_CONTAINER_PREFIX}-{_safe_identifier(notebook_id, 'notebook')}",
            workspace_path=str((self.workspace_root / _safe_identifier(notebook_id, "notebook")).resolve()),
            connection_file_path=str((self.workspace_root / _safe_identifier(notebook_id, "notebook") / "kernel-connection.json").resolve()),
            created_at=_utc_now(),
            last_activity_at=_utc_now(),
            image=self.image,
            error=None,
        )
        if record.backend == "inprocess":
            return InProcessKernelRuntime(
                record,
                bootstrap_code=self.bootstrap_code,
                executor=self.executor,
                start_timeout_s=self.start_timeout_s,
                exec_timeout_s=self.exec_timeout_s,
            )
        return DockerKernelRuntime(
            record,
            project_root=self.project_root,
            bootstrap_code=self.bootstrap_code,
            executor=self.executor,
            start_timeout_s=self.start_timeout_s,
            exec_timeout_s=self.exec_timeout_s,
        )

    async def _load_or_recover_runtime(self, notebook_id: str) -> DockerKernelRuntime | None:
        existing = self._sessions.get(notebook_id)
        if existing and await existing.is_running():
            return existing
        payload = self._load_record(notebook_id)
        if not payload:
            self._sessions.pop(notebook_id, None)
            return None
        record = RuntimeRecord.from_dict(payload)
        runtime = self._create_runtime(notebook_id, existing_record=record)
        if await runtime.attach():
            self._sessions[notebook_id] = runtime
            return runtime
        self._sessions.pop(notebook_id, None)
        return None

    async def _cleanup_idle_runtimes(self) -> None:
        if self.idle_timeout_s <= 0:
            return
        now = time.time()
        for notebook_id, runtime in list(self._sessions.items()):
            last_seen = self._parse_timestamp(runtime.record.last_activity_at)
            if last_seen <= 0 or now - last_seen < self.idle_timeout_s:
                continue
            try:
                await runtime.stop(remove_workspace=True)
            finally:
                self._sessions.pop(notebook_id, None)
                self._delete_record(notebook_id)

    def _lock_for(self, notebook_id: str) -> asyncio.Lock:
        lock = self._locks.get(notebook_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[notebook_id] = lock
        return lock

    def _metadata_path(self, notebook_id: str) -> Path:
        return self.metadata_root / f"{_safe_identifier(notebook_id, 'notebook')}.json"

    def _persist_record(self, record: RuntimeRecord) -> None:
        path = self._metadata_path(record.notebook_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(record.to_dict(), ensure_ascii=True, indent=2), encoding="utf-8")

    def _load_record(self, notebook_id: str) -> dict[str, Any] | None:
        return self._load_record_file(self._metadata_path(notebook_id))

    def _load_record_file(self, path: Path) -> dict[str, Any] | None:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return None
        except (OSError, json.JSONDecodeError):
            return None

    def _delete_record(self, notebook_id: str) -> None:
        self._metadata_path(notebook_id).unlink(missing_ok=True)

    def _disconnected_payload(self, notebook_id: str) -> dict[str, Any]:
        return {
            "notebookId": notebook_id,
            "status": "disconnected",
            "backend": self.backend,
            "containerName": f"{RUNTIME_CONTAINER_PREFIX}-{_safe_identifier(notebook_id, 'notebook')}",
            "workspacePath": str((self.workspace_root / _safe_identifier(notebook_id, "notebook")).resolve()),
            "connectionFilePath": str((self.workspace_root / _safe_identifier(notebook_id, "notebook") / "kernel-connection.json").resolve()),
            "createdAt": None,
            "lastActivityAt": None,
            "image": self.image,
            "error": None,
        }

    @staticmethod
    def _parse_timestamp(value: str | None) -> float:
        if not value:
            return 0.0
        try:
            parsed = time.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
        except ValueError:
            return 0.0
        return float(calendar.timegm(parsed))

    @staticmethod
    def _resolve_backend(requested_backend: str) -> str:
        if requested_backend != "docker":
            return requested_backend
        try:
            result = subprocess.run(
                ["docker", "info"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            return "inprocess"
        return "docker" if result.returncode == 0 else "inprocess"
