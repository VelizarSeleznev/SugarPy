#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT_DIR}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth login"
  exit 1
fi

DEPLOY_HOST="${1:-seggver}"
DEPLOY_USER="${2:-sugarpy}"
DEPLOY_PATH="${3:-/opt/sugarpy/current}"
DEPLOY_PORT="${4:-22}"
DEPLOY_JUPYTER_TOKEN="${5:-sugarpy}"
SSH_KEY_PATH="${SSH_KEY_PATH:-$HOME/.ssh/id_ed25519}"

if [[ ! -f "${SSH_KEY_PATH}" ]]; then
  echo "SSH private key not found at ${SSH_KEY_PATH}"
  exit 1
fi

if ! command -v ssh-keyscan >/dev/null 2>&1; then
  echo "ssh-keyscan is required."
  exit 1
fi

KNOWN_HOSTS=$(ssh-keyscan -p "${DEPLOY_PORT}" -H "${DEPLOY_HOST}" 2>/dev/null || true)
if [[ -z "${KNOWN_HOSTS}" ]]; then
  echo "Unable to fetch host key for ${DEPLOY_HOST}:${DEPLOY_PORT}"
  exit 1
fi

echo "Setting repository secrets via gh..."
gh secret set DEPLOY_HOST --body "${DEPLOY_HOST}"
gh secret set DEPLOY_USER --body "${DEPLOY_USER}"
gh secret set DEPLOY_PATH --body "${DEPLOY_PATH}"
gh secret set DEPLOY_PORT --body "${DEPLOY_PORT}"
gh secret set DEPLOY_JUPYTER_TOKEN --body "${DEPLOY_JUPYTER_TOKEN}"
gh secret set DEPLOY_SSH_KNOWN_HOSTS --body "${KNOWN_HOSTS}"
gh secret set DEPLOY_SSH_KEY < "${SSH_KEY_PATH}"

echo "Secrets configured:"
echo "  DEPLOY_HOST=${DEPLOY_HOST}"
echo "  DEPLOY_USER=${DEPLOY_USER}"
echo "  DEPLOY_PATH=${DEPLOY_PATH}"
echo "  DEPLOY_PORT=${DEPLOY_PORT}"
