#!/usr/bin/env bash
# backend/test/manual/load-assistant-fixture.sh
# Loads the 6 golden traces (fixtures/evaluation/traces-golden.json) into an
# EXISTING disposable project, through the public trace API.
#
# Before: load the synthetic price catalogue (docs/LOCAL_DEVELOPMENT.md,
# "Explicit price catalogue loading") and create a project API key.
#
# Usage (from the repository root):
#   read -rs API_KEY && export API_KEY
#   BASE_URL=http://localhost:5173 backend/test/manual/load-assistant-fixture.sh
#
# Repeatable: the same externalIds are replayed safely (no duplicates).
# The key is never printed.
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5173}"
FIXTURE="${FIXTURE:-fixtures/evaluation/traces-golden.json}"

if [ -z "${API_KEY:-}" ]; then
  echo "Set API_KEY (a project API key of a DISPOSABLE project)." >&2
  exit 1
fi

# Keep the key out of the command line and the terminal.
HEADERS=$(mktemp)
chmod 600 "$HEADERS"
trap 'rm -f "$HEADERS"' EXIT
printf 'X-API-Key: %s\nContent-Type: application/json\n' "$API_KEY" > "$HEADERS"

COUNT=$(jq 'length' "$FIXTURE")
echo "Loading $COUNT golden traces into the project of this key (key length: ${#API_KEY})"

for index in $(seq 0 $((COUNT - 1))); do
  BODY=$(jq -c ".[$index].body" "$FIXTURE")
  EXTERNAL_ID=$(jq -r ".[$index].body.externalId" "$FIXTURE")
  STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/v1/public/traces" \
    -H @"$HEADERS" --data "$BODY")
  echo "  $EXTERNAL_ID -> HTTP $STATUS"
done

echo "Done. Ask the assistant with from=2026-10-01T00:00:00.000Z and to=2026-10-02T00:00:00.000Z."
