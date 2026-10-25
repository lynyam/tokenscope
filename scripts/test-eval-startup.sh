#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if command -v node >/dev/null 2>&1; then
  exec node --test scripts/eval-startup.test.cjs
fi
exec docker run --rm -v "$PWD:/repo:ro" -w /repo node:24-alpine \
  node --test scripts/eval-startup.test.cjs
