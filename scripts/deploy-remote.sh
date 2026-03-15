#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${DEPLOY_HOST:?DEPLOY_HOST is required}"
: "${DEPLOY_USER:?DEPLOY_USER is required}"
: "${DEPLOY_PATH:?DEPLOY_PATH is required}"

DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_APP_USER="${DEPLOY_APP_USER:-sugarpy}"
DEPLOY_DOCKER_USER="${DEPLOY_DOCKER_USER:-${DEPLOY_USER}}"
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

remote_retry_until_ok() {
  local description="$1"
  local command="$2"
  ssh "${SSH_OPTS[@]}" "${REMOTE}" "
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    set -euo pipefail
    for _ in {1..20}; do
      if bash -lc '${command}' >/dev/null 2>&1; then
        exit 0
      fi
      sleep 2
    done
    echo '${description} did not become healthy in time.'
    bash -lc '${command}'
  "
}

remote_shell_prefix_for_user() {
  local target_user="$1"
  if [[ "${target_user}" == "${DEPLOY_USER}" ]]; then
    printf '%s' "/bin/bash -lc"
  else
    printf '%s' "sudo -n -u '${target_user}' /bin/bash -lc"
  fi
}

REMOTE_APP_SHELL=$(remote_shell_prefix_for_user "${DEPLOY_APP_USER}")
REMOTE_DOCKER_SHELL=$(remote_shell_prefix_for_user "${DEPLOY_DOCKER_USER}")

echo "Deploying to ${REMOTE}:${DEPLOY_PATH}"
echo "Release ID: ${RELEASE_ID}"
echo "App user: ${DEPLOY_APP_USER}"
echo "Docker user: ${DEPLOY_DOCKER_USER}"

# 1) Upload repository snapshot into a new release directory.
cd "${ROOT_DIR}"
tar \
  --exclude='.git' \
  --exclude='.venv' \
  --exclude='web/node_modules' \
  --exclude='artifacts' \
  --exclude='output' \
  --exclude='notebooks/.sugarpy-autosave' \
  -czf - . \
  | ssh "${SSH_OPTS[@]}" "${REMOTE}" "
      set -euo pipefail
      ${REMOTE_APP_SHELL} '
        export PATH=\"\$HOME/.local/bin:\$PATH\"
        set -euo pipefail
        rm -rf \"${RELEASE_PATH}\"
        mkdir -p \"${RELEASE_PATH}\" \"${RELEASES_DIR}\" \"${SHARED_DIR}/notebooks\" \"${SHARED_DIR}/.ipython\"
        tar -xzf - -C \"${RELEASE_PATH}\"
      '
    "

# 2) Prepare shared runtime state and build the release in isolation.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -euo pipefail
  ${REMOTE_APP_SHELL} '
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    export UV_PROJECT_ENVIRONMENT=\"${SHARED_DIR}/.venv\"
    set -euo pipefail
    if [ -d \"${RELEASE_PATH}/notebooks\" ]; then
      cp -a \"${RELEASE_PATH}/notebooks/.\" \"${SHARED_DIR}/notebooks/\"
      rm -rf \"${RELEASE_PATH}/notebooks\"
    fi
    ln -sfn \"${SHARED_DIR}/notebooks\" \"${RELEASE_PATH}/notebooks\"
    cd \"${RELEASE_PATH}\"
    uv sync --extra lab --frozen
    cd \"${RELEASE_PATH}/web\"
    npm ci
    npm run build
  '
  ${REMOTE_DOCKER_SHELL} '
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    set -euo pipefail
    cd \"${RELEASE_PATH}\"
    ./scripts/build-runtime-image.sh
  '
"

# 3) Atomically switch current to the new release.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -euo pipefail
  ${REMOTE_APP_SHELL} '
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    set -euo pipefail
    ln -sfn \"${RELEASE_PATH}\" \"${DEPLOY_ROOT}/.current.next\"
    mv -Tf \"${DEPLOY_ROOT}/.current.next\" \"${DEPLOY_PATH}\"
  '
"

# 4) Reload services.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  sudo -n systemctl restart sugarpy-jupyter.service
  sudo -n systemctl reload nginx
"

# 5) Health checks.
remote_retry_until_ok "Frontend health check" "curl -fsS http://127.0.0.1:18081/"
if [[ -n "${DEPLOY_JUPYTER_TOKEN:-}" ]]; then
  remote_retry_until_ok "Jupyter health check" "curl -fsS 'http://127.0.0.1:8888/jupyter/api/status?token=${DEPLOY_JUPYTER_TOKEN}'"
fi

# 6) Keep the most recent releases and prune older ones.
ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -euo pipefail
  ${REMOTE_APP_SHELL} '
    export PATH=\"\$HOME/.local/bin:\$PATH\"
    set -euo pipefail
    if [ -d \"${RELEASES_DIR}\" ]; then
      ls -1dt \"${RELEASES_DIR}\"/* 2>/dev/null | tail -n +$((RELEASES_TO_KEEP + 1)) | xargs -r rm -rf --
    fi
  '
"

echo "Deploy completed."
