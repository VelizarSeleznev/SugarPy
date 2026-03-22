import asyncio
import queue
from types import SimpleNamespace

import pytest
from sugarpy import server_extension

from sugarpy.server_extension import (
    _execute_kernel_code,
    _load_assistant_server_config,
    execute_notebook_request,
    execute_sandbox_request,
    validate_restricted_python,
)


def test_restricted_python_blocks_shell_and_file_access():
    errors = validate_restricted_python(
        "\n".join(
            [
                "import os",
                "import subprocess",
                "open('secret.txt')",
                "os.system('ls')",
                "subprocess.run(['whoami'])",
            ]
        )
    )
    joined = " | ".join(errors)
    assert "Import blocked in restricted mode: os" in joined
    assert "Import blocked in restricted mode: subprocess" in joined
    assert "Call blocked in restricted mode: open" in joined
    assert "Call blocked in restricted mode: os.system" in joined
    assert "Call blocked in restricted mode: subprocess.run" in joined


def test_restricted_python_allows_basic_math_workflow():
    errors = validate_restricted_python(
        "\n".join(
            [
                "from sympy import symbols",
                "x = symbols('x')",
                "result = x**2 + 1",
            ]
        )
    )
    assert errors == []


def test_wrap_code_for_notebook_display_leaves_final_print_unchanged():
    wrapped = server_extension._wrap_code_for_notebook_display('print("hello")')

    assert wrapped == 'print("hello")'


def test_wrap_code_for_notebook_display_keeps_rendering_non_print_final_expression():
    wrapped = server_extension._wrap_code_for_notebook_display('value = 41\nvalue + 1')

    assert "__sugarpy_value = value + 1" in wrapped
    assert "__sugarpy_emit_output(__sugarpy_value)" in wrapped


def test_execute_notebook_request_merges_stdout_into_visible_mime_output():
    class FakeRuntimeManager:
        backend = "docker"

        async def ensure_runtime(self, notebook_id):
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "existing"}

        async def execute_code(self, notebook_id, code, timeout_s):
            return (
                {
                    "status": "ok",
                    "stdout": "hello\n",
                    "stderr": "",
                    "mimeData": {},
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

    fake_manager = FakeRuntimeManager()

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-print",
                    "cells": [{"id": "cell-1", "type": "code", "source": 'print("hello")'}],
                    "targetCellId": "cell-1",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["status"] == "ok"
    assert response["output"] == {"type": "mime", "data": {"text/plain": "hello\n"}}


def test_execute_notebook_request_marks_fresh_runtime_without_replay():
    class FakeRuntimeManager:
        def __init__(self):
            self.backend = "docker"
            self.ensure_calls = []
            self.execute_calls = []

        async def ensure_runtime(self, notebook_id):
            self.ensure_calls.append(notebook_id)
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "created"}

        async def execute_code(self, notebook_id, code, timeout_s):
            self.execute_calls.append((notebook_id, code, timeout_s))
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {"text/plain": "42"},
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

    fake_manager = FakeRuntimeManager()

    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-1",
                    "cells": [
                        {"id": "cell-1", "type": "code", "source": "value = 41"},
                        {"id": "cell-2", "type": "code", "source": "value + 1"},
                    ],
                    "targetCellId": "cell-2",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["status"] == "ok"
    assert response["freshRuntime"] is True
    assert response["replayedCellIds"] == []


def test_execute_notebook_request_returns_regression_payload():
    class FakeRuntimeManager:
        backend = "docker"

        async def ensure_runtime(self, notebook_id):
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "existing"}

        async def execute_code(self, notebook_id, code, timeout_s):
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {
                        "application/vnd.sugarpy.regression+json": {
                            "ok": True,
                            "model": "linear",
                            "equation_text": "y = 2x + 0",
                            "r2": 1.0,
                            "points": [{"x": 1, "y": 2}, {"x": 2, "y": 4}],
                            "invalid_rows": [],
                            "plotly_figure": {"data": [], "layout": {}},
                        }
                    },
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

    fake_manager = FakeRuntimeManager()

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-regression",
                    "cells": [
                        {
                            "id": "cell-1",
                            "type": "regression",
                            "source": "",
                            "regressionState": {
                                "model": "linear",
                                "points": [{"x": "1", "y": "2"}, {"x": "2", "y": "4"}],
                            },
                        }
                    ],
                    "targetCellId": "cell-1",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["status"] == "ok"
    assert response["regressionOutput"]["equation_text"] == "y = 2x + 0"
    assert response["output"] == {
        "type": "mime",
        "data": {"application/vnd.plotly.v1+json": {"data": [], "layout": {}}},
    }


