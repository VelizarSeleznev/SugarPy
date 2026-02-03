#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Ensure uv exists for deterministic Python deps
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required but not installed. Install from https://astral.sh/uv"
  exit 1
fi

UV_PROJECT_ENVIRONMENT="$ROOT_DIR/.venv" uv sync --extra lab --frozen
source "$ROOT_DIR/.venv/bin/activate"

"$ROOT_DIR/scripts/sync-functions.sh"

python3 - <<'PY'
from sugarpy.chem import balance_equation
from sugarpy.library import load_catalog
from sugarpy.math_cell import render_math_cell
from sugarpy.stoichiometry import render_stoichiometry

print(balance_equation('H2 + O2 -> H2O'))
print(balance_equation('Fe + O2 -> Fe2O3'))
print(balance_equation('C3H8 + O2 -> CO2 + H2O'))
print([f.id for f in load_catalog()])
print(render_math_cell("2 + 2")["value"])
print(render_math_cell("x + 2")["value"])
print(render_math_cell("sin(30)", mode="deg")["value"])
print(render_stoichiometry("H2 + O2 -> H2O", {"H2": {"n": 2}})["balanced"])
print(render_stoichiometry("Fe + O2 -> Fe2O3", {"Fe": {"m": 10}})["balanced"])
PY

cd "$ROOT_DIR/web"

npm ci

npm run build
npm audit --audit-level=moderate || true

echo "Running UI console check..."
for i in {1..20}; do
  if ! lsof -i tcp:8888 -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done
"$ROOT_DIR/scripts/ui-check.sh"
