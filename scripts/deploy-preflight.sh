#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
DEPLOY_ROOT=$(dirname "${DEPLOY_PATH}")
RELEASES_DIR="${DEPLOY_ROOT}/releases"

SSH_OPTS=(
  -p "${DEPLOY_PORT}"
  -o BatchMode=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=4
  -o StrictHostKeyChecking=accept-new
)

echo "Preflighting deploy to ${REMOTE}:${DEPLOY_PATH}"
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -euo pipefail
  mkdir -p '${DEPLOY_ROOT}' '${RELEASES_DIR}'
  test -w '${DEPLOY_ROOT}'
  test -w '${RELEASES_DIR}'
" >/dev/null

echo "[ok] deploy path reachable and writable"
