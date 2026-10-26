#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

if [ -z "${CONFIRM_DATABASE:-}" ]; then
  printf '%s\n' 'Provide CONFIRM_DATABASE explicitly, e.g. make eval-seed CONFIRM_DATABASE=tokenscope' >&2
  exit 1
fi

set -- --confirm-database "$CONFIRM_DATABASE"
if [ -n "${ANCHOR:-}" ]; then
  set -- "$@" --anchor "$ANCHOR"
fi

# exec never creates/replaces services or switches their running mode.
# Only the explicit seed process receives the opt-in.
# An exported password can override the container's .env value without placing
# its value in command arguments; otherwise use the running container's value.
if [ "${DEMO_PASSWORD+x}" = x ]; then
  docker compose exec -T -e EVALUATION_SEED_ENABLED=true -e DEMO_PASSWORD \
    backend npm run --silent eval:seed -- "$@"
else
  docker compose exec -T -e EVALUATION_SEED_ENABLED=true \
    backend npm run --silent eval:seed -- "$@"
fi
