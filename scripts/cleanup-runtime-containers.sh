#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
STORAGE_ROOT="${SUGARPY_STORAGE_ROOT:-$HOME/.local/share/sugarpy/runtime}"
PREFIX="${SUGARPY_RUNTIME_CONTAINER_PREFIX:-sugarpy-rt}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to clean notebook runtime containers."
  exit 1
fi

RUNNING_IDS=$(docker ps -aq --filter "name=^${PREFIX}-" || true)
if [[ -n "${RUNNING_IDS}" ]]; then
  echo "Removing notebook runtime containers: ${RUNNING_IDS}"
  docker rm -f ${RUNNING_IDS}
else
  echo "No notebook runtime containers found."
fi

if [[ -d "${STORAGE_ROOT}/live-runtimes" ]]; then
  echo "Removing runtime metadata/workspaces under ${STORAGE_ROOT}/live-runtimes"
  rm -rf "${STORAGE_ROOT}/live-runtimes"
fi

echo "Notebook runtime cleanup completed."
