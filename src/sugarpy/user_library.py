"""User-defined function library storage."""

from __future__ import annotations

from pathlib import Path


def user_library_path() -> Path:
    return Path.home() / ".sugarpy" / "user_functions.py"


def ensure_user_library() -> Path:
    path = user_library_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text("# User functions\n", encoding="utf-8")
    return path


def append_function(code: str) -> Path:
    path = ensure_user_library()
    with path.open("a", encoding="utf-8") as f:
        f.write("\n\n" + code.strip() + "\n")
    return path


def load_user_functions() -> None:
    path = ensure_user_library()
    content = path.read_text(encoding="utf-8")
    scope = globals()
    exec(content, scope, scope)