def test_load_jupyter_server_extension_starts_background_runtime_cleanup(monkeypatch):
    cleanup_calls: list[str] = []

    class FakeRuntimeManager:
        async def cleanup_orphans(self):
            cleanup_calls.append("orphans")
            return {"removedNotebookIds": []}

        async def cleanup_idle_runtimes(self):
            cleanup_calls.append("idle")
            return {"removedNotebookIds": []}

    class FakeWebApp:
        def __init__(self):
            self.settings = {"base_url": "/"}
            self.handlers = []

        def add_handlers(self, host_pattern, handlers):
            self.handlers.append((host_pattern, handlers))

    class FakeIOLoop:
        def spawn_callback(self, callback, *args, **kwargs):
            asyncio.run(callback(*args, **kwargs))

    callback_holder = {}

    class FakePeriodicCallback:
        def __init__(self, callback, interval):
            callback_holder["callback"] = callback
            callback_holder["interval"] = interval
            callback_holder["started"] = False
            callback_holder["stopped"] = False

        def start(self):
            callback_holder["started"] = True

        def stop(self):
            callback_holder["stopped"] = True

    fake_manager = FakeRuntimeManager()
    monkeypatch.setattr(server_extension, "_RUNTIME_MANAGER", fake_manager)
    monkeypatch.setattr(server_extension, "_runtime_manager", lambda: fake_manager)
    monkeypatch.setattr(server_extension, "_RUNTIME_CLEANUP_CALLBACK", None)
    monkeypatch.setattr(server_extension, "PeriodicCallback", FakePeriodicCallback)
    monkeypatch.setattr(server_extension, "_runtime_cleanup_interval_ms", lambda: 4321)

    fake_web_app = FakeWebApp()
    server_extension._load_jupyter_server_extension(
        SimpleNamespace(
            web_app=fake_web_app,
            io_loop=FakeIOLoop(),
        )
    )

    handler_paths = [route for _host, handlers in fake_web_app.handlers for route, _handler in handlers]

    assert callback_holder["interval"] == 4321
    assert callback_holder["started"] is True
    assert cleanup_calls == ["orphans", "idle"]
    assert "/sugarpy/api/export/maple" in handler_paths

    callback_holder["callback"]()
    assert cleanup_calls == ["orphans", "idle", "orphans", "idle"]


def test_execute_notebook_request_skips_replay_for_existing_runtime():
    class FakeRuntimeManager:
        backend = "docker"

        async def ensure_runtime(self, notebook_id):
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "existing"}

        async def execute_code(self, notebook_id, code, timeout_s):
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {"text/plain": "42"},
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

    fake_manager = FakeRuntimeManager()

    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-1",
                    "cells": [
                        {"id": "cell-1", "type": "code", "source": "value = 41"},
                        {"id": "cell-2", "type": "code", "source": "value + 1"},
                    ],
                    "targetCellId": "cell-2",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["status"] == "ok"
    assert response["replayedCellIds"] == []


