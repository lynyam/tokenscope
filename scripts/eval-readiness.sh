#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."

COMPOSE="docker compose --profile eval"
CERT_DIR=".local/eval"
CERT_FILE="$CERT_DIR/caddy-root.crt"
TIMEOUT_SECONDS=60
INTERVAL_SECONDS=2

if [ -n "${APP_ORIGIN:-}" ]; then
  HOST_URL="$APP_ORIGIN"
else
  HOST_PORT="$($COMPOSE port caddy 8443 | sed 's/.*://')"
  [ -n "$HOST_PORT" ] || { echo "Cannot find Caddy's published port" >&2; exit 1; }
  HOST_URL="https://localhost:$HOST_PORT"
fi

echo "Exporting Caddy's local root CA to $CERT_FILE..."
mkdir -p "$CERT_DIR"
TMP_FILE="$CERT_FILE.tmp"
if ! $COMPOSE exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$TMP_FILE" \
   || [ ! -s "$TMP_FILE" ]; then
  rm -f "$TMP_FILE"
  echo "Certificate export failed: Caddy's root CA is missing or empty." >&2
  exit 1
fi
mv "$TMP_FILE" "$CERT_FILE"

wait_for() {
  name="$1"; url="$2"; elapsed=0
  echo "Waiting for $name ($url)..."
  until err="$(curl --fail --silent --show-error --cacert "$CERT_FILE" -o /dev/null "$url" 2>&1)"; do
    elapsed=$((elapsed + INTERVAL_SECONDS))
    if [ "$elapsed" -ge "$TIMEOUT_SECONDS" ]; then
      echo "$name not ready after ${TIMEOUT_SECONDS}s: $err" >&2
      echo "Check: make eval-logs" >&2
      exit 1
    fi
    sleep "$INTERVAL_SECONDS"
  done
}

wait_for "backend health"  "$HOST_URL/api/v1/health"
wait_for "database health" "$HOST_URL/api/v1/health/db"
wait_for "frontend"        "$HOST_URL/"

echo "OK - reachable via HTTPS at $HOST_URL"
echo "Trust $CERT_FILE in your browser, or verify: curl --cacert $CERT_FILE $HOST_URL/api/v1/health"