import asyncio
import contextlib
import os
from pathlib import Path

from sugarpy.runtime_manager import RuntimeManager, RuntimeRecord
from sugarpy.server_extension import execute_notebook_request


class ControllableRuntime:
    def __init__(self, record: RuntimeRecord):
        self.record = record
        self.running = False
        self.started = 0
        self.restarted = 0
        self.interrupted = 0
        self.stopped: list[bool] = []
        self.execute_calls: list[str] = []
        self.attachable = True
        self.last_interrupt_recovered = True
        self.interrupt_event = asyncio.Event()
        self.execution_started = asyncio.Event()
        self.hold_execution = False

    async def start(self):
        self.started += 1
        self.running = True

    async def attach(self):
        return self.running and self.attachable

    async def execute(self, code: str, timeout_s: float):
        self.execute_calls.append(code)
        if "print_big_stdout()" in code:
            return {
                "status": "ok",
                "stdout": "x" * 6000,
                "stderr": "",
                "mimeData": {"text/plain": "ok"},
                "errorName": None,
                "errorValue": None,
            }
        if "TIMEOUT_ME()" in code:
            raise TimeoutError(f"Notebook execution timed out after {timeout_s:.1f}s.")
        if self.hold_execution:
            self.execution_started.set()
            await self.interrupt_event.wait()
            raise RuntimeError("Execution interrupted by runtime control.")
        return {
            "status": "ok",
            "stdout": "",
            "stderr": "",
            "mimeData": {"text/plain": "ok"},
            "errorName": None,
            "errorValue": None,
        }

    async def interrupt(self):
        self.interrupted += 1
        self.interrupt_event.set()
        return True

    async def restart(self):
        self.restarted += 1
        self.running = True
        self.interrupt_event.set()

    async def stop(self, remove_workspace: bool):
        self.stopped.append(remove_workspace)
        self.running = False
        self.interrupt_event.set()

    async def is_running(self):
        return self.running


class ControllableRuntimeManager(RuntimeManager):
    def __init__(self, storage_root: Path):
        super().__init__(
            storage_root=storage_root,
            project_root=storage_root,
            bootstrap_code="",
            executor=lambda *_args, **_kwargs: None,
        )
        self.backend = "docker"
        self.unavailable_reason = None
        self.created: dict[str, ControllableRuntime] = {}

    def _create_runtime(self, notebook_id: str, existing_record: RuntimeRecord | None = None):
        record = existing_record or RuntimeRecord(
            notebook_id=notebook_id,
            status="disconnected",
            backend="docker",
            container_name=f"fake-{notebook_id}",
            workspace_path=str((self.workspace_root / notebook_id).resolve()),
            connection_file_path=str((self.workspace_root / notebook_id / "kernel.json").resolve()),
            created_at="2026-03-16T00:00:00Z",
            last_activity_at="2026-03-16T00:00:00Z",
            image="fake-image",
        )
        runtime = self.created.get(notebook_id)
        if runtime is None:
            runtime = ControllableRuntime(record)
            self.created[notebook_id] = runtime
        runtime.record = record
        return runtime


@contextlib.contextmanager
def patched_runtime_manager(fake_manager: ControllableRuntimeManager):
    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        yield
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory


def test_runtime_reliability_fresh_runtime_executes_only_target_cell(tmp_path: Path):
    manager = ControllableRuntimeManager(tmp_path)
    payload = {
        "notebookId": "nb-replay",
        "cells": [
            {"id": "cell-1", "type": "code", "source": "value = 41"},
            {"id": "cell-2", "type": "code", "source": "value + 1"},
        ],
        "targetCellId": "cell-2",
        "trigMode": "deg",
        "defaultMathRenderMode": "exact",
        "timeoutMs": 4000,
    }

    with patched_runtime_manager(manager):
        first = asyncio.run(execute_notebook_request(payload))
        second = asyncio.run(execute_notebook_request(payload))

    runtime = manager.created["nb-replay"]
    assert first["freshRuntime"] is True
    assert first["replayedCellIds"] == []
    assert second["replayedCellIds"] == []
    assert runtime.execute_calls[0].count("value = 41") == 0
    assert runtime.execute_calls[1].count("value = 41") == 0


