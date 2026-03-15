#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE_TAG="${SUGARPY_NOTEBOOK_RUNTIME_IMAGE:-sugarpy-runtime:latest}"
DOCKERFILE_PATH="${SUGARPY_NOTEBOOK_RUNTIME_DOCKERFILE:-$ROOT_DIR/deploy/runtime/Dockerfile}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to build the notebook runtime image."
  exit 1
fi

echo "Building notebook runtime image: ${IMAGE_TAG}"
docker build \
  -f "${DOCKERFILE_PATH}" \
  -t "${IMAGE_TAG}" \
  "${ROOT_DIR}"

echo "Notebook runtime image is ready: ${IMAGE_TAG}"
