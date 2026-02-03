#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

"$ROOT_DIR/scripts/launch.sh" &
JUPYTER_PID=$!

cd "$ROOT_DIR/web"

npm install
npm run dev

kill $JUPYTER_PID
