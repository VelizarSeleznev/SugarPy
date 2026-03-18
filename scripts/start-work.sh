#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "${ROOT_DIR}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required."
  exit 1
fi

SLUG="${1:-}"
if [[ -z "${SLUG}" ]]; then
  SLUG="work-$(date +%Y%m%d-%H%M%S)"
fi

SLUG=$(printf '%s' "${SLUG}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//')
if [[ -z "${SLUG}" ]]; then
  echo "Branch name slug is empty after normalization."
  exit 1
fi

BRANCH="codex/${SLUG}"
TARGET_BRANCH="${TARGET_BRANCH:-master}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash current changes before creating a new work branch."
  exit 1
fi

git fetch origin "${TARGET_BRANCH}"
git switch "${TARGET_BRANCH}"
git pull --ff-only origin "${TARGET_BRANCH}"

if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  if git merge-base --is-ancestor "${BRANCH}" "${TARGET_BRANCH}"; then
    git branch -D "${BRANCH}"
    git push origin --delete "${BRANCH}" >/dev/null 2>&1 || true
    git switch -c "${BRANCH}"
    echo "Recreated merged work branch from ${TARGET_BRANCH}: ${BRANCH}"
  else
    git switch "${BRANCH}"
  fi
elif git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  git fetch origin "${BRANCH}:${BRANCH}"
  if git merge-base --is-ancestor "${BRANCH}" "${TARGET_BRANCH}"; then
    git branch -D "${BRANCH}"
    git push origin --delete "${BRANCH}" >/dev/null 2>&1 || true
    git switch -c "${BRANCH}"
    echo "Recreated merged remote work branch from ${TARGET_BRANCH}: ${BRANCH}"
  else
    git switch "${BRANCH}"
  fi
else
  git switch -c "${BRANCH}"
fi

echo "Current branch: ${BRANCH}"
