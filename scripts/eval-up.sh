#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

HTTPS_PORT="${EVAL_HTTPS_PORT:-8443}"
BASE_URL="https://localhost:$HTTPS_PORT"
CERT_DIR=".local/eval"
CERT_FILE="$CERT_DIR/caddy-root.crt"
CA_PATH="/data/caddy/pki/authorities/local/root.crt"
WAIT=120
INTERVAL=2

stage() { printf '\n==> [%s] %s\n' "$1" "$2"; }
fail()  { printf 'ERROR at stage "%s": %s\n' "$1" "$2" >&2; exit 1; }

compose() {
  APP_MODE=eval FRONTEND_BIND=127.0.0.1 \
  FRONTEND_HOST_PORT="$HTTPS_PORT" FRONTEND_CONTAINER_PORT=443 \
  docker compose "$@"
}

stage prerequisites "Docker, Compose, Make, curl"
for cmd in docker make curl; do
  command -v "$cmd" >/dev/null 2>&1 || fail prerequisites "$cmd is not installed"
done
docker compose version >/dev/null 2>&1 || fail prerequisites "Docker Compose is not available"
docker info >/dev/null 2>&1 || fail prerequisites "Docker is not running"

stage env "Preparing .env"
sh ./scripts/prepare-env.sh || fail env "could not prepare .env (see message above)"

stage build "Building frontend and backend images"
compose build frontend backend || fail build "image build failed"

stage postgres "Waiting for PostgreSQL"
compose up -d --wait --wait-timeout "$WAIT" postgres \
  || fail postgres "PostgreSQL not healthy within ${WAIT}s"

stage backend "Applying migrations and starting NestJS"
if ! compose up -d --wait --wait-timeout "$WAIT" backend; then
  compose logs --tail 30 backend >&2 || true
  fail backend "migration or backend startup failed (NestJS not ready within ${WAIT}s)"
fi

stage frontend "Starting Caddy"
compose up -d --wait --wait-timeout "$WAIT" frontend \
  || fail frontend "frontend container did not start"

stage certificate "Exporting Caddy's public root certificate"
mkdir -p "$CERT_DIR"
elapsed=0
until compose exec -T frontend test -s "$CA_PATH" >/dev/null 2>&1; do
  elapsed=$((elapsed + INTERVAL))
  [ "$elapsed" -lt "$WAIT" ] || fail certificate "Caddy root CA not created within ${WAIT}s"
  sleep "$INTERVAL"
done
compose exec -T frontend cat "$CA_PATH" > "$CERT_FILE.tmp" \
  && [ -s "$CERT_FILE.tmp" ] \
  || { rm -f "$CERT_FILE.tmp"; fail certificate "could not export root certificate"; }
mv "$CERT_FILE.tmp" "$CERT_FILE"

check_url() { # name url expected_body (empty = any body)
  name="$1"; url="$2"; expected="$3"; elapsed=0
  stage readiness "$name ($url)"
  body_file="$(mktemp)"
  while :; do
    code="$(curl --silent --show-error --cacert "$CERT_FILE" \
            -o "$body_file" -w '%{http_code}' "$url" 2>"$body_file.err" || true)"
    if [ "$code" = "200" ] &&