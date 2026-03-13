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
    response = asyncio.run(
        execute_notebook_request(
            {
                "cells": [{"id": "cell-1", "type": "code", "source": 'print("hello world")'}],
                "targetCellId": "cell-1",
                "trigMode": "deg",
                "defaultMathRenderMode": "exact",
                "timeoutMs": 5000,
            }
        )
    )

    assert response["status"] == "ok"
    assert response["output"]["type"] == "mime"
    assert response["output"]["data"]["text/plain"] == "hello world\n"
