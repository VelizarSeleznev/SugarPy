#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEB_DIR="$ROOT_DIR/web"

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

cd "$WEB_DIR"
maybe_reuse_existing_vite
npm run test:e2e -- --grep @smoke
