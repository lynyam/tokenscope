#!/usr/bin/env bash
# test/manual/auth-smoke-test.sh
# Manual/integration smoke test for authentication (M1).
# Usage: ./test/manual/auth-smoke-test.sh (requires a running stack)
set -uo pipefail
# Note: not using `set -e` here on purpose — checks below are expected to
# sometimes fail (e.g. a non-2xx response), and we want to keep running
# and report ALL results rather than abort on the first failure.

BASE="http://localhost:5173/api/v1"
EMAIL="smoke-$(date +%s)@example.com"
PASSWORD="Smoke-test-password-2026"

FAILURES=0

# check <description> <expected> <actual>
# Prints OK/FAIL plus the expected and actual value for every assertion,
# and increments FAILURES on mismatch instead of exiting the script.
check() {
  local description="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  OK:   $description"
  else
    echo "  FAIL: $description"
    FAILURES=$((FAILURES + 1))
  fi
  echo "        expected: $expected"
  echo "        actual:   $actual"
}

# --------------------------------------------------------------------------
# Acceptance criterion: "User can sign up."
# --------------------------------------------------------------------------
echo "1) Sign up..."
SIGNUP=$(curl -fsS -X POST "$BASE/auth/signup" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Smoke\"}")

HAS_TOKEN_AND_USER=$(echo "$SIGNUP" | jq -e '(.accessToken != null) and (.user.id != null)' 2>/dev/null)
check "signup returns accessToken + user.id" "true" "${HAS_TOKEN_AND_USER:-false}"

TOKEN=$(echo "$SIGNUP" | jq -r '.accessToken')

# --------------------------------------------------------------------------
# Acceptance criterion: "Duplicate normalized email returns 409 EMAIL_ALREADY_EXISTS."
# --------------------------------------------------------------------------
echo "2) Duplicate signup rejected..."
DUP_STATUS=$(curl -s -o /tmp/dup.json -w '%{http_code}' -X POST "$BASE/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Smoke\"}")
DUP_CODE=$(jq -r '.code // "MISSING"' /tmp/dup.json)

check "duplicate signup status" "409" "$DUP_STATUS"
check "duplicate signup error code" "EMAIL_ALREADY_EXISTS" "$DUP_CODE"

# --------------------------------------------------------------------------
# Acceptance criterion: "User can sign in."
# --------------------------------------------------------------------------
echo "3) Sign in..."
SIGNIN=$(curl -fsS -X POST "$BASE/auth/signin" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

HAS_SIGNIN_TOKEN=$(echo "$SIGNIN" | jq -e '.accessToken != null' 2>/dev/null)
check "sign-in returns accessToken" "true" "${HAS_SIGNIN_TOKEN:-false}"

# --------------------------------------------------------------------------
# Acceptance criterion: "Unknown email and wrong password produce identical
# 401 responses." (this step covers the wrong-password half; see also
# API acceptance flow in DEMO.md for the unknown-email half, same code path)
# --------------------------------------------------------------------------
echo "4) Wrong password rejected..."
WRONG_STATUS=$(curl -s -o /tmp/wrong.json -w '%{http_code}' -X POST "$BASE/auth/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"not-the-password\"}")
WRONG_CODE=$(jq -r '.code // "MISSING"' /tmp/wrong.json)

check "wrong password status" "401" "$WRONG_STATUS"
check "wrong password error code" "INVALID_CREDENTIALS" "$WRONG_CODE"

# --------------------------------------------------------------------------
# Acceptance criterion: "/auth/me returns current safe user."
# --------------------------------------------------------------------------
echo "5) /auth/me with token..."
ME=$(curl -fsS "$BASE/auth/me" -H "Authorization: Bearer $TOKEN")
ME_EMAIL=$(echo "$ME" | jq -r '.email // "MISSING"')

check "/auth/me returns correct email" "$EMAIL" "$ME_EMAIL"

# --------------------------------------------------------------------------
# Acceptance criterion: "Anonymous user cannot call protected endpoints."
# --------------------------------------------------------------------------
echo "6) /auth/me without token rejected..."
ANON_STATUS=$(curl -s -o /tmp/anon.json -w '%{http_code}' "$BASE/auth/me")
ANON_CODE=$(jq -r '.code // "MISSING"' /tmp/anon.json)

check "anonymous /auth/me status" "401" "$ANON_STATUS"
check "anonymous /auth/me error code" "AUTHENTICATION_REQUIRED" "$ANON_CODE"

# --------------------------------------------------------------------------
# Acceptance criterion: implicit safety check across signup/signin/me —
# "Passwords are stored as Argon2id hashes" (never returned to the client)
# and general "never includes passwordHash in the response" requirement.
# --------------------------------------------------------------------------
echo "7) No passwordHash leaked anywhere..."
if echo "$SIGNUP$SIGNIN$ME" | grep -qi 'passwordhash'; then
  LEAK_FOUND="true"
else
  LEAK_FOUND="false"
fi
check "no passwordHash leaked in any response" "false" "$LEAK_FOUND"

# --------------------------------------------------------------------------
echo
if [ "$FAILURES" -eq 0 ]; then
  echo "All authentication smoke checks passed."
  exit 0
else
  echo "$FAILURES check(s) FAILED — see above."
  exit 1
fi