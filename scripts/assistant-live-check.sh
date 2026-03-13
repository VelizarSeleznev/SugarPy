#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../web"
ASSISTANT_LIVE=1 npx playwright test e2e/assistant.live.spec.ts "$@"
