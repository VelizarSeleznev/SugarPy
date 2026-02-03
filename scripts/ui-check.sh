#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

"$ROOT_DIR/scripts/run-all.sh" &
RUN_PID=$!

cleanup() {
  if kill -0 "$RUN_PID" 2>/dev/null; then
    kill "$RUN_PID"
  fi
}
trap cleanup EXIT

# Wait for frontend
for i in {1..60}; do
  if curl -s "http://localhost:5173" >/dev/null; then
    break
  fi
  sleep 0.5
done

# If run-all failed, exit early
if ! kill -0 "$RUN_PID" 2>/dev/null; then
  echo "run-all.sh exited early. Check port 8888 availability and logs."
  exit 1
fi

cd "$ROOT_DIR/web"
if [ ! -d node_modules ]; then
  npm ci
fi

HEADED=${HEADED:-0}
MODE_FLAG=""
if [ "$HEADED" = "1" ]; then
  MODE_FLAG="--headed"
fi

npx agent-browser open http://localhost:5173 $MODE_FLAG
npx agent-browser wait --load networkidle $MODE_FLAG

RAW_ERRORS=$(npx agent-browser eval "JSON.stringify(window.__sugarpy_errors || [])" $MODE_FLAG | tail -n 1)
ERRORS_STRIPPED=$(echo "$RAW_ERRORS" | sed -e 's/^"//' -e 's/"$//')

npx agent-browser close $MODE_FLAG

if [ "$ERRORS_STRIPPED" != "[]" ]; then
  echo "UI console errors detected:"
  echo "$ERRORS_STRIPPED"
  exit 1
fi

echo "UI check passed (no console errors)."
