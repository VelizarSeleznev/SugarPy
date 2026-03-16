#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STATUS=0

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    echo "[ok] $name"
  else
    echo "[missing] $name"
    STATUS=1
  fi
}

check_path() {
  local label="$1"
  local path="$2"
  if [[ -e "$path" ]]; then
    echo "[ok] $label: $path"
  else
    echo "[missing] $label: $path"
    STATUS=1
  fi
}

echo "Doctor checks for $ROOT_DIR"
check_cmd uv
check_cmd node
check_cmd npm
check_cmd docker
check_path "python env" "$ROOT_DIR/.venv"
check_path "playwright package" "$ROOT_DIR/web/node_modules/@playwright/test"
check_path "runtime image build script" "$ROOT_DIR/scripts/build-runtime-image.sh"

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  if "$ROOT_DIR/.venv/bin/python" -m pytest --version >/dev/null 2>&1; then
    echo "[ok] pytest in .venv"
  else
    echo "[missing] pytest in .venv"
    STATUS=1
  fi
fi

if [[ -x "$ROOT_DIR/web/node_modules/.bin/playwright" ]]; then
  if (cd "$ROOT_DIR/web" && npx playwright --version >/dev/null 2>&1); then
    echo "[ok] playwright browser tooling"
  else
    echo "[missing] playwright browser tooling"
    STATUS=1
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if docker image inspect sugarpy-runtime:latest >/dev/null 2>&1; then
    echo "[ok] runtime image: sugarpy-runtime:latest"
  else
    echo "[missing] runtime image: sugarpy-runtime:latest (build with ./scripts/build-runtime-image.sh)"
    STATUS=1
  fi
fi

if [[ -n "${DEPLOY_HOST:-}" || -n "${DEPLOY_PATH:-}" || -n "${DEPLOY_USER:-}" ]]; then
  "$ROOT_DIR/scripts/deploy-preflight.sh" || STATUS=1
fi

exit "$STATUS"
