#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  exec node --test scripts/demo-startup.test.cjs
fi
# The interactive-config test also exercises the existing Bash helper.
exec docker run --rm -v "$PWD:/repo:ro" -w /repo node:24-bookworm-slim \
  node --test scripts/demo-startup.test.cjs