def test_runtime_config_keeps_live_docker_execution_unrestricted_but_sandbox_restricted(monkeypatch):
    monkeypatch.setenv("SUGARPY_SECURITY_PROFILE", "restricted-demo")
    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    fake_manager = type("FakeRuntimeManager", (), {"backend": "docker"})()
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        config = _load_assistant_server_config()
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory

    assert config["execution"]["ephemeral"] is False
    assert config["execution"]["networkEnabled"] is True
    assert config["execution"]["runtimeBackend"] == "docker"
    assert config["execution"]["codeCellsRestricted"] is False
    assert config["execution"]["assistantSandboxCodeCellsRestricted"] is True
    assert config["execution"]["assistantSandboxAvailable"] is True
    assert config["execution"]["assistantSandboxDockerOnly"] is True
    assert config["execution"]["coldStartReplay"] is False


def test_execute_notebook_request_converts_timeout_ms_to_seconds():
    class FakeRuntimeManager:
        backend = "docker"

        async def ensure_runtime(self, notebook_id):
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "existing"}

        async def execute_code(self, notebook_id, code, timeout_s):
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {"text/plain": "ok"},
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker", "timeoutUsed": timeout_s},
            )

    fake_manager = FakeRuntimeManager()

    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-timeout",
                    "cells": [{"id": "cell-1", "type": "code", "source": "2 + 2"}],
                    "targetCellId": "cell-1",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 4000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["runtime"]["timeoutUsed"] == 4.0


def test_execute_notebook_request_restarts_runtime_after_timeout():
    class FakeRuntimeManager:
        backend = "docker"

        def __init__(self):
            self.restart_calls = []

        async def ensure_runtime(self, notebook_id):
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker", "sessionState": "existing"}

        async def execute_code(self, notebook_id, code, timeout_s):
            raise TimeoutError("Notebook execution timed out after 5.0s.")

        async def restart_runtime(self, notebook_id):
            self.restart_calls.append(notebook_id)
            return {"notebookId": notebook_id, "status": "connected", "backend": "docker"}

    fake_manager = FakeRuntimeManager()

    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-timeout",
                    "cells": [{"id": "cell-1", "type": "code", "source": "while True: pass"}],
                    "targetCellId": "cell-1",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = None
        server_extension._runtime_manager = original_factory

    assert response["status"] == "error"
    assert response["freshRuntime"] is True
    assert response["runtime"]["sessionState"] == "recreated-after-timeout"
    assert fake_manager.restart_calls == ["nb-timeout"]


def test_execute_kernel_code_converts_queue_empty_to_timeout():
    class FakeClient:
        def execute(self, code, stop_on_error=True):
            return "msg-1"

        async def get_iopub_msg(self, timeout):
            raise queue.Empty()

    with pytest.raises(TimeoutError, match="Notebook execution timed out after 5.0s."):
        asyncio.run(_execute_kernel_code(FakeClient(), "while True: pass", 5.0))


