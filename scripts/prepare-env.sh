#!/bin/sh
set -eu

# Configuration and temporary copies must be private from creation.
umask 077
cd "$(dirname "$0")/.."

fail() {
  printf 'Configuration error: %s\n' "$1" >&2
  exit 1
}

env_tmp=""

cleanup() {
  if [ -n "$env_tmp" ]; then
    rm -f "$env_tmp"
  fi
}

trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -f .env ]; then
  [ -f .env.example ] || fail ".env.example is missing."
  cp .env.example .env
fi

chmod 600 .env

# Read the simple KEY=value settings used by this repository.
# Compose still resolves interpolation; backend validation remains authoritative.
get_env() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" .env |
    tail -n 1 | cut -d= -f2- | tr -d '\r' |
    sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
        -e 's/^"//' -e 's/"$//' \
        -e "s/^'//" -e "s/'$//"
}

check_integer() {
  if ! awk -v value="$2" -v maximum="$3" \
    'BEGIN {
      exit !(value ~ /^[0-9]+$/ && value + 0 >= 1 && value + 0 <= maximum)
    }'
  then
    fail "$1 must be an integer between 1 and $3."
  fi
}

for key in \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  DATABASE_URL \
  JWT_ISSUER \
  JWT_AUDIENCE
do
  [ -n "$(get_env "$key")" ] || fail "$key is missing or empty."
done

check_integer BACKEND_PORT "$(get_env BACKEND_PORT)" 65535
check_integer FRONTEND_PORT "$(get_env FRONTEND_PORT)" 65535
check_integer JWT_ACCESS_TTL_SECONDS \
  "$(get_env JWT_ACCESS_TTL_SECONDS)" 9007199254740991

# Never rotate a configured secret during ordinary startup.
if [ -n "$(get_env JWT_SECRET)" ]; then
  printf '.env preserved; backend validation will check the configured values.\n'
  exit 0
fi

command -v docker >/dev/null 2>&1 \
  || fail "Docker is required to generate JWT_SECRET."

docker info >/dev/null 2>&1 \
  || fail "Docker is not running."

secret="$(docker run --rm node:24-alpine node -e \
  "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"

case "$secret" in
  ''|*[!0-9a-f]*)
    fail "JWT_SECRET generation failed."
    ;;
esac

[ "${#secret}" -eq 64 ] || fail "JWT_SECRET generation failed."

# Use an ignored directory; never leave a secret-bearing .env.tmp in Git's view.
mkdir -p .local/eval
env_tmp="$(mktemp .local/eval/env.XXXXXX)"

if grep -qE '^[[:space:]]*JWT_SECRET[[:space:]]*=' .env; then
  sed \
    "s|^[[:space:]]*JWT_SECRET[[:space:]]*=.*|JWT_SECRET=$secret|" \
    .env > "$env_tmp"
else
  cat .env > "$env_tmp"

  # A separator is required even when the old file has no final newline.
  printf '\nJWT_SECRET=%s\n' "$secret" >> "$env_tmp"
fi

chmod 600 "$env_tmp"
mv "$env_tmp" .env
env_tmp=""

printf 'Generated the missing JWT_SECRET; other settings were preserved.\n'
