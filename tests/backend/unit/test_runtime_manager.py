import asyncio
from pathlib import Path

from IPython.core.interactiveshell import InteractiveShell
from IPython.terminal.interactiveshell import TerminalInteractiveShell

from sugarpy.runtime_manager import RuntimeManager, RuntimeRecord


class FakeRuntime:
    def __init__(self, record: RuntimeRecord):
        self.record = record
        self.running = False
        self.start_calls = 0
        self.restart_calls = 0
        self.stop_calls: list[bool] = []
        self.execute_calls: list[tuple[str, float]] = []

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


def test_runtime_manager_reuses_existing_runtime(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    first = asyncio.run(manager.ensure_runtime("nb-1"))
    second = asyncio.run(manager.ensure_runtime("nb-1"))

    assert first["status"] == "connected"
    assert second["status"] == "connected"
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


def test_runtime_manager_execute_updates_runtime_status(tmp_path: Path):
    manager = FakeRuntimeManager(tmp_path)

    result, runtime = asyncio.run(manager.execute_in_runtime("nb-3", "2 + 2", 5.0))

    assert result["mimeData"]["text/plain"] == "4"
    assert runtime["status"] == "connected"
    assert manager.created[0].execute_calls == [("2 + 2", 5.0)]


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
