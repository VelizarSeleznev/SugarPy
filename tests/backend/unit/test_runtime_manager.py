import asyncio
import json
import os
from pathlib import Path

import pytest
from IPython.core.interactiveshell import InteractiveShell
from IPython.terminal.interactiveshell import TerminalInteractiveShell

from sugarpy.runtime_manager import DockerKernelRuntime, RuntimeManager, RuntimeRecord


class FakeRuntime:
    def __init__(self, record: RuntimeRecord):
        self.record = record
        self.running = False
        self.start_calls = 0
        self.restart_calls = 0
        self.stop_calls: list[bool] = []
        self.execute_calls: list[tuple[str, float]] = []
        self.interrupt_calls = 0
        self.last_interrupt_recovered = True

    async def start(self):
        self.start_calls += 1
        self.running = True

    async def attach(self):
        return self.running

    async def execute(self, code: str, timeout_s: float):
        self.execute_calls.append((code, timeout_s))
        return {
            "status": "ok",
            "stdout": "",
            "stderr": "",
            "mimeData": {"text/plain": "4"},
            "errorName": None,
            "errorValue": None,
        }

    async def restart(self):
        self.restart_calls += 1
        self.running = True

    async def interrupt(self):
        self.interrupt_calls += 1
        return True

    async def stop(self, remove_workspace: bool):
        self.stop_calls.append(remove_workspace)
        self.running = False

    async def is_running(self):
        return self.running


class FakeRuntimeManager(RuntimeManager):
    def __init__(self, storage_root: Path):
        super().__init__(
            storage_root=storage_root,
            project_root=storage_root,
            bootstrap_code="print('bootstrap')",
            executor=lambda *_args, **_kwargs: None,
        )
        self.backend = "docker"
        self.unavailable_reason = None
        self.created: list[FakeRuntime] = []

    def _create_runtime(self, notebook_id: str, existing_record: RuntimeRecord | None = None):
        runtime = FakeRuntime(
            existing_record
            or RuntimeRecord(
                notebook_id=notebook_id,
                status="disconnected",
                backend="docker",
                container_name=f"fake-{notebook_id}",
                workspace_path=str((self.workspace_root / notebook_id).resolve()),
                connection_file_path=str((self.workspace_root / notebook_id / "kernel.json").resolve()),
                created_at="2026-03-13T00:00:00Z",
                last_activity_at="2026-03-13T00:00:00Z",
                image="fake-image",
            )
        )
        self.created.append(runtime)
        return runtime


