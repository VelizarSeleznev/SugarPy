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
npm run test:e2e

echo "Hooray, all checks passed!"
