#!/usr/bin/env sh
set -eu

HOST_URL="${APP_ORIGIN:-https://localhost:8443}"
CERT_FILE="caddy-root.crt"
TIMEOUT_SECONDS=60
INTERVAL_SECONDS=2
ELAPSED=0

echo "Exporting Caddy's local root CA..."
docker compose -p tokenscope-eval -f compose.eval.yaml exec -T caddy \
  cat /data/caddy/pki/authorities/local/root.crt > "$CERT_FILE"

echo "Waiting for $HOST_URL/api/v1/health through Caddy..."
until curl --fail --silent --cacert "$CERT_FILE" "$HOST_URL/api/v1/health" > /dev/null; do
  ELAPSED=$((ELAPSED + INTERVAL_SECONDS))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Backend health check failed through Caddy within ${TIMEOUT_SECONDS}s." >&2
    echo "Check: docker compose -p tokenscope-eval -f compose.eval.yaml logs caddy backend" >&2
    exit 1
  fi
  sleep "$INTERVAL_SECONDS"
done

echo "Waiting for frontend through Caddy..."
until curl --fail --silent --cacert "$CERT_FILE" "$HOST_URL/" > /dev/null; do
  ELAPSED=$((ELAPSED + INTERVAL_SECONDS))
  if [ "$ELAPSED" -ge "$TIMEOUT_SECONDS" ]; then
    echo "Frontend not reachable through Caddy within ${TIMEOUT_SECONDS}s." >&2
    exit 1
  fi
  sleep "$INTERVAL_SECONDS"
done

echo "OK — reachable via HTTPS at $HOST_URL"
echo "Trust $CERT_FILE in your browser, or verify manually: curl --cacert $CERT_FILE $HOST_URL/api/v1/health"