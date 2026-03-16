#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/check-common.sh"

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
fi

ensure_python_env
sync_functions
run_cmd bash -lc "cd '$ROOT_DIR' && source '$ROOT_DIR/.venv/bin/activate' && python -m pytest -q tests/backend/integration/test_runtime_reliability.py tests/backend/unit/test_runtime_manager.py tests/backend/unit/test_server_extension.py"
