#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT_DIR}"

SOURCE_BRANCH=$(git branch --show-current)
TARGET_BRANCH="${TARGET_BRANCH:-master}"

if [[ -z "${SOURCE_BRANCH}" ]]; then
  echo "Detached HEAD is not supported for release."
  exit 1
fi

if [[ "${SOURCE_BRANCH}" == "${TARGET_BRANCH}" ]]; then
  echo "Release must start from a work branch, not ${TARGET_BRANCH}."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Create a checkpoint before release."
  exit 1
fi

if [[ "${SKIP_TESTS:-0}" != "1" ]]; then
  ./scripts/test-all.sh
fi

git fetch origin "${TARGET_BRANCH}"
git push -u origin "${SOURCE_BRANCH}" >/dev/null 2>&1 || git push origin "${SOURCE_BRANCH}"
git switch "${TARGET_BRANCH}"
git pull --ff-only origin "${TARGET_BRANCH}"
git merge --no-ff "${SOURCE_BRANCH}" -m "release: ${SOURCE_BRANCH}"
git push origin "${TARGET_BRANCH}"

if [[ "${KEEP_WORK_BRANCH:-0}" != "1" && "${SOURCE_BRANCH}" == codex/* ]]; then
  git branch -d "${SOURCE_BRANCH}"
  git push origin --delete "${SOURCE_BRANCH}" >/dev/null 2>&1 || true
  echo "Release pushed via ${TARGET_BRANCH}. Cleaned up ${SOURCE_BRANCH} and left repo on ${TARGET_BRANCH}."
else
  echo "Release pushed via ${TARGET_BRANCH}. Left repo on ${TARGET_BRANCH}."
fi
