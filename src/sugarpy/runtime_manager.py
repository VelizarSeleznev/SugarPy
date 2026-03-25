from __future__ import annotations

import asyncio
import calendar
import contextlib
import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .runtime_manager_backends import (
    CONTAINER_WORKDIR,
    DEFAULT_EXEC_TIMEOUT_S,
    DEFAULT_IDLE_TIMEOUT_S,
    DEFAULT_RUNTIME_BACKEND,
    DEFAULT_RUNTIME_IMAGE,
    DEFAULT_RUNTIME_START_TIMEOUT_S,
    MAX_MIME_OBJECT_ENTRIES,
    MAX_MIME_TEXT_LENGTH,
    MAX_STREAM_TEXT_LENGTH,
    RESTRICTED_DOCKER_ONLY_PROFILES,
    RUNTIME_CONTAINER_PREFIX,
    DockerCommandError,
    DockerKernelRuntime,
    InProcessKernelRuntime,
    KernelExecutor,
    RuntimeRecord,
    RuntimeSession,
    _container_user_flag,
    _reserve_kernel_ports,
    _run_command,
    _safe_identifier,
    _truncate_mime_value,
    _truncate_text,
    _utc_now,
)


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
        self.security_profile = os.environ.get("SUGARPY_SECURITY_PROFILE", "").strip()
        self.backend, self.unavailable_reason = self._resolve_backend(
            os.environ.get("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", DEFAULT_RUNTIME_BACKEND).strip(),
            self.security_profile,
        )
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
        self._execution_locks: dict[str, asyncio.Lock] = {}
        self._execution_tasks: dict[str, asyncio.Task[dict[str, Any]]] = {}
        self._pending_interrupts: set[str] = set()

    async def ensure_runtime(self, notebook_id: str) -> dict[str, Any]:
        self._require_available_backend()
        await self._cleanup_idle_runtimes()
        async with self._lock_for(notebook_id):
            existing = self._sessions.get(notebook_id)
            runtime = await self._load_or_recover_runtime(notebook_id)
            session_state = "existing"
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
                session_state = "created"
            elif existing is None or existing is not runtime:
                session_state = "attached"
            runtime.record.status = "connected"
            runtime.record.error = None
            runtime.record.last_activity_at = _utc_now()
            self._sessions[notebook_id] = runtime
            self._persist_record(runtime.record)
            return {**runtime.record.to_dict(), "sessionState": session_state}

    async def execute_code(self, notebook_id: str, code: str, timeout_s: float) -> tuple[dict[str, Any], dict[str, Any]]:
        async with self._lock_for(notebook_id):
            runtime = self._sessions.get(notebook_id)
            if runtime is None:
                raise RuntimeError("Notebook runtime is not connected.")
            runtime.record.status = "executing"
            runtime.record.error = None
            runtime.record.last_activity_at = _utc_now()
            self._persist_record(runtime.record)
        async with self._execution_lock_for(notebook_id):
            try:
                if notebook_id in self._pending_interrupts:
                    self._pending_interrupts.discard(notebook_id)
                    raise RuntimeError("Execution interrupted by runtime control.")
                execution_task = asyncio.create_task(runtime.execute(code, timeout_s))
                self._execution_tasks[notebook_id] = execution_task
                result = await execution_task
            except asyncio.CancelledError as exc:
                async with self._lock_for(notebook_id):
                    current_runtime = self._sessions.get(notebook_id)
                    if current_runtime is runtime:
                        runtime.record.status = "connected"
                        runtime.record.error = "Execution interrupted by runtime control."
                        runtime.record.last_activity_at = _utc_now()
                        self._persist_record(runtime.record)
                raise RuntimeError("Execution interrupted by runtime control.") from exc
            except Exception as exc:
                async with self._lock_for(notebook_id):
                    current_runtime = self._sessions.get(notebook_id)
                    if current_runtime is runtime:
                        runtime.record.status = "error"
                        runtime.record.error = str(exc)
                        runtime.record.last_activity_at = _utc_now()
                        self._persist_record(runtime.record)
                raise
            finally:
                self._execution_tasks.pop(notebook_id, None)
        async with self._lock_for(notebook_id):
            current_runtime = self._sessions.get(notebook_id)
            if current_runtime is runtime:
                runtime.record.status = "connected"
                runtime.record.error = None
                runtime.record.last_activity_at = _utc_now()
                self._persist_record(runtime.record)
                return result, runtime.record.to_dict()
            if current_runtime is not None:
                return result, current_runtime.record.to_dict()
            return result, self._disconnected_payload(notebook_id)

    async def execute_in_runtime(self, notebook_id: str, code: str, timeout_s: float) -> tuple[dict[str, Any], dict[str, Any]]:
        runtime = await self.ensure_runtime(notebook_id)
        result, payload = await self.execute_code(notebook_id, code, timeout_s)
        return result, {**payload, "sessionState": runtime.get("sessionState", "existing")}

    async def get_runtime_status(self, notebook_id: str) -> dict[str, Any]:
        if self.backend == "unavailable":
            return self._disconnected_payload(notebook_id)
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
            self._sessions.pop(notebook_id, None)
            self._delete_record(notebook_id)
            return self._disconnected_payload(notebook_id)

    async def restart_runtime(self, notebook_id: str) -> dict[str, Any]:
        self._require_available_backend()
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                runtime = self._create_runtime(notebook_id)
            runtime.record.status = "restarting"
            runtime.record.error = None
            self._persist_record(runtime.record)
            try:
                active_task = self._execution_tasks.get(notebook_id)
                if active_task is not None and not active_task.done():
                    active_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                        await active_task
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

    async def interrupt_runtime(self, notebook_id: str) -> dict[str, Any]:
        if self.backend == "unavailable":
            return {**self._disconnected_payload(notebook_id), "interrupted": False}
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                deadline = time.monotonic() + 1.5
                while runtime is None and time.monotonic() < deadline:
                    await asyncio.sleep(0.1)
                    runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is None:
                self._pending_interrupts.add(notebook_id)
                return {**self._disconnected_payload(notebook_id), "interrupted": True}
            runtime.record.status = "interrupting"
            runtime.record.error = None
            self._persist_record(runtime.record)
            session_state = "existing"
            try:
                active_task = self._execution_tasks.get(notebook_id)
                interrupted = await runtime.interrupt()
                self._pending_interrupts.discard(notebook_id)
                if active_task is not None and not active_task.done():
                    active_task.cancel()
                    with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                        await active_task
                if interrupted and self.backend == "docker" and not getattr(runtime, "last_interrupt_recovered", False):
                    await runtime.restart()
                    session_state = "restarted-after-interrupt"
            except Exception as exc:
                runtime.record.status = "error"
                runtime.record.error = str(exc)
                self._persist_record(runtime.record)
                raise
            is_running = await runtime.is_running()
            runtime.record.status = "connected" if is_running else "disconnected"
            runtime.record.last_activity_at = _utc_now()
            runtime.record.error = None if interrupted else "Runtime interrupt is not supported for this backend."
            if is_running:
                self._sessions[notebook_id] = runtime
                self._persist_record(runtime.record)
                return {**runtime.record.to_dict(), "interrupted": interrupted, "sessionState": session_state}
            self._sessions.pop(notebook_id, None)
            self._delete_record(notebook_id)
            return {**self._disconnected_payload(notebook_id), "interrupted": interrupted, "sessionState": session_state}

    async def delete_runtime(self, notebook_id: str) -> dict[str, Any]:
        if self.backend == "unavailable":
            return self._disconnected_payload(notebook_id)
        async with self._lock_for(notebook_id):
            runtime = await self._load_or_recover_runtime(notebook_id)
            if runtime is not None:
                runtime.record.status = "deleting"
                self._persist_record(runtime.record)
                try:
                    active_task = self._execution_tasks.get(notebook_id)
                    if active_task is not None and not active_task.done():
                        active_task.cancel()
                        with contextlib.suppress(asyncio.CancelledError, RuntimeError):
                            await active_task
                    await runtime.stop(remove_workspace=True)
                finally:
                    self._sessions.pop(notebook_id, None)
            self._delete_record(notebook_id)
            return self._disconnected_payload(notebook_id)

    async def cleanup_orphans(self) -> dict[str, Any]:
        if self.backend == "unavailable":
            return {"removedNotebookIds": []}
        removed_notebooks: list[str] = []
        for metadata_path in self.metadata_root.glob("*.json"):
            payload = self._load_record_file(metadata_path)
            if not payload:
                continue
            record = RuntimeRecord.from_dict(payload)
            runtime = self._sessions.get(record.notebook_id) or self._create_runtime(record.notebook_id, existing_record=record)
            if await runtime.is_running():
                continue
            await runtime.stop(remove_workspace=True)
            self._sessions.pop(record.notebook_id, None)
            self._delete_record(record.notebook_id)
            removed_notebooks.append(record.notebook_id)
        return {"removedNotebookIds": removed_notebooks}

    async def cleanup_idle_runtimes(self) -> dict[str, Any]:
        removed_notebooks: list[str] = []
        if self.backend == "unavailable":
            return {"removedNotebookIds": removed_notebooks}
        if self.idle_timeout_s <= 0:
            return {"removedNotebookIds": removed_notebooks}
        now = time.time()
        for metadata_path in self.metadata_root.glob("*.json"):
            payload = self._load_record_file(metadata_path)
            if not payload:
                continue
            record = RuntimeRecord.from_dict(payload)
            last_seen = self._parse_timestamp(record.last_activity_at)
            runtime = self._sessions.get(record.notebook_id) or self._create_runtime(record.notebook_id, existing_record=record)
            is_running = await runtime.is_running()
            if is_running and last_seen > 0 and now - last_seen < self.idle_timeout_s:
                continue
            await runtime.stop(remove_workspace=True)
            self._sessions.pop(record.notebook_id, None)
            self._delete_record(record.notebook_id)
            removed_notebooks.append(record.notebook_id)
        return {"removedNotebookIds": removed_notebooks}

    async def _cleanup_idle_runtimes(self) -> None:
        await self.cleanup_idle_runtimes()

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
        )
        if record.backend == "inprocess":
            return InProcessKernelRuntime(
                record,
                bootstrap_code=self.bootstrap_code,
                executor=self.executor,
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

    async def _load_or_recover_runtime(self, notebook_id: str) -> RuntimeSession | None:
        existing = self._sessions.get(notebook_id)
        if existing and await existing.is_running():
            return existing
        payload = self._load_record(notebook_id)
        if not payload:
            self._sessions.pop(notebook_id, None)
            return None
        runtime = self._create_runtime(notebook_id, existing_record=RuntimeRecord.from_dict(payload))
        if await runtime.attach():
            self._sessions[notebook_id] = runtime
            return runtime
        self._sessions.pop(notebook_id, None)
        return None

    def _lock_for(self, notebook_id: str) -> asyncio.Lock:
        lock = self._locks.get(notebook_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[notebook_id] = lock
        return lock

    def _execution_lock_for(self, notebook_id: str) -> asyncio.Lock:
        lock = self._execution_locks.get(notebook_id)
        if lock is None:
            lock = asyncio.Lock()
            self._execution_locks[notebook_id] = lock
        return lock

    def _metadata_path(self, notebook_id: str) -> Path:
        return self.metadata_root / f"{_safe_identifier(notebook_id, 'notebook')}.json"

    def _persist_record(self, record: RuntimeRecord) -> None:
        self._metadata_path(record.notebook_id).write_text(
            json.dumps(record.to_dict(), ensure_ascii=True, indent=2),
            encoding="utf-8",
        )

    def _load_record(self, notebook_id: str) -> dict[str, Any] | None:
        return self._load_record_file(self._metadata_path(notebook_id))

    @staticmethod
    def _load_record_file(path: Path) -> dict[str, Any] | None:
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
            "error": self.unavailable_reason if self.backend == "unavailable" else None,
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

    def _require_available_backend(self) -> None:
        if self.backend != "unavailable":
            return
        raise RuntimeError(self.unavailable_reason or "Notebook runtime backend is unavailable.")

    @staticmethod
    def _docker_available() -> bool:
        try:
            result = subprocess.run(
                ["docker", "info"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            return False
        return result.returncode == 0

    @classmethod
    def _resolve_backend(cls, requested_backend: str, security_profile: str) -> tuple[str, str | None]:
        requested = requested_backend or DEFAULT_RUNTIME_BACKEND
        restricted = security_profile in RESTRICTED_DOCKER_ONLY_PROFILES
        docker_available = cls._docker_available()
        unavailable_reason = "Restricted runtime requires Docker-backed isolation, but Docker is unavailable."

        if restricted:
            if requested == "inprocess":
                return "unavailable", "Restricted runtime does not allow the in-process backend."
            if docker_available:
                return "docker", None
            return "unavailable", unavailable_reason

        if requested in {"docker", "inprocess"}:
            if requested == "docker" and not docker_available:
                return "unavailable", "Docker-backed runtime is unavailable because Docker is not accessible."
            return requested, None
        return ("docker", None) if docker_available else ("inprocess", None)
