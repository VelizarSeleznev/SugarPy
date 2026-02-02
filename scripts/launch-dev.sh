#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

"$ROOT_DIR/scripts/launch.sh" &
JUPYTER_PID=$!

cd "$ROOT_DIR/web"

npm install
npm run dev

kill $JUPYTER_PID