def test_runtime_reliability_timeout_recovers_and_next_execution_reuses_clean_runtime(tmp_path: Path):
    manager = ControllableRuntimeManager(tmp_path)
    timeout_payload = {
        "notebookId": "nb-timeout",
        "cells": [{"id": "cell-1", "type": "code", "source": "TIMEOUT_ME()"}],
        "targetCellId": "cell-1",
        "trigMode": "deg",
        "defaultMathRenderMode": "exact",
        "timeoutMs": 4000,
    }
    ok_payload = {
        **timeout_payload,
        "cells": [{"id": "cell-1", "type": "code", "source": "2 + 2"}],
    }

    with patched_runtime_manager(manager):
        timed_out = asyncio.run(execute_notebook_request(timeout_payload))
        recovered = asyncio.run(execute_notebook_request(ok_payload))

    runtime = manager.created["nb-timeout"]
    assert timed_out["runtime"]["sessionState"] == "recreated-after-timeout"
    assert runtime.restarted == 1
    assert recovered["status"] == "ok"
    assert recovered["replayedCellIds"] == []


def test_runtime_reliability_interrupt_restart_and_delete_can_preempt_active_execution(tmp_path: Path):
    manager = ControllableRuntimeManager(tmp_path)
    runtime = manager._create_runtime("nb-control")
    runtime.hold_execution = True
    runtime.running = True
    manager._sessions["nb-control"] = runtime
    manager._persist_record(runtime.record)

    async def exercise_controls():
        execute_task = asyncio.create_task(manager.execute_code("nb-control", "block_forever()", 20.0))
        await runtime.execution_started.wait()
        interrupted = await manager.interrupt_runtime("nb-control")
        restarted = await manager.restart_runtime("nb-control")
        deleted = await manager.delete_runtime("nb-control")
        with contextlib.suppress(Exception):
            await execute_task
        return interrupted, restarted, deleted

    interrupted, restarted, deleted = asyncio.run(exercise_controls())

    assert interrupted["interrupted"] is True
    assert interrupted["sessionState"] == "existing"
    assert runtime.interrupted == 1
    assert runtime.restarted == 1
    assert restarted["status"] == "connected"
    assert deleted["status"] == "disconnected"
    assert runtime.stopped[-1] is True


def test_runtime_reliability_interrupt_restarts_busy_runtime_when_kernel_does_not_recover(tmp_path: Path):
    manager = ControllableRuntimeManager(tmp_path)
    runtime = manager._create_runtime("nb-control-restart")
    runtime.hold_execution = True
    runtime.running = True
    runtime.last_interrupt_recovered = False
    manager._sessions["nb-control-restart"] = runtime
    manager._persist_record(runtime.record)

    async def exercise_interrupt():
        execute_task = asyncio.create_task(manager.execute_code("nb-control-restart", "block_forever()", 20.0))
        await runtime.execution_started.wait()
        interrupted = await manager.interrupt_runtime("nb-control-restart")
        with contextlib.suppress(Exception):
            await execute_task
        return interrupted

    interrupted = asyncio.run(exercise_interrupt())

    assert interrupted["interrupted"] is True
    assert interrupted["sessionState"] == "restarted-after-interrupt"
    assert runtime.interrupted == 1
    assert runtime.restarted == 1


def test_runtime_reliability_large_stdout_is_bounded(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "inprocess")
    manager = RuntimeManager(
        storage_root=tmp_path,
        project_root=tmp_path,
        bootstrap_code="",
        executor=lambda *_args, **_kwargs: None,
    )

    try:
        result, runtime = asyncio.run(manager.execute_in_runtime("nb-output", "'x' * 6000", 5.0))
        assert result["status"] == "ok"
        assert len(result["mimeData"]["text/plain"]) == 4000
        assert runtime["status"] == "connected"
    finally:
        asyncio.run(manager.delete_runtime("nb-output"))
        os.environ.pop("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", None)


def test_runtime_reliability_metadata_recovers_after_manager_restart(tmp_path: Path):
    first_manager = ControllableRuntimeManager(tmp_path)
    asyncio.run(first_manager.ensure_runtime("nb-metadata"))
    first_runtime = first_manager.created["nb-metadata"]
    first_runtime.running = True

    second_manager = ControllableRuntimeManager(tmp_path)
    second_manager.created["nb-metadata"] = first_runtime
    recovered = asyncio.run(second_manager.get_runtime_status("nb-metadata"))

    assert recovered["status"] == "connected"
    assert recovered["notebookId"] == "nb-metadata"
