#!/bin/sh
set -eu

umask 077
cd "$(dirname "$0")/.."

HTTPS_PORT="${EVAL_HTTPS_PORT:-8443}"
BASE_URL="https://localhost:$HTTPS_PORT"
CERT_DIR=".local/eval"
CERT_FILE="$CERT_DIR/caddy-root.crt"
CA_PATH="/data/caddy/pki/authorities/local/root.crt"

WAIT=120
INTERVAL=2

stage() {
  printf '\n==> [%s] %s\n' "$1" "$2"
}

fail() {
  printf 'ERROR at stage "%s": %s\n' "$1" "$2" >&2
  exit 1
}

work_dir=""

cleanup() {
  if [ -n "$work_dir" ]; then
    rm -rf "$work_dir"
  fi
}

trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM

compose() {
  APP_MODE=eval FRONTEND_BIND=127.0.0.1 \
  CADDY_DATA_VOLUME=tokenscope_caddy_data \
  FRONTEND_HOST_PORT="$HTTPS_PORT" FRONTEND_CONTAINER_PORT=443 \
  docker compose "$@"
}

stage prerequisites "Docker, Compose, Make, curl, OpenSSL"

for cmd in docker make curl openssl; do
  command -v "$cmd" >/dev/null 2>&1 \
    || fail prerequisites "$cmd is not installed"
done

docker compose version >/dev/null 2>&1 \
  || fail prerequisites "Docker Compose is unavailable"

docker info >/dev/null 2>&1 \
  || fail prerequisites "Docker is not running"

if ! awk -v port="$HTTPS_PORT" \
  'BEGIN {
    exit !(port ~ /^[0-9]+$/ && port + 0 >= 1 && port + 0 <= 65535)
  }'
then
  fail env "EVAL_HTTPS_PORT must be an integer between 1 and 65535"
fi

stage env "Preparing .env"

sh ./scripts/prepare-env.sh \
  || fail env "could not prepare .env"

# Validate the Compose configuration without printing its resolved secrets.
compose config --quiet \
  || fail env "invalid Compose configuration"

mkdir -p "$CERT_DIR"
work_dir="$(mktemp -d "$CERT_DIR/startup.XXXXXX")"

stage build "Building frontend and backend images"

compose build frontend backend \
  || fail build "image build failed"

stage postgres "Waiting for PostgreSQL"

compose up -d --wait --wait-timeout "$WAIT" postgres \
  || fail postgres "PostgreSQL did not become healthy"

stage backend "Applying migrations and starting NestJS"

if ! compose up -d --no-deps --wait --wait-timeout "$WAIT" backend; then
  compose logs --tail 30 backend >&2 || true
  fail backend "migration or backend startup failed; inspect the backend logs"
fi

stage frontend "Starting Caddy"

compose up -d --no-deps --wait --wait-timeout "$WAIT" frontend \
  || fail frontend "frontend container did not start"

stage certificate "Exporting Caddy's public root certificate"

# Caddy may still be generating its CA after the container starts.
# Wait for a readable, nonempty public certificate, with a bounded wait.
if ! compose exec -T frontend timeout "$WAIT" sh -c \
  'until [ -r "$1" ] && [ -s "$1" ]; do sleep 1; done' \
  sh "$CA_PATH"
then
  fail certificate "Caddy's public CA was not available within ${WAIT}s"
fi

# Copy into the temporary directory first. A failed copy must not replace
# the previously exported certificate.
if ! compose cp "frontend:$CA_PATH" "$work_dir/root.crt"; then
  fail certificate "could not copy Caddy's public CA to the host"
fi

[ -s "$work_dir/root.crt" ] \
  || fail certificate "copied certificate is empty"

# Check that the copied file is a parseable PEM certificate.
# The HTTPS readiness checks below verify it against the running server.
if ! openssl x509 -inform PEM -in "$work_dir/root.crt" -noout \
  >/dev/null 2>&1
then
  fail certificate "copied file is not a valid PEM certificate"
fi

chmod 600 "$work_dir/root.crt"

# Replace the destination only after successful copy and validation.
mv "$work_dir/root.crt" "$CERT_FILE"

printf 'Public CA exported to %s\n' "$CERT_FILE"

check_url() {
  check_name="$1"
  check_url_value="$2"
  expected="$3"

  deadline=$(( $(date +%s) + WAIT ))
  http_code="none"

  stage readiness "$check_name ($check_url_value)"

  while :; do
    remaining=$(( deadline - $(date +%s) ))

    [ "$remaining" -gt 0 ] \
      || fail readiness \
        "$check_name timed out after ${WAIT}s (last HTTP $http_code)"

    attempt_timeout=10
    [ "$remaining" -ge "$attempt_timeout" ] \
      || attempt_timeout="$remaining"

    # Count request time as part of the deadline, not only the sleeps.
    if http_code="$(curl --silent --show-error \
      --connect-timeout 3 --max-time "$attempt_timeout" \
      --cacert "$CERT_FILE" \
      -o "$work_dir/body" -w '%{http_code}' \
      "$check_url_value" 2>"$work_dir/curl-error")"
    then
      if [ "$http_code" = "200" ]; then
        if [ "$expected" = "html" ]; then
          if grep -qi '<!doctype html' "$work_dir/body"; then
            return 0
          fi
        elif [ "$(cat "$work_dir/body")" = "$expected" ]; then
          return 0
        fi
      fi
    fi

    remaining=$(( deadline - $(date +%s) ))
    [ "$remaining" -gt 0 ] || continue

    pause_seconds="$INTERVAL"
    [ "$remaining" -ge "$pause_seconds" ] \
      || pause_seconds="$remaining"

    sleep "$pause_seconds"
  done
}

check_url \
  "database health" \
  "$BASE_URL/api/v1/health/db" \
  '{"status":"healthy"}'

check_url "frontend" "$BASE_URL/" html

printf '\nTokenScope is running: %s\n' "$BASE_URL"
printf 'Trust the public CA once: %s\n' "$CERT_FILE"
printf 'See docs/LOCAL_DEVELOPMENT.md for browser trust instructions.\n'
printf 'Commands: make ps | make logs | make stop | make clean\n'