def test_runtime_manager_marks_new_runtime_as_created(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    first = asyncio.run(manager.ensure_runtime("nb-1"))
    second = asyncio.run(manager.ensure_runtime("nb-1"))

    assert first["status"] == "connected"
    assert first["sessionState"] == "created"
    assert second["sessionState"] == "existing"
    assert len(manager.created) == 1
    assert manager.created[0].start_calls == 1


def test_runtime_manager_restart_and_delete(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    asyncio.run(manager.ensure_runtime("nb-2"))
    restarted = asyncio.run(manager.restart_runtime("nb-2"))
    deleted = asyncio.run(manager.delete_runtime("nb-2"))

    assert restarted["status"] == "connected"
    assert manager.created[0].restart_calls == 1
    assert deleted["status"] == "disconnected"
    assert manager.created[0].stop_calls[-1] is True


def test_runtime_manager_interrupt_marks_runtime_connected(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    asyncio.run(manager.ensure_runtime("nb-int"))
    interrupted = asyncio.run(manager.interrupt_runtime("nb-int"))

    assert interrupted["status"] == "connected"
    assert interrupted["interrupted"] is True
    assert interrupted["sessionState"] == "existing"
    assert manager.created[0].interrupt_calls == 1
    assert manager.created[0].restart_calls == 0


def test_runtime_manager_interrupt_restarts_when_kernel_does_not_recover(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    asyncio.run(manager.ensure_runtime("nb-int-restart"))
    manager.created[0].last_interrupt_recovered = False
    interrupted = asyncio.run(manager.interrupt_runtime("nb-int-restart"))

    assert interrupted["status"] == "connected"
    assert interrupted["interrupted"] is True
    assert interrupted["sessionState"] == "restarted-after-interrupt"
    assert manager.created[0].interrupt_calls == 1
    assert manager.created[0].restart_calls == 1


def test_runtime_manager_interrupt_before_runtime_exists_marks_pending_interrupt(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    interrupted = asyncio.run(manager.interrupt_runtime("nb-pending"))

    assert interrupted["interrupted"] is True
    assert interrupted["status"] == "disconnected"
    assert "nb-pending" in manager._pending_interrupts


def test_runtime_manager_pending_interrupt_blocks_execute_before_code_runs(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    asyncio.run(manager.ensure_runtime("nb-pending-exec"))
    manager._pending_interrupts.add("nb-pending-exec")

    with pytest.raises(RuntimeError, match="Execution interrupted by runtime control."):
        asyncio.run(manager.execute_code("nb-pending-exec", "2 + 2", 5.0))

    assert manager.created[0].execute_calls == []
    assert "nb-pending-exec" not in manager._pending_interrupts


def test_runtime_manager_execute_updates_runtime_status(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    result, runtime = asyncio.run(manager.execute_in_runtime("nb-3", "2 + 2", 5.0))

    assert result["mimeData"]["text/plain"] == "4"
    assert runtime["status"] == "connected"
    assert runtime["sessionState"] == "created"
    assert manager.created[0].execute_calls == [("2 + 2", 5.0)]


def test_runtime_manager_reports_unavailable_backend_in_restricted_profile(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "docker")
    monkeypatch.setenv("SUGARPY_SECURITY_PROFILE", "restricted-demo")
    monkeypatch.setattr(RuntimeManager, "_docker_available", staticmethod(lambda: False))

    manager = RuntimeManager(
        storage_root=tmp_path,
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
    )

    assert manager.backend == "unavailable"
    status = asyncio.run(manager.get_runtime_status("nb-unavailable"))
    assert status["status"] == "disconnected"
    assert "Docker-backed isolation" in (status["error"] or "")


def test_runtime_manager_cleans_up_idle_metadata_backed_runtime(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)
    runtime = manager._create_runtime("nb-stale")
    runtime.running = True
    manager._persist_record(
        RuntimeRecord(
            notebook_id="nb-stale",
            status="connected",
            backend="docker",
            container_name="fake-nb-stale",
            workspace_path=str((manager.workspace_root / "nb-stale").resolve()),
            connection_file_path=str((manager.workspace_root / "nb-stale" / "kernel.json").resolve()),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        )
    )
    manager._sessions["nb-stale"] = runtime
    manager.idle_timeout_s = 1.0

    asyncio.run(manager._cleanup_idle_runtimes())

    assert "nb-stale" not in manager._sessions
    assert manager._load_record("nb-stale") is None
    assert runtime.stop_calls == [True]


def test_runtime_manager_cleanup_idle_runtimes_reports_removed_notebooks(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)
    runtime = manager._create_runtime("nb-stale-report")
    runtime.running = True
    manager._persist_record(
        RuntimeRecord(
            notebook_id="nb-stale-report",
            status="connected",
            backend="docker",
            container_name="fake-nb-stale-report",
            workspace_path=str((manager.workspace_root / "nb-stale-report").resolve()),
            connection_file_path=str((manager.workspace_root / "nb-stale-report" / "kernel.json").resolve()),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        )
    )
    manager._sessions["nb-stale-report"] = runtime
    manager.idle_timeout_s = 1.0

    result = asyncio.run(manager.cleanup_idle_runtimes())

    assert result == {"removedNotebookIds": ["nb-stale-report"]}


def test_runtime_manager_inprocess_backend_persists_namespace_between_executes(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "inprocess")
    manager = RuntimeManager(
        storage_root=tmp_path,
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
    )

    try:
        first, runtime = asyncio.run(manager.execute_in_runtime("nb-live", "value = 41", 5.0))
        second, _ = asyncio.run(manager.execute_in_runtime("nb-live", "value + 1", 5.0))
        deleted = asyncio.run(manager.delete_runtime("nb-live"))
        third, recreated = asyncio.run(manager.execute_in_runtime("nb-live", "'value' in globals()", 5.0))

        assert first["status"] == "ok"
        assert runtime["backend"] == "inprocess"
        assert second["mimeData"]["text/plain"] == "42"
        assert deleted["status"] == "disconnected"
        assert third["mimeData"]["text/plain"] == "False"
        assert recreated["status"] == "connected"
    finally:
        asyncio.run(manager.delete_runtime("nb-live"))
        InteractiveShell.clear_instance()


def test_runtime_manager_inprocess_backend_starts_with_existing_interactive_shell(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "inprocess")
    InteractiveShell.clear_instance()
    original_shell = TerminalInteractiveShell.instance()
    manager = RuntimeManager(
        storage_root=tmp_path,
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
    )

    try:
        result, _ = asyncio.run(manager.execute_in_runtime("nb-existing-shell", "6 * 7", 5.0))
        assert result["mimeData"]["text/plain"] == "42"
        assert InteractiveShell._instance is not None
    finally:
        asyncio.run(manager.delete_runtime("nb-existing-shell"))
        assert InteractiveShell._instance is original_shell
        TerminalInteractiveShell.clear_instance()


class FakeAttachFailureRuntime(FakeRuntime):
    def __init__(self, record: RuntimeRecord):
        super().__init__(record)
        self.attach_calls = 0

    async def attach(self):
        self.attach_calls += 1
        raise PermissionError("kernel-connection.json is not readable")


class FakeAttachFailureManager(RuntimeManager):
    def __init__(self, storage_root: Path):
        super().__init__(
            storage_root=storage_root,
            project_root=storage_root,
            bootstrap_code="print('bootstrap')",
            executor=lambda *_args, **_kwargs: None,
        )
        self.backend = "docker"
        self.unavailable_reason = None
        self.created: list[FakeRuntime] = []

    def _create_runtime(self, notebook_id: str, existing_record: RuntimeRecord | None = None):
        record = existing_record or RuntimeRecord(
            notebook_id=notebook_id,
            status="disconnected",
            backend="docker",
            container_name=f"fake-{notebook_id}",
            workspace_path=str((self.workspace_root / notebook_id).resolve()),
            connection_file_path=str((self.workspace_root / notebook_id / "kernel.json").resolve()),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        )
        if existing_record is not None:
            return FakeAttachFailureRuntime(record)
        runtime = FakeRuntime(record)
        self.created.append(runtime)
        return runtime


def test_runtime_manager_recovers_when_attaching_to_unreadable_connection_file_fails(tmp_path: Path):
    manager = FakeAttachFailureManager(tmp_path)
    manager._persist_record(
        RuntimeRecord(
            notebook_id="nb-perms",
            status="connected",
            backend="docker",
            container_name="fake-nb-perms",
            workspace_path=str((manager.workspace_root / "nb-perms").resolve()),
            connection_file_path=str((manager.workspace_root / "nb-perms" / "kernel.json").resolve()),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        )
    )

    runtime = asyncio.run(manager.ensure_runtime("nb-perms"))

    assert runtime["status"] == "connected"
    assert runtime["sessionState"] == "created"
    assert len(manager.created) == 1
    assert manager.created[0].start_calls == 1


def test_docker_runtime_attach_returns_false_on_connection_file_permission_error(tmp_path: Path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    connection_file = workspace / "kernel-connection.json"
    connection_file.write_text(json.dumps({"shell_port": 1}), encoding="utf-8")
    runtime = DockerKernelRuntime(
        RuntimeRecord(
            notebook_id="nb-attach",
            status="connected",
            backend="docker",
            container_name="fake-container",
            workspace_path=str(workspace),
            connection_file_path=str(connection_file),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        ),
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
        start_timeout_s=1.0,
        exec_timeout_s=1.0,
    )

    async def fake_is_running():
        return True

    async def fake_connect():
        raise PermissionError("kernel-connection.json is not readable")

    monkeypatch.setattr(runtime, "is_running", fake_is_running)
    monkeypatch.setattr(runtime, "_connect_client", fake_connect)

    assert asyncio.run(runtime.attach()) is False


def test_docker_runtime_uses_host_uid_gid_for_container_user(tmp_path: Path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    runtime = DockerKernelRuntime(
        RuntimeRecord(
            notebook_id="nb-user",
            status="connected",
            backend="docker",
            container_name="fake-container",
            workspace_path=str(workspace),
            connection_file_path=str(workspace / "kernel-connection.json"),
            created_at="2026-03-13T00:00:00Z",
            last_activity_at="2026-03-13T00:00:00Z",
            image="fake-image",
        ),
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
        start_timeout_s=1.0,
        exec_timeout_s=1.0,
    )

    monkeypatch.setattr("sugarpy.runtime_manager._reserve_kernel_ports", lambda: {
        "shell_port": 10001,
        "iopub_port": 10002,
        "stdin_port": 10003,
        "control_port": 10004,
        "hb_port": 10005,
    })
    monkeypatch.setattr(os, "getuid", lambda: 1234)
    monkeypatch.setattr(os, "getgid", lambda: 4321)

    captured: list[str] = []

    async def fake_run_command(args: list[str]):
        captured[:] = args
        return 0, "container-id", ""

    monkeypatch.setattr("sugarpy.runtime_manager._run_command", fake_run_command)

    asyncio.run(runtime._run_container())

    assert "--user" in captured
    assert "1234:4321" in captured
