#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
repo_root="$(pwd -P)"
demo_dir="$repo_root/examples/external-demo"
image="tokenscope-external-demo:eval"
container="tokenscope-external-demo"
owner_label="com.tokenscope.external-demo.checkout"
config_file="$demo_dir/.env"
ca_file="$repo_root/.local/eval/caddy-root.crt"

fail() { printf 'ERROR [demo]: %s\n' "$1" >&2; exit 1; }

action="${1:-}"
case "$action" in
  build|up|down|logs|test) ;;
  *) fail "Usage: sh scripts/demo.sh build|up|down|logs|test" ;;
esac

command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
docker info >/dev/null 2>&1 || fail "Docker is not running or this user cannot access it"

build() {
  docker build --target runtime -t "$image" "$demo_dir" \
    || fail "image build failed"
}

# Resolve an existing container before any operation which could stop/remove it.
# Never operate on a same-named container belonging to another checkout/user.
owned_container() {
  if ! docker container inspect "$container" >/dev/null 2>&1; then return 1; fi
  owner="$(docker container inspect --format "{{ index .Config.Labels \"$owner_label\" }}" "$container")" \
    || fail "could not inspect demo ownership"
  [ "$owner" = "$repo_root" ] \
    || fail "the demo container name is already used by another checkout; no container was changed"
}

case "$action" in
  build) build; exit 0 ;;
  test)
    docker build --target test -t tokenscope-external-demo:test "$demo_dir" \
      || fail "test image build failed"
    docker run --rm --init tokenscope-external-demo:test
    exit $?
    ;;
  down)
    if owned_container; then
      docker stop --time 10 "$container" >/dev/null || fail "could not stop demo"
      docker rm "$container" >/dev/null || fail "could not remove stopped demo"
      printf 'External demo stopped and removed. TokenScope and its data were not changed.\n'
    else
      printf 'No external demo container to stop.\n'
    fi
    exit 0
    ;;
  logs)
    owned_container || fail "no external demo container; run make demo-up first"
    exec docker logs --follow --tail 100 "$container"
    ;;
esac

# This launcher intentionally targets native Docker Engine inside the Ubuntu VM.
# Host networking keeps the localhost TLS hostname and loopback exposure intact.
[ "$(uname -s)" = "Linux" ] || fail "run demo-up inside the Ubuntu evaluation VM"
[ "$(docker info --format '{{.OSType}}')" = "linux" ] || fail "Linux containers are required"
case "$(docker info --format '{{json .SecurityOptions}}')" in
  *rootless*) fail "use the local system Docker Engine in Ubuntu; rootless host networking is not supported here" ;;
esac
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  endpoint="$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')"
elif [ -n "${DOCKER_HOST:-}" ]; then
  endpoint="$DOCKER_HOST"
else
  endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}')"
fi
case "$endpoint" in unix://*) ;; *) fail "use a local Ubuntu Docker socket, not a remote Docker context" ;; esac

if owned_container; then
  fail "demo container already exists; use make demo-down then make demo-up to restart with current configuration"
fi

[ -f "$config_file" ] && [ -s "$config_file" ] && [ -r "$config_file" ] \
  || fail "run make demo-config first (examples/external-demo/.env is missing or unreadable)"
[ -f "$ca_file" ] && [ -s "$ca_file" ] && [ -r "$ca_file" ] \
  || fail "run make eval-up first (public Caddy CA is missing or unreadable)"

if ! docker image inspect "$image" >/dev/null 2>&1; then build; fi

# Run with the caller's UID so private mode-600 configuration and CA exports
# are readable. Mount only those two files, never the repo, Docker socket or CA
# private keys. NODE_EXTRA_CA_CERTS must be set before the Node process starts.
set -- --init --network host --read-only \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,src=$config_file,dst=/run/demo.env,readonly" \
  --mount "type=bind,src=$ca_file,dst=/run/caddy-root.crt,readonly" \
  --env NODE_EXTRA_CA_CERTS=/run/caddy-root.crt \
  --env NODE_TLS_REJECT_UNAUTHORIZED=1

docker run --rm "$@" "$image" node --env-file=/run/demo.env src/evaluation-runtime.js preflight \
  || fail "preflight failed; the persistent demo container was not started"

docker run -d --name "$container" --label "$owner_label=$repo_root" \
  --restart=no "$@" "$image" >/dev/null \
  || fail "could not start the demo container"

deadline=$(( $(date +%s) + 60 ))
while :; do
  state="$(docker container inspect --format '{{.State.Status}} {{.State.Health.Status}}' "$container")" \
    || fail "demo container disappeared during startup"
  case "$state" in
    'running healthy') break ;;
    'running starting') ;;
    *) fail "demo did not become healthy; inspect make demo-logs, then make demo-down before retrying" ;;
  esac
  [ "$(date +%s)" -lt "$deadline" ] \
    || fail "demo readiness timed out; inspect make demo-logs"
  sleep 1
done

demo_url="$(docker exec "$container" node --env-file=/run/demo.env src/evaluation-runtime.js url)" \
  || fail "could not read the demo URL"
printf 'External demo is ready: %s\n' "$demo_url"
printf 'Open it in the Ubuntu browser. Stop only the demo: make demo-down\n'
