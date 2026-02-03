#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

# Ensure port is free
if lsof -i tcp:8888 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8888 is already in use. Stop the existing process and try again."
  exit 1
fi

# Ensure python deps are synced via uv
UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --frozen
source "$ROOT_DIR/.venv/bin/activate"

"$ROOT_DIR/scripts/sync-functions.sh"

"$ROOT_DIR/scripts/launch.sh" &
JUPYTER_PID=$!

cleanup() {
  if kill -0 "$JUPYTER_PID" 2>/dev/null; then
    kill "$JUPYTER_PID"
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR/web"

if [ ! -d node_modules ]; then
  npm install
fi

echo "Waiting for Jupyter Server..."
READY=0
for i in {1..60}; do
  if curl -s "http://localhost:8888/api/status?token=sugarpy" >/dev/null; then
    echo "Jupyter Server is ready."
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" = "0" ]; then
  echo "Jupyter Server did not start on http://localhost:8888. Check for port conflicts."
  exit 1
fi

echo "Open http://localhost:5173"
npm run dev
