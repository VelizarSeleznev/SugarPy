#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEB_DIR="$ROOT_DIR/web"

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --extra test --frozen
source "$ROOT_DIR/.venv/bin/activate"

"$ROOT_DIR/scripts/sync-functions.sh"

maybe_reuse_existing_vite() {
  local pid command cwd
  pid=$(lsof -t -nP -iTCP:5173 -sTCP:LISTEN 2>/dev/null | head -n1 || true)
  if [[ -z "$pid" ]]; then
    return 0
  fi
  command=$(ps -p "$pid" -o command= 2>/dev/null || true)
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1 || true)
  if [[ "$command" == *"/node_modules/.bin/vite"* && "$cwd" == "$WEB_DIR" ]]; then
    export PLAYWRIGHT_REUSE_EXISTING=1
    echo "Reusing existing Vite dev server on http://localhost:5173"
  fi
}

echo "Running backend tests..."
pytest tests/backend/

cd "$WEB_DIR"

npm ci

npm run build
npm audit --audit-level=moderate || true

echo "Running Playwright E2E..."
maybe_reuse_existing_vite
if [[ "${SUGARPY_INCLUDE_ASSISTANT_E2E:-0}" == "1" ]]; then
  npm run test:e2e
else
  echo "Skipping assistant-heavy E2E in default test-all run."
  npm run test:e2e -- --grep-invert "Assistant "
fi

echo "Hooray, all checks passed!"
