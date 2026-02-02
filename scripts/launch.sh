#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export IPYTHONDIR="$ROOT_DIR/.ipython"
STARTUP_DIR="$IPYTHONDIR/profile_default/startup"
mkdir -p "$STARTUP_DIR"

cat > "$STARTUP_DIR/00-sugarpy.py" <<'PY'
from sugarpy.startup import *
PY

if [ ! -d "$ROOT_DIR/.venv" ]; then
  python3 -m venv "$ROOT_DIR/.venv"
fi
source "$ROOT_DIR/.venv/bin/activate"

pip install -U pip
pip install -e "$ROOT_DIR[lab]"

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
