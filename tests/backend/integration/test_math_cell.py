from unittest.mock import patch

import pytest
from IPython.core.interactiveshell import InteractiveShell

from sugarpy.math_cell import render_math_cell


@pytest.fixture
def integration_shell():
    shell = InteractiveShell.instance()
    preserved = dict(shell.user_ns)
    try:
        yield shell
    finally:
        shell.user_ns.clear()
        shell.user_ns.update(preserved)


@pytest.mark.integration
def test_code_namespace_function_is_available_in_math_cell(integration_shell):
    integration_shell.run_cell("def f(x):\n    return x + 1")
    with patch("sugarpy.math_cell.get_ipython", return_value=integration_shell):
        result = render_math_cell("f(3)")
    assert result["ok"] is True
    assert result["value"] == "4"
