#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT_DIR}"

BRANCH=$(git branch --show-current)
if [[ -z "${BRANCH}" ]]; then
  echo "Detached HEAD is not supported for checkpoints."
  exit 1
fi

if [[ "${BRANCH}" == "master" && "${ALLOW_MASTER_CHECKPOINT:-0}" != "1" ]]; then
  echo "Refusing to checkpoint directly on master. Start or switch to a work branch first."
  echo "Use: ./scripts/start-work.sh <name>"
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "Nothing to checkpoint."
  exit 0
fi

MESSAGE="${*:-checkpoint: ${BRANCH} $(date '+%Y-%m-%d %H:%M')}"

git add -A
git commit -m "${MESSAGE}"

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  git push -u origin "${BRANCH}"
fi

echo "Checkpoint pushed on ${BRANCH}"
