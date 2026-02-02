#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SRC="$ROOT_DIR/src/sugarpy/data/functions.json"
DEST="$ROOT_DIR/web/public/functions.json"

if [ ! -f "$SRC" ]; then
  echo "Missing source catalog: $SRC" >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"

if [ ! -f "$DEST" ] || ! cmp -s "$SRC" "$DEST"; then
  cp "$SRC" "$DEST"
fi
