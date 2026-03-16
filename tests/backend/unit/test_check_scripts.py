import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


def run_script(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    combined_env = os.environ.copy()
    if env:
        combined_env.update(env)
    return subprocess.run(
        [str(ROOT / "scripts" / args[0]), *args[1:]],
        cwd=ROOT,
        env=combined_env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_check_runtime_dry_run_lists_runtime_verification_commands():
    result = run_script("check", "runtime", "--dry-run")

    assert result.returncode == 0
    assert "check-runtime.sh" in result.stdout
    assert "check-runtime-ui.sh" in result.stdout


def test_check_all_enforces_runtime_docs_manifest_and_tests_for_runtime_critical_changes():
    result = run_script(
        "check",
        "all",
        "--dry-run",
        env={"CHECK_CHANGED_FILES": "src/sugarpy/runtime_manager.py"},
    )

    assert result.returncode != 0
    assert "matching docs update" in result.stderr.lower()


def test_check_all_runs_runtime_gate_when_runtime_critical_changes_are_classified():
    changed_files = "\n".join(
        [
            "src/sugarpy/runtime_manager.py",
            "docs/ARCHITECTURE.md",
            "docs/verification/runtime-hardening-2026-03-16.md",
            "tests/backend/integration/test_runtime_reliability.py",
        ]
    )
    result = run_script(
        "check",
        "all",
        "--dry-run",
        env={"CHECK_CHANGED_FILES": changed_files},
    )

    assert result.returncode == 0
    assert "check-runtime.sh" in result.stdout
    assert "python\\ -m\\ pytest\\ tests/backend/" in result.stdout


def test_doctor_script_reports_missing_tooling_with_nonzero_status(tmp_path: Path):
    result = subprocess.run(
        ["/bin/bash", str(ROOT / "scripts" / "doctor.sh")],
        cwd=tmp_path,
        env={"PATH": ""},
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode != 0
    assert "[missing] uv" in result.stdout


def test_deploy_scripts_probe_internal_jupyter_health_endpoint():
    remote_script = (ROOT / "scripts" / "deploy-remote.sh").read_text()
    local_script = (ROOT / "scripts" / "deploy-local.sh").read_text()

    assert "http://127.0.0.1:8888/jupyter/api/status" in remote_script
    assert "http://127.0.0.1:8888/jupyter/api/status" in local_script
    assert "http://127.0.0.1:18081/jupyter/api/status" not in remote_script
    assert "http://127.0.0.1:18081/jupyter/api/status" not in local_script
    assert "retry_remote_until_ok" in remote_script
