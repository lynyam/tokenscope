#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."

COMPOSE="docker compose --profile eval"
fail() { echo "eval-up FAILED at stage '$1': $2" >&2; exit 1; }

echo "[1/5] env";       ./scripts/prepare-env.sh || fail env "could not prepare .env"
echo "[2/5] build";     $COMPOSE build backend-eval frontend-build || fail build "image build failed"
echo "[3/5] migrate";   $COMPOSE run --rm migrate || fail migrate "prisma migrate deploy failed"
echo "[4/5] start";     $COMPOSE up -d --wait --wait-timeout 180 caddy || fail start "services not healthy (see: make eval-logs)"
echo "[5/5] readiness"; ./scripts/eval-readiness.sh || fail readiness "stack not reachable over HTTPS"