#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --extra test --frozen
source "$ROOT_DIR/.venv/bin/activate"

"$ROOT_DIR/scripts/sync-functions.sh"

echo "Running backend tests..."
pytest tests/backend/

cd "$ROOT_DIR/web"

npm ci

npm run build
npm audit --audit-level=moderate || true

echo "Running Playwright E2E..."
if [[ "${SUGARPY_INCLUDE_ASSISTANT_E2E:-0}" == "1" ]]; then
  npm run test:e2e
else
  echo "Skipping assistant-heavy E2E in default test-all run."
  npm run test:e2e -- --grep-invert "Assistant "
fi

echo "Hooray, all checks passed!"
