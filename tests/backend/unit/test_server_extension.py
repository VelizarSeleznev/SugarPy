import asyncio

from sugarpy.server_extension import execute_notebook_request, validate_restricted_python


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


def test_execute_notebook_request_prefers_stdout_over_synthetic_none_for_print():
    class FakeRuntimeManager:
        def __init__(self):
            self.calls = []

        async def execute_in_runtime(self, notebook_id, code, timeout_s):
            self.calls.append((notebook_id, code, timeout_s))
            return (
                {
                    "status": "ok",
                    "stdout": "hello world\n",
                    "stderr": "",
                    "mimeData": {},
                    "errorName": None,
                    "errorValue": None,
                },
                {"notebookId": notebook_id, "status": "connected", "backend": "docker"},
            )

    fake_manager = FakeRuntimeManager()

    from sugarpy import server_extension

    original_factory = server_extension._runtime_manager
    server_extension._runtime_manager = lambda: fake_manager
    try:
        response = asyncio.run(
            execute_notebook_request(
                {
                    "notebookId": "nb-1",
                    "cells": [{"id": "cell-1", "type": "code", "source": 'print("hello world")'}],
                    "targetCellId": "cell-1",
                    "trigMode": "deg",
                    "defaultMathRenderMode": "exact",
                    "timeoutMs": 5000,
                }
            )
        )
    finally:
        server_extension._runtime_manager = original_factory

    assert response["status"] == "ok"
    assert response["output"]["type"] == "mime"
    assert response["output"]["data"]["text/plain"] == "hello world\n"
    assert response["runtime"]["status"] == "connected"
    assert fake_manager.calls[0][0] == "nb-1"
