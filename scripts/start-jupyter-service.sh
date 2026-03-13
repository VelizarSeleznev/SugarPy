#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${IPYTHONDIR:?IPYTHONDIR is required}"
: "${JUPYTER_CONFIG_DIR:?JUPYTER_CONFIG_DIR is required}"
: "${UV_PROJECT_ENVIRONMENT:?UV_PROJECT_ENVIRONMENT is required}"

export JUPYTER_RUNTIME_DIR="${JUPYTER_RUNTIME_DIR:-/opt/sugarpy/shared/.jupyter-runtime}"
export PATH="$UV_PROJECT_ENVIRONMENT/bin:${PATH}"

mkdir -p "$IPYTHONDIR/profile_default/startup" "$JUPYTER_CONFIG_DIR" "$JUPYTER_RUNTIME_DIR"

cat > "$IPYTHONDIR/profile_default/startup/00-sugarpy.py" <<'PY'
from sugarpy.startup import *
PY

cat > "$JUPYTER_CONFIG_DIR/jupyter_server_config.py" <<'PY'
c = get_config()
c.ServerApp.jpserver_extensions = {"sugarpy.server_extension": True}
PY

source "$UV_PROJECT_ENVIRONMENT/bin/activate"

exec jupyter server \
  --no-browser \
  --ip=127.0.0.1 \
  --ServerApp.port=8888 \
  --ServerApp.port_retries=0 \
  --ServerApp.base_url=/jupyter/ \
  --IdentityProvider.token="" \
  --ServerApp.log_level=ERROR \
  --LabApp.log_level=ERROR \
  --ServerApp.websocket_ping_interval=30000 \
  --ServerApp.websocket_ping_timeout=30000 \
  --ServerApp.allow_origin="" \
  --ServerApp.allow_remote_access=True \
  --ServerApp.allow_credentials=False \
  --ServerApp.disable_check_xsrf=False \
  --MappingKernelManager.cull_idle_timeout=1800 \
  --MappingKernelManager.cull_interval=60
