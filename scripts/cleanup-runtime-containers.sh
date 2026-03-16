#!/usr/bin/env bash
set -euo pipefail

PREFIX="${SUGARPY_RUNTIME_CONTAINER_PREFIX:-sugarpy-rt-}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to clean notebook runtime containers."
  exit 1
fi

CONTAINERS=$(docker ps -a --format '{{.Names}}' | grep "^${PREFIX}" || true)

if [[ -z "${CONTAINERS}" ]]; then
  echo "No runtime containers found."
  exit 0
fi

printf '%s\n' "${CONTAINERS}" | xargs docker rm -f
COUNT=$(printf '%s\n' "${CONTAINERS}" | wc -l | tr -d ' ')
echo "Removed ${COUNT} runtime container(s)."
