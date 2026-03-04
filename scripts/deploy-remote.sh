#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"

SSH_OPTS=(
  -p "${DEPLOY_PORT}"
  -o BatchMode=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=4
)

KNOWN_HOSTS_FILE=""
if [[ -n "${DEPLOY_SSH_KNOWN_HOSTS:-}" ]]; then
  KNOWN_HOSTS_FILE=$(mktemp)
  printf "%s\n" "${DEPLOY_SSH_KNOWN_HOSTS}" > "${KNOWN_HOSTS_FILE}"
  chmod 600 "${KNOWN_HOSTS_FILE}"
  SSH_OPTS+=(-o StrictHostKeyChecking=yes -o UserKnownHostsFile="${KNOWN_HOSTS_FILE}")
else
  SSH_OPTS+=(-o StrictHostKeyChecking=accept-new)
fi

cleanup() {
  if [[ -n "${KNOWN_HOSTS_FILE}" && -f "${KNOWN_HOSTS_FILE}" ]]; then
    rm -f "${KNOWN_HOSTS_FILE}"
  fi
}
trap cleanup EXIT

echo "Deploying to ${REMOTE}:${DEPLOY_PATH}"

# 1) Upload repository snapshot (without local build artifacts).
cd "${ROOT_DIR}"
tar \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='web/node_modules' \
  --exclude='artifacts' \
  --exclude='output' \
  --exclude='notebooks/.sugarpy-autosave' \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" "mkdir -p '${DEPLOY_PATH}' && tar -xzf - -C '${DEPLOY_PATH}'"

# 2) Build frontend on server.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "cd '${DEPLOY_PATH}/web' && npm ci && npm run build"

# 3) Best-effort service restart/reload.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -e
  if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo systemctl restart sugarpy-jupyter.service || true
    sudo systemctl reload nginx || true
  else
    echo 'No passwordless sudo; skipping system service restart.'
  fi
"

# 4) Health checks.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "curl -fsS http://127.0.0.1:18081/ >/dev/null"
if [[ -n "${DEPLOY_JUPYTER_TOKEN:-}" ]]; then
  ssh "${SSH_OPTS[@]}" "${REMOTE}" \
    "curl -fsS 'http://127.0.0.1:18081/jupyter/api/status?token=${DEPLOY_JUPYTER_TOKEN}' >/dev/null"
fi

echo "Deploy completed."
