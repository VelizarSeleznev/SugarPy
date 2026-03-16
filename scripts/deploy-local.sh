#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

: "${DEPLOY_PATH:=/opt/sugarpy/current}"
: "${DEPLOY_JUPYTER_TOKEN:=sugarpy}"

if [[ "${DEPLOY_PATH}" != */current ]]; then
  echo "DEPLOY_PATH must point to the stable current symlink (for example /opt/sugarpy/current)."
  exit 1
fi

RELEASE_ID="${DEPLOY_RELEASE_ID:-${GITHUB_SHA:-$(git -C "${ROOT_DIR}" rev-parse HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}}"
RELEASES_TO_KEEP="${DEPLOY_RELEASES_TO_KEEP:-5}"
DEPLOY_ROOT=$(dirname "${DEPLOY_PATH}")
RELEASES_DIR="${DEPLOY_ROOT}/releases"
SHARED_DIR="${DEPLOY_ROOT}/shared"
RELEASE_PATH="${RELEASES_DIR}/${RELEASE_ID}"
RUN_AS_SUGARPY="sudo -u sugarpy /bin/bash -lc"

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

retry_until_ok() {
  local description="$1"
  local command="$2"

  for _ in {1..20}; do
    if bash -lc "${command}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "${description} did not become healthy in time."
  bash -lc "${command}"
}
echo "Local deploy root: ${DEPLOY_ROOT}"
echo "Release ID: ${RELEASE_ID}"

cd "${ROOT_DIR}"

# 1) Prepare a fresh release directory as the sugarpy runtime user.
${RUN_AS_SUGARPY} "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  mkdir -p '${RELEASES_DIR}' '${SHARED_DIR}/notebooks' '${SHARED_DIR}/.ipython'
  rm -rf '${RELEASE_PATH}'
  mkdir -p '${RELEASE_PATH}'
"

# 2) Copy the checked-out repository into the release directory.
create_repo_archive \
  | ${RUN_AS_SUGARPY} "
      export PATH=\"\$HOME/.local/bin:\$PATH\"
      set -euo pipefail
      tar -xzf - -C '${RELEASE_PATH}'
    "

# 3) Build in-place using the shared runtime state.
${RUN_AS_SUGARPY} "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  export UV_PROJECT_ENVIRONMENT='${SHARED_DIR}/.venv'
  set -euo pipefail

  if [ -d '${RELEASE_PATH}/notebooks' ]; then
    cp -a '${RELEASE_PATH}/notebooks/.' '${SHARED_DIR}/notebooks/'
    rm -rf '${RELEASE_PATH}/notebooks'
  fi
  ln -sfn '${SHARED_DIR}/notebooks' '${RELEASE_PATH}/notebooks'

  cd '${RELEASE_PATH}'
  uv sync --extra lab --frozen

  cd '${RELEASE_PATH}/web'
  npm ci
  npm run build
"

# 4) Atomically switch the active release and reload services.
${RUN_AS_SUGARPY} "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  ln -sfn '${RELEASE_PATH}' '${DEPLOY_ROOT}/.current.next'
  mv -Tf '${DEPLOY_ROOT}/.current.next' '${DEPLOY_PATH}'
"

sudo systemctl restart sugarpy-jupyter.service
sudo systemctl reload nginx

# 5) Health checks.
retry_until_ok "Frontend health check" "curl -fsS http://127.0.0.1:18081/"
retry_until_ok "Jupyter health check" "curl -fsS 'http://127.0.0.1:8888/jupyter/api/status?token=${DEPLOY_JUPYTER_TOKEN}'"

# 6) Prune old releases.
${RUN_AS_SUGARPY} "
  export PATH=\"\$HOME/.local/bin:\$PATH\"
  set -euo pipefail
  if [ -d '${RELEASES_DIR}' ]; then
    ls -1dt '${RELEASES_DIR}'/* 2>/dev/null | tail -n +$((RELEASES_TO_KEEP + 1)) | xargs -r rm -rf --
  fi
"

echo "Local deploy completed."
