#!/usr/bin/env bash
# Explicit live check; at most three provider requests. Never runs in CI.
set -euo pipefail
umask 077
cd "$(dirname "$0")/../../.."
for cmd in curl jq awk tee; do command -v "$cmd" >/dev/null || exit 1; done
: "${TOKEN:?Set a real user JWT}"
: "${ORG_ID:?Set the disposable organization ID}"
: "${PROJECT_ID:?Set the disposable project ID}"
BASE_URL="${BASE_URL:-http://localhost:5173}"
STOP_AFTER_SECONDS="${STOP_AFTER_SECONDS:-2}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
printf 'Authorization: Bearer %s\nContent-Type: application/json\nAccept: text/event-stream\n' "$TOKEN" > "$WORK/auth"
jq -cn \
  --arg q "${QUESTION:-Which model contributes most to the estimated cost?}" \
  --arg from "${FROM:-2026-10-01T00:00:00.000Z}" \
  --arg to "${TO:-2026-10-02T00:00:00.000Z}" \
  '{question:$q,from:$from,to:$to,filters:{}}' > "$WORK/request.json"
URL="$BASE_URL/api/v1/organizations/$ORG_ID/projects/$PROJECT_ID/assistant"

stamp() {
  while IFS= read -r line; do
    printf '%s  %s\n' "$(date +%H:%M:%S)" "$line"
  done
}

# curl's --max-time works on macOS too. CURL_CA_BUNDLE verifies eval TLS.
run_request() {
  local name="$1" max_time="$2"
  set +e
  curl -N -sS --connect-timeout 5 --max-time "$max_time" \
    -D "$WORK/$name.headers" -H @"$WORK/auth" \
    --data-binary @"$WORK/request.json" "$URL" \
    | tee "$WORK/$name.sse" | stamp
  local statuses=("${PIPESTATUS[@]}")
  set -e
  CURL_STATUS="${statuses[0]}"
  [ "${statuses[1]}" -eq 0 ] && [ "${statuses[2]}" -eq 0 ] || exit 1
  HTTP_STATUS=$(awk '/^HTTP\// {code=$2} END {print code}' "$WORK/$name.headers")
}

assert_complete() {
  local name="$1"
  [ "$CURL_STATUS" -eq 0 ] && [ "$HTTP_STATUS" = 200 ] || {
    echo "$name failed: curl=$CURL_STATUS HTTP=$HTTP_STATUS" >&2; exit 1;
  }
  [ "$(grep -c '^event: start$' "$WORK/$name.sse")" -eq 1 ] &&
  [ "$(grep -c '^event: done$' "$WORK/$name.sse")" -eq 1 ] &&
  grep -q '^event: delta$' "$WORK/$name.sse" &&
  ! grep -q '^event: error$' "$WORK/$name.sse" || {
    echo "$name did not produce a successful streamed answer." >&2; exit 1;
  }
}

echo '1. Full answer: observe progressive text and inspect the full context.'
run_request full 70
assert_complete full

echo '2. Stop an active answer.'
run_request stop "$STOP_AFTER_SECONDS"
# Cancellation can happen before headers or after SSE starts.
# Neither path should already contain a completed or failed answer.
if [ "$CURL_STATUS" -ne 28 ] ||
   grep -Eq '^event: (done|error)$' "$WORK/stop.sse"; then
  echo 'Cancellation was not demonstrated: the request ended differently.' >&2
  exit 1
fi

case "$HTTP_STATUS" in
  200)
    grep -q '^event: start$' "$WORK/stop.sse" || {
      echo 'Received HTTP 200 without the expected SSE start event.' >&2
      exit 1
    }
    echo 'Client cancelled after SSE started.'
    ;;
  ""|000)
    echo 'Client cancelled before response headers.'
    ;;
  *)
    echo "Unexpected HTTP status during cancellation: $HTTP_STATUS" >&2
    exit 1
    ;;
esac

echo '3. A new question must succeed after Stop.'
run_request after-stop 70
assert_complete after-stop
echo 'Full answers passed. Confirm outcome=client_left for the cancelled request in backend logs.'
echo 'Record mode, commit, model, account quota and progressive delivery separately.'
