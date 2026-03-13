#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export IPYTHONDIR="$ROOT_DIR/.ipython"
export JUPYTER_CONFIG_DIR="$ROOT_DIR/.jupyter"
STARTUP_DIR="$IPYTHONDIR/profile_default/startup"
mkdir -p "$STARTUP_DIR"
mkdir -p "$JUPYTER_CONFIG_DIR"

cat > "$STARTUP_DIR/00-sugarpy.py" <<'PY'
from sugarpy.startup import *
PY

cat > "$JUPYTER_CONFIG_DIR/jupyter_server_config.py" <<'PY'
c = get_config()
c.ServerApp.jpserver_extensions = {"sugarpy.server_extension": True}
PY

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --frozen
source "$ROOT_DIR/.venv/bin/activate"

jupyter server \
  --no-browser \
  --ServerApp.port=8888 \
  --ServerApp.port_retries=0 \
  --IdentityProvider.token="" \
  --ServerApp.log_level=ERROR \
  --LabApp.log_level=ERROR \
  --ServerApp.websocket_ping_interval=30000 \
  --ServerApp.websocket_ping_timeout=30000 \
  --ServerApp.allow_origin="http://localhost:5173" \
  --ServerApp.allow_remote_access=True \
  --ServerApp.allow_credentials=False \
  --ServerApp.disable_check_xsrf=False
