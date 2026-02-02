#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if [ ! -d "$ROOT_DIR/.venv" ]; then
  python -m venv "$ROOT_DIR/.venv"
fi

source "$ROOT_DIR/.venv/bin/activate"

pip install -U pip
pip install -e "$ROOT_DIR[lab]"

"$ROOT_DIR/scripts/sync-functions.sh"

python - <<'PY'
from sugarpy.chem import balance_equation
from sugarpy.library import load_catalog
from sugarpy.math_cell import render_math_cell

print(balance_equation('H2 + O2 -> H2O'))
print(balance_equation('Fe + O2 -> Fe2O3'))
print(balance_equation('C3H8 + O2 -> CO2 + H2O'))
print([f.id for f in load_catalog()])
print(render_math_cell("2 + 2")["value"])
print(render_math_cell("x + 2")["value"])
print(render_math_cell("sin(30)", mode="deg")["value"])
PY

cd "$ROOT_DIR/web"

if [ ! -d node_modules ]; then
  npm install
fi

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
