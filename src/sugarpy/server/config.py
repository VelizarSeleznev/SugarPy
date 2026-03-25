from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable

OPENAI_API_URL = "https://api.openai.com/v1/responses"
GEMINI_API_ROOT = "https://generativelanguage.googleapis.com/v1beta"
GROQ_API_ROOT = "https://api.groq.com/openai/v1"
DEFAULT_SECURITY_PROFILE = "restricted-demo"
DEFAULT_STORAGE_DIRNAME = "runtime"
DEFAULT_NOTEBOOK_TIMEOUT_S = 20.0
DEFAULT_SANDBOX_TIMEOUT_S = 5.0
DEFAULT_ASSISTANT_TRACES_ENABLED = False


def assistant_secret_file_path() -> str:
    configured = os.environ.get("SUGARPY_ASSISTANT_ENV_FILE", "").strip()
    if configured:
        return os.path.expanduser(configured)
    return os.path.expanduser("~/.config/sugarpy/assistant.env")


def _load_env_file_values(path: str) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip()
    except FileNotFoundError:
        return values
    except OSError:
        return values
    return values


def assistant_setting(name: str) -> str:
    env_value = os.environ.get(name, "").strip()
    if env_value:
        return env_value
    return _load_env_file_values(assistant_secret_file_path()).get(name, "").strip()


def security_profile() -> str:
    return os.environ.get("SUGARPY_SECURITY_PROFILE", DEFAULT_SECURITY_PROFILE).strip() or DEFAULT_SECURITY_PROFILE


def assistant_traces_enabled() -> bool:
    raw = os.environ.get("SUGARPY_ENABLE_ASSISTANT_TRACES", "").strip().lower()
    if not raw:
        return DEFAULT_ASSISTANT_TRACES_ENABLED
    return raw in {"1", "true", "yes", "on"}


def sandbox_code_cells_restricted() -> bool:
    return security_profile() in {"restricted-demo", "school-secure"}


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def live_runtime_backend(runtime_manager_factory: Callable[[], Any]) -> str:
    return runtime_manager_factory().backend


def live_code_cells_restricted(runtime_manager_factory: Callable[[], Any]) -> bool:
    return live_runtime_backend(runtime_manager_factory) != "docker" and sandbox_code_cells_restricted()


def live_runtime_network_enabled(runtime_manager_factory: Callable[[], Any]) -> bool:
    return live_runtime_backend(runtime_manager_factory) == "docker"


def load_assistant_server_config(
    *,
    runtime_backend: str,
    assistant_sandbox_available: bool,
) -> dict[str, Any]:
    return {
        "mode": security_profile(),
        "model": assistant_setting("SUGARPY_ASSISTANT_MODEL") or None,
        "assistantTracesEnabled": assistant_traces_enabled(),
        "providers": {
            "openai": bool(assistant_setting("SUGARPY_ASSISTANT_OPENAI_API_KEY")),
            "gemini": bool(assistant_setting("SUGARPY_ASSISTANT_GEMINI_API_KEY")),
            "groq": bool(assistant_setting("SUGARPY_ASSISTANT_GROQ_API_KEY")),
        },
        "execution": {
            "ephemeral": False,
            "networkEnabled": runtime_backend == "docker",
            "directBrowserKernelAccess": False,
            "codeCellsRestricted": runtime_backend != "docker" and sandbox_code_cells_restricted(),
            "assistantSandboxEphemeral": True,
            "assistantSandboxCodeCellsRestricted": sandbox_code_cells_restricted(),
            "assistantSandboxAvailable": assistant_sandbox_available,
            "assistantSandboxDockerOnly": security_profile() in {"restricted-demo", "school-secure"},
            "coldStartReplay": False,
            "runtimeBackend": runtime_backend,
        },
    }

