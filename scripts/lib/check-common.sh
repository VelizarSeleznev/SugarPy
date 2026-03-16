#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DRY_RUN="${DRY_RUN:-0}"

print_cmd() {
  printf '+'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\n'
}

run_cmd() {
  print_cmd "$@"
  if [[ "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  "$@"
}

require_command() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "$hint" >&2
    exit 1
  fi
}

ensure_python_env() {
  require_command uv "uv is required but not installed. Install from https://astral.sh/uv"
  run_cmd env UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --extra test --frozen
  if [[ "$DRY_RUN" != "1" ]]; then
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.venv/bin/activate"
  fi
}

ensure_node_env() {
  require_command npm "npm is required but not installed."
  run_cmd bash -lc "cd '$ROOT_DIR/web' && npm ci"
}

sync_functions() {
  run_cmd "$ROOT_DIR/scripts/sync-functions.sh"
}

changed_files() {
  if [[ -n "${CHECK_CHANGED_FILES:-}" ]]; then
    printf '%s\n' "${CHECK_CHANGED_FILES}"
    return
  fi
  local untracked=""
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    untracked=$(git -C "$ROOT_DIR" ls-files --others --exclude-standard || true)
  fi
  if git -C "$ROOT_DIR" diff --name-only HEAD -- . >/dev/null 2>&1; then
    local diff_head
    diff_head=$(git -C "$ROOT_DIR" diff --name-only HEAD -- . || true)
    if [[ -n "$diff_head" ]]; then
      printf '%s\n' "$diff_head"
      if [[ -n "$untracked" ]]; then
        printf '%s\n' "$untracked"
      fi
      return
    fi
  fi
  if [[ -n "${CHECK_CHANGED_FROM:-}" ]]; then
    git -C "$ROOT_DIR" diff --name-only "${CHECK_CHANGED_FROM}"...HEAD -- .
    if [[ -n "$untracked" ]]; then
      printf '%s\n' "$untracked"
    fi
    return
  fi
  if git -C "$ROOT_DIR" rev-parse --verify HEAD^ >/dev/null 2>&1; then
    git -C "$ROOT_DIR" diff --name-only HEAD^..HEAD -- .
    if [[ -n "$untracked" ]]; then
      printf '%s\n' "$untracked"
    fi
  fi
}

has_runtime_critical_changes() {
  local changed
  changed=$(changed_files)
  if [[ -z "$changed" ]]; then
    return 1
  fi
  while IFS= read -r critical_path; do
    [[ -z "$critical_path" ]] && continue
    if printf '%s\n' "$changed" | grep -Fqx "$critical_path"; then
      return 0
    fi
  done < "$ROOT_DIR/scripts/runtime-critical-paths.txt"
  return 1
}

require_runtime_change_artifacts() {
  local changed
  changed=$(changed_files)
  [[ -z "$changed" ]] && return 0

  if ! printf '%s\n' "$changed" | grep -Eq '^(docs/(ARCHITECTURE|RUNBOOK|PRODUCT_GUIDE)\.md)$'; then
    echo "Runtime-critical changes require at least one matching docs update: docs/ARCHITECTURE.md, docs/RUNBOOK.md, or docs/PRODUCT_GUIDE.md." >&2
    exit 1
  fi
  if ! printf '%s\n' "$changed" | grep -Eq '^docs/verification/.+\.(md|ya?ml)$'; then
    echo "Runtime-critical changes require a verification manifest under docs/verification/." >&2
    exit 1
  fi
  if ! printf '%s\n' "$changed" | grep -Eq '^(tests/backend/|web/e2e/)'; then
    echo "Runtime-critical changes require at least one backend or browser regression test change." >&2
    exit 1
  fi
}
