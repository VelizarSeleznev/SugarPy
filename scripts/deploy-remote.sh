#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
RELEASE_ID="${DEPLOY_RELEASE_ID:-${GITHUB_SHA:-$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}}"
RELEASES_TO_KEEP="${DEPLOY_RELEASES_TO_KEEP:-5}"

if [[ "${DEPLOY_PATH}" != */current ]]; then
  echo "DEPLOY_PATH must point to the stable current symlink (for example /opt/sugarpy/current)."
  exit 1
fi

DEPLOY_ROOT=$(dirname "${DEPLOY_PATH}")
RELEASES_DIR="${DEPLOY_ROOT}/releases"
SHARED_DIR="${DEPLOY_ROOT}/shared"
RELEASE_PATH="${RELEASES_DIR}/${RELEASE_ID}"

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

create_repo_archive() {
  local tar_format_args=()

  if tar --version 2>/dev/null | grep -qi 'bsdtar'; then
    tar_format_args+=(--format=ustar)
    COPYFILE_DISABLE=1 tar "${tar_format_args[@]}" \
      --exclude='.git' \
      --exclude='.venv' \
      --exclude='web/node_modules' \
      --exclude='artifacts' \
      --exclude='output' \
      --exclude='notebooks/.sugarpy-autosave' \
      -czf - .
    return
  fi

  tar \
    --exclude='.git' \
    --exclude='.venv' \
    --exclude='web/node_modules' \
    --exclude='artifacts' \
    --exclude='output' \
    --exclude='notebooks/.sugarpy-autosave' \
    -czf - .
}

retry_remote_until_ok() {
  local description="$1"
  local command="$2"

  for _ in {1..20}; do
    if ssh "${SSH_OPTS[@]}" "${REMOTE}" "export PATH=\"\$HOME/.local/bin:\$PATH\"; ${command}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "${description} did not become healthy in time."
  ssh "${SSH_OPTS[@]}" "${REMOTE}" "export PATH=\"\$HOME/.local/bin:\$PATH\"; ${command}"
}

echo "Deploying to ${REMOTE}:${DEPLOY_PATH}"
echo "Release ID: ${RELEASE_ID}"

"$ROOT_DIR/scripts/deploy-preflight.sh"

# 1) Upload repository snapshot into a new release directory.
cd "${ROOT_DIR}"
create_repo_archive \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" "
      export PATH=\"\$HOME/.local/bin:\$PATH\"
      set -euo pipefail
      mkdir -p '${RELEASE_PATH}'
      tar -xzf - -C '${RELEASE_PATH}'
    "

# 2) Prepare shared runtime state and build the release in isolation.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  mkdir -p '${RELEASES_DIR}' '${SHARED_DIR}/notebooks' '${SHARED_DIR}/.ipython'
  if [ -d '${RELEASE_PATH}/notebooks' ]; then
    cp -a '${RELEASE_PATH}/notebooks/.' '${SHARED_DIR}/notebooks/'
    rm -rf '${RELEASE_PATH}/notebooks'
  fi
  ln -sfn '${SHARED_DIR}/notebooks' '${RELEASE_PATH}/notebooks'
  cd '${RELEASE_PATH}'
  UV_PROJECT_ENVIRONMENT='${SHARED_DIR}/.venv' uv sync --extra lab --frozen
  cd '${RELEASE_PATH}/web'
  npm ci
  npm run build
"

# 3) Atomically switch current to the new release.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -e
  ln -sfn '${RELEASE_PATH}' '${DEPLOY_ROOT}/.current.next'
  mv -Tf '${DEPLOY_ROOT}/.current.next' '${DEPLOY_PATH}'
"

# 4) Reload services.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -e
  sudo systemctl restart sugarpy-jupyter.service
  sudo systemctl reload nginx
"

# 5) Health checks.
retry_remote_until_ok "Frontend health check" "curl -fsS http://127.0.0.1:18081/ >/dev/null"
if [[ -n "${DEPLOY_JUPYTER_TOKEN:-}" ]]; then
  retry_remote_until_ok "Jupyter health check" "curl -fsS 'http://127.0.0.1:8888/jupyter/api/status?token=${DEPLOY_JUPYTER_TOKEN}' >/dev/null"
fi

# 6) Keep the most recent releases and prune older ones.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  if [ -d '${RELEASES_DIR}' ]; then
    ls -1dt '${RELEASES_DIR}'/* 2>/dev/null | tail -n +$((RELEASES_TO_KEEP + 1)) | xargs -r rm -rf --
  fi
"

echo "Deploy completed."