def test_execute_sandbox_request_returns_unavailable_when_docker_is_missing():
    class FakeRuntimeManager:
        backend = "unavailable"

    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    server_extension._RUNTIME_MANAGER = FakeRuntimeManager()
    server_extension._runtime_manager = lambda: server_extension._RUNTIME_MANAGER
    try:
        response = asyncio.run(
            execute_sandbox_request(
                {
                    "request": {
                        "target": "code",
                        "code": "2 + 2",
                        "timeoutMs": 5000,
                    }
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory

    assert response["status"] == "error"
    assert response["errorName"] == "SandboxUnavailable"


def test_execute_sandbox_request_selected_cells_replays_only_requested_cells():
    class FakeRuntimeManager:
        backend = "docker"

        def __init__(self):
            self.calls = []

        async def execute_in_runtime(self, notebook_id, code, timeout_s):
            self.calls.append((notebook_id, code, timeout_s))
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {"text/plain": "42"},
                    "errorName": None,
                    "errorValue": None,
                    "durationMs": 12,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

        async def delete_runtime(self, notebook_id):
            return {"notebookId": notebook_id}

    fake_manager = FakeRuntimeManager()
    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_sandbox_request(
                {
                    "request": {
                        "target": "code",
                        "code": "helper * 2",
                        "contextPreset": "selected-cells",
                        "selectedCellIds": ["cell-helper"],
                        "timeoutMs": 5000,
                    },
                    "notebookCells": [
                        {"id": "cell-helper", "type": "code", "source": "helper = 21", "contextSource": "notebook"},
                        {"id": "cell-other", "type": "code", "source": "other = 5", "contextSource": "notebook"},
                    ],
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory

    executed_code = fake_manager.calls[0][1]
    assert "helper = 21" in executed_code
    assert "other = 5" not in executed_code
    assert "helper * 2" in executed_code
    assert response["contextPresetUsed"] == "selected-cells"
    assert response["selectedCellIds"] == ["cell-helper"]
    assert response["replayedCellIds"] == ["cell-helper"]
    assert response["contextSourcesUsed"] == ["notebook"]


def test_execute_sandbox_request_imports_only_replays_only_import_cells():
    class FakeRuntimeManager:
        backend = "docker"

        def __init__(self):
            self.calls = []

        async def execute_in_runtime(self, notebook_id, code, timeout_s):
            self.calls.append((notebook_id, code, timeout_s))
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {"text/plain": "3"},
                    "errorName": None,
                    "errorValue": None,
                    "durationMs": 12,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

        async def delete_runtime(self, notebook_id):
            return {"notebookId": notebook_id}

    fake_manager = FakeRuntimeManager()
    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_sandbox_request(
                {
                    "request": {
                        "target": "code",
                        "code": "statistics.mean([2, 4])",
                        "contextPreset": "imports-only",
                        "timeoutMs": 5000,
                    },
                    "notebookCells": [
                        {"id": "cell-imports", "type": "code", "source": "import statistics", "contextSource": "notebook"},
                        {"id": "cell-helper", "type": "code", "source": "helper = 21", "contextSource": "notebook"},
                    ],
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory

    executed_code = fake_manager.calls[0][1]
    assert "import statistics" in executed_code
    assert "helper = 21" not in executed_code
    assert response["replayedCellIds"] == ["cell-imports"]
    assert response["contextSourcesUsed"] == ["notebook"]


def test_execute_sandbox_request_full_notebook_replay_includes_prior_math_and_draft_context():
    class FakeRuntimeManager:
        backend = "docker"

        def __init__(self):
            self.calls = []

        async def execute_in_runtime(self, notebook_id, code, timeout_s):
            self.calls.append((notebook_id, code, timeout_s))
            return (
                {
                    "status": "ok",
                    "stdout": "",
                    "stderr": "",
                    "mimeData": {},
                    "errorName": None,
                    "errorValue": None,
                    "durationMs": 12,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

        async def delete_runtime(self, notebook_id):
            return {"notebookId": notebook_id}

    fake_manager = FakeRuntimeManager()
    original_factory = server_extension._runtime_manager
    original_manager = server_extension._RUNTIME_MANAGER
    server_extension._RUNTIME_MANAGER = fake_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_sandbox_request(
                {
                    "request": {
                        "target": "math",
                        "source": "a + b",
                        "contextPreset": "full-notebook-replay",
                        "trigMode": "deg",
                        "renderMode": "exact",
                        "timeoutMs": 5000,
                    },
                    "bootstrapCode": "def helper_value():\n    return 7",
                    "notebookCells": [
                        {"id": "cell-code", "type": "code", "source": "a = 2", "contextSource": "notebook"},
                        {"id": "cell-math", "type": "math", "source": "b := 3", "contextSource": "draft"},
                    ],
                }
            )
        )
    finally:
        server_extension._RUNTIME_MANAGER = original_manager
        server_extension._runtime_manager = original_factory

    executed_code = fake_manager.calls[0][1]
    assert "def helper_value():" in executed_code
    assert "a = 2" in executed_code
    assert "render_math_cell(\"b := 3\"" in executed_code
    assert "render_math_cell(\"a + b\"" in executed_code
    assert response["executedBootstrap"] is True
    assert response["replayedCellIds"] == ["cell-code", "cell-math"]
    assert response["contextSourcesUsed"] == ["bootstrap", "notebook", "draft"]
