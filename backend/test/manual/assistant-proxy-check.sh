#!/usr/bin/env bash
# backend/test/manual/assistant-proxy-check.sh
# Opt-in LIVE check of the dashboard assistant through a proxy.
# It calls the real Gemini model: 3 requests = 3 requests of your free quota.
#
# What it shows:
#   1. a full answer: every SSE line with the time it arrived (progressive text?)
#   2. Stop: the client leaves after 2 seconds
#   3. an immediate new question gets 200 (the Stop freed the slot, no 429)
#
# Usage (from the repository root):
#   read -rs TOKEN && export TOKEN          # a JWT from POST /api/v1/auth/signin
#   export ORG_ID=... PROJECT_ID=...        # a project with the golden traces
#   BASE_URL=http://localhost:5173 backend/test/manual/assistant-proxy-check.sh    # dev (Vite)
#   BASE_URL=https://localhost:8443 backend/test/manual/assistant-proxy-check.sh   # evaluation (Caddy)
#
# The token is never printed (only its length).
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"
FROM="${FROM:-2026-10-01T00:00:00.000Z}"
TO="${TO:-2026-10-02T00:00:00.000Z}"
QUESTION="${QUESTION:-Which model contributes most to the estimated cost?}"

for name in TOKEN ORG_ID PROJECT_ID; do
  if [ -z "${!name:-}" ]; then
    echo "Set $name first." >&2
    exit 1
  fi
done

URL="$BASE_URL/api/v1/organizations/$ORG_ID/projects/$PROJECT_ID/assistant"
BODY=$(jq -cn --arg q "$QUESTION" --arg from "$FROM" --arg to "$TO" \
  '{question: $q, from: $from, to: $to, filters: {}}')

# Keep the token out of the command line and the terminal.
HEADERS=$(mktemp)
chmod 600 "$HEADERS"
trap 'rm -f "$HEADERS"' EXIT
printf 'Authorization: Bearer %s\nContent-Type: application/json\nAccept: text/event-stream\n' "$TOKEN" > "$HEADERS"

# Prints each line with the time it arrived.
stamp() {
  while IFS= read -r line; do
    printf '%s  %s\n' "$(date +%H:%M:%S.%3N)" "${line:0:300}"
  done
}

echo "Target: $URL (token length: ${#TOKEN})"
echo
echo "=== 1. Full answer (lines should arrive over time, not all at once) ==="
curl -N -sS -i -X POST "$URL" -H @"$HEADERS" --data "$BODY" | stamp
echo
echo "=== 2. Stop after 2 seconds (client disconnects) ==="
timeout 2 curl -N -sS -X POST "$URL" -H @"$HEADERS" --data "$BODY" | stamp
echo "    client stopped at $(date +%H:%M:%S.%3N)"
echo
echo "=== 3. Immediate new question: expect HTTP 200, not 429 ASSISTANT_ALREADY_RUNNING ==="
STATUS=$(timeout 30 curl -N -sS -o /dev/null -w '%{http_code}' -X POST "$URL" -H @"$HEADERS" --data "$BODY")
echo "    HTTP $STATUS"
echo
echo "Check the backend log for the Stop: an assistant_answer line with outcome \"client_left\":"
echo "    docker compose logs backend | grep assistant_answer | tail -3"
