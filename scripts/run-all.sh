#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

stop_port_listener() {
  local port="$1"
  local pids
  pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -z "$pids" ]; then
    return
  fi

  echo "Port ${port} is in use. Stopping existing process(es): ${pids}"
  kill $pids 2>/dev/null || true

  for _ in {1..20}; do
    sleep 0.2
    if ! lsof -ti "tcp:${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port ${port} is now free."
      return
    fi
  done

  echo "Port ${port} is still busy. Forcing stop."
  kill -9 $pids 2>/dev/null || true
  sleep 0.2
}

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

# Ensure ports are free by stopping stale processes.
stop_port_listener 8888
stop_port_listener 5173

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
