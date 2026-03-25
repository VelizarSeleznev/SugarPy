from __future__ import annotations

import ast
from typing import Any
from urllib.parse import urlparse

ALLOWED_IMPORTS = {
    "math",
    "cmath",
    "statistics",
    "fractions",
    "decimal",
    "numpy",
    "sympy",
    "sugarpy",
}
BLOCKED_IMPORT_PREFIXES = (
    "os",
    "sys",
    "subprocess",
    "socket",
    "shutil",
    "pathlib",
    "requests",
    "urllib",
    "http",
    "ftplib",
    "telnetlib",
    "asyncio.subprocess",
    "multiprocessing",
    "ctypes",
    "pexpect",
)
BLOCKED_CALL_NAMES = {
    "open",
    "exec",
    "eval",
    "compile",
    "__import__",
    "input",
    "breakpoint",
}
BLOCKED_ATTR_CALLS = {
    "os.system",
    "os.popen",
    "os.spawnl",
    "os.spawnlp",
    "os.spawnv",
    "os.spawnvp",
    "os.execv",
    "os.execve",
    "os.execl",
    "os.execlp",
    "os.execvp",
    "os.execvpe",
    "subprocess.run",
    "subprocess.Popen",
    "subprocess.call",
    "subprocess.check_call",
    "subprocess.check_output",
    "socket.socket",
    "pathlib.Path.open",
}

# Compatibility aliases for the old server_extension helper names.
blocked_import_prefixes = BLOCKED_IMPORT_PREFIXES
blocked_call_names = BLOCKED_CALL_NAMES
blocked_attr_calls = BLOCKED_ATTR_CALLS


def _node_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        base = _node_name(node.value)
        return f"{base}.{node.attr}" if base else node.attr
    return ""


def validate_restricted_python(source: str) -> list[str]:
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [f"Syntax error: {exc.msg}"]

    errors: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = []
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            else:
                module = node.module or ""
                names = [module] if module else []
            for name in names:
                if any(name == blocked or name.startswith(f"{blocked}.") for blocked in BLOCKED_IMPORT_PREFIXES):
                    errors.append(f"Import blocked in restricted mode: {name}")
                elif name and name.split(".", 1)[0] not in ALLOWED_IMPORTS:
                    errors.append(f"Import not allowed in restricted mode: {name}")
        elif isinstance(node, ast.Call):
            call_name = _node_name(node.func)
            if call_name in BLOCKED_CALL_NAMES or call_name in BLOCKED_ATTR_CALLS:
                errors.append(f"Call blocked in restricted mode: {call_name}")
            elif call_name.endswith(".open"):
                errors.append(f"File access blocked in restricted mode: {call_name}")
        elif isinstance(node, ast.Attribute):
            attr_name = _node_name(node)
            if attr_name.startswith("os.environ"):
                errors.append("Environment access blocked in restricted mode: os.environ")
    return sorted(set(errors))


def truncate_text(value: str, limit: int = 4000) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: max(0, limit - 1)]}…"


def truncate_mime_value(value: Any) -> Any:
    if isinstance(value, str):
        return truncate_text(value, limit=4000)
    if isinstance(value, list):
        return [_truncate(item) for item in value]
    if not isinstance(value, dict):
        return value
    return {key: _truncate(entry) for key, entry in value.items()}


def _truncate(value: Any) -> Any:
    return truncate_mime_value(value)


def loopback_hostname(hostname: str) -> bool:
    return hostname in {"localhost", "127.0.0.1", "::1"}


def origin_allowed_for_host(candidate: str, host: str) -> bool:
    parsed = urlparse(candidate)
    if not parsed.netloc:
        return False
    candidate_host = parsed.hostname or ""
    host_name = host.split(":", 1)[0].strip("[]")
    if parsed.netloc == host:
        return True
    return loopback_hostname(candidate_host) and loopback_hostname(host_name)


def is_execution_timeout(exc: Exception) -> bool:
    if isinstance(exc, TimeoutError):
        return True
    return "timed out" in str(exc).lower()
