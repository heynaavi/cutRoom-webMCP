#!/usr/bin/env bash
# Prove the tools really register and run, through document.modelContext.
# Needs a Chrome started by bin/try.sh (it opens the debug port).
set -e
cd "$(dirname "$0")/.."
curl -sf --max-time 2 http://127.0.0.1:9222/json/version >/dev/null \
  || { echo "No debuggable Chrome on :9222 — run bin/try.sh first."; exit 1; }
exec node scripts/test-webmcp.mjs "${1:-http://localhost:4321}"
