#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export IPYTHONDIR="$ROOT_DIR/.ipython"
STARTUP_DIR="$IPYTHONDIR/profile_default/startup"
mkdir -p "$STARTUP_DIR"

cat > "$STARTUP_DIR/00-sugarpy.py" <<'PY'
from sugarpy.startup import *
PY

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --frozen
source "$ROOT_DIR/.venv/bin/activate"

JUPYTER_TOKEN=sugarpy

jupyter server \
  --no-browser \
  --ServerApp.port=8888 \
  --ServerApp.port_retries=0 \
  --IdentityProvider.token="$JUPYTER_TOKEN" \
  --ServerApp.log_level=ERROR \
  --LabApp.log_level=ERROR \
  --ServerApp.websocket_ping_interval=30000 \
  --ServerApp.websocket_ping_timeout=30000 \
  --ServerApp.allow_origin="http://localhost:5173" \
  --ServerApp.allow_credentials=True \
  --ServerApp.disable_check_xsrf=True
