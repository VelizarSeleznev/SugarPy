import asyncio

from sugarpy import server_extension

from sugarpy.server_extension import (
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
    assert "value = 41" not in fake_manager.execute_calls[0][1]
    assert "value + 1" in fake_manager.execute_calls[0][1]


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
    monkeypatch.setenv("SUGARPY_NOTEBOOK_RUNTIME_BACKEND", "docker")
    monkeypatch.setenv("SUGARPY_SECURITY_PROFILE", "restricted-demo")

    config = _load_assistant_server_config()

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
