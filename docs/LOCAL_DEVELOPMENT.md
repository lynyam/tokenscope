# Local Development

This document explains how to run TokenScope locally and how the development environment is structured.

## Requirements

Install:

* Docker
* Docker Compose
* Make
* Git

Node.js does not need to be installed on the host because frontend and backend run inside Docker containers.

---

## First setup

Clone the repository:

```bash
git clone git@github.com:lynyam/tokenscope.git
cd tokenscope
```

Create the local environment file:

```bash
cp .env.example .env
```
Generate a local JWT signing secret:

```bash
docker run --rm node:24-alpine \
  node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```
Copy the generated value into:
JWT_SECRET=<generated-value>
in your local .env. Never commit .env.

Start the application:

```bash
make up
make db-setup
```

The frontend is available at:

```text
http://localhost:5173
```
Backend endpoints are exposed to the browser through the Vite proxy under:
```bash
/api/v1
```

---

## Local architecture

The development environment contains three services:

```text
Browser
   |
   v
localhost:5173
   |
   v
Frontend
Vite + React
   |
   | /api/*
   v
Backend
NestJS
   |
   v
PostgreSQL
```

Docker Compose creates the internal network used by the services.

Inside this network:

```text
frontend → backend:3000
backend  → postgres:5432
```

The backend and PostgreSQL services are not directly published to the host.

The browser communicates with the backend through the Vite development proxy.

---

## Development containers

### Frontend

The frontend uses:

```text
node:24-alpine
```

The local `frontend/` directory is bind-mounted into:

```text
/app
```

Dependencies are stored in a dedicated Docker volume mounted at:

```text
/app/node_modules
```

At container startup:

```text
npm ci
npm run dev
```

Vite watches the source files and updates the development application when frontend code changes.

---

### Backend

The backend also uses:

```text
node:24-alpine
```

The local `backend/` directory is bind-mounted into:

```text
/app
```

Dependencies are stored in a dedicated Docker volume mounted at:

```text
/app/node_modules
```

At container startup:

```text
npm ci
npm run dev
```

The backend development command runs NestJS in watch mode.

When backend source code changes, Nest recompiles and restarts the application automatically.

---

### PostgreSQL

PostgreSQL uses:

```text
postgres:16-alpine
```

Database data is stored in a named Docker volume so that local data survives normal container restarts.

PostgreSQL also exposes a health check.

The backend waits for PostgreSQL to become healthy before starting.

---

## Environment variables

`.env.example` is the committed environment template.

It is committed to Git and must not contain secrets.

Each developer creates the local environment from it:

```bash
cp .env.example .env
```

`.env` is ignored by Git and may contain local secrets.

Current development variables include:

| Variable                 | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `POSTGRES_USER`          | Local PostgreSQL user                                |
| `POSTGRES_PASSWORD`      | Local PostgreSQL password                            |
| `POSTGRES_DB`            | Local PostgreSQL database                            |
| `DATABASE_URL`           | Prisma/PostgreSQL connection URL                     |
| `FRONTEND_PORT`          | Host port for Vite                                   |
| `BACKEND_PORT`           | NestJS listening port inside the development network |
| `JWT_SECRET`             | Local JWT signing secret; must be generated locally  |
| `JWT_ISSUER`             | Expected JWT issuer                                  |
| `JWT_AUDIENCE`           | Expected JWT audience                                |
| `JWT_ACCESS_TTL_SECONDS` | Access-token lifetime in seconds                     |

The backend validates its required configuration before startup.

The required backend values are:
```text
BACKEND_PORT
DATABASE_URL
JWT_SECRET
JWT_ISSUER
JWT_AUDIENCE
JWT_ACCESS_TTL_SECONDS
```
Invalid configuration causes startup to fail rather than allowing the
application to run with unsafe defaults.

Docker Compose loads the root .env and explicitly passes the required backend
configuration into the backend container.

Real secrets must never be committed.

---

## Common commands

### Start

```bash
make up
```

create containers and Starts the local stack in the background.

---

### Stop

```bash
make stop
```

Stops the containers without deleting them or their volumes.

---

### Logs

```bash
make logs
```

Follows logs from the Docker Compose services.

---

### Backend shell

```bash
make shell
```

Opens a shell inside the backend container.

---

### DB/Prisma

```bash
make db-setup
```

Generate prisma cient code source + migrate data model (sql) + seed

---

### PostgreSQL shell

```bash
make db-shell
```

Opens a PostgreSQL shell connected to the local TokenScope database.

---

### Clean

```bash
make clean
```

Removes the Compose containers and network.

Named volumes are preserved.

Local PostgreSQL data therefore remains available.

---

### Full clean

```bash
make fullclean
```

Removes containers, networks, and named volumes.

**Warning:** this deletes the local PostgreSQL database and the frontend/backend `node_modules` volumes.

Use it only when a complete local reset is required.

---

## Verify the environment

After:

```bash
make start
```

verify that the services are running:

```bash
docker compose ps
```

Then open:

```text
http://localhost:5173
```

Verify that:

1. The frontend loads.
2. The health-check action can call `/api/health/db`.
3. The backend responds successfully.
4. The backend can communicate with PostgreSQL.

For problems, inspect:

```bash
make logs
```

---

## Type checking and builds

### Frontend

From `frontend/`:

```bash
npm run check
npm run test
npm run build
```

`check` runs TypeScript validation without producing JavaScript output.

`build` creates the frontend production assets with Vite.

`test` runs the frontend HTTP-client, auth-invalidation, membership-adapter,
and membership-page tests with Vitest. The shared test setup uses jsdom and
Testing Library to exercise React interactions. These are development-only
dependencies: Vitest runs assertions, jsdom supplies browser APIs, and Testing
Library exercises controls and accessible output. They do not replace the
real backend/two-browser acceptance flow in `DEMO.md`.

The frontend suite covers the shared HTTP client, authentication adapter and
context, authentication forms, organization adapter and screens, and
membership adapter and screens. Tests live under frontend/test/ and exercise
the API adapters with network responses stubbed at fetch.
`test/setup.ts` registers DOM assertions and cleans up React, mocks,
and browser storage after each test. `vite.config.js` discovers only
`test/**/*.test.{ts,tsx}` and loads that setup file; `tsconfig.json` includes
both `src` and `test` so `npm run check` validates test code too. Tests import
application code through the existing `@/` alias and import Vitest APIs
explicitly; no additional test aliases or global Vitest types are needed.

The test workers disable Node's native Web Storage through
`execArgv: ['--no-experimental-webstorage']` in the Vite test configuration.
Vitest 4 can otherwise retain Node's `localStorage` instead of jsdom's, causing
storage-method errors or an invalid `--localstorage-file` error before test
assertions run. The flag lets jsdom provide isolated browser storage; no
disk-backed storage file or custom storage mock is needed. Local checks use
Node 24, matching the development containers.

While implementing the shared foundation before the membership adapter and
page, install only its two test files and run this checkpoint from `frontend/`:

```bash
npm run test -- test/api/http-client.test.ts test/context/AuthContext.test.tsx
```

Add `test/api/memberships.api.test.ts` and
`test/pages/organizations/MembersPage.test.tsx` once their production code is
implemented, then run the full suite above.

The TSE-61 shared-client usage and remaining adapter responsibilities are
documented in `SPRINT_1_ARCHITECTURE.md` under "Frontend integration reference".

---

### Backend

From `backend/`:

```bash
npm run check
npm run build
```

`check` validates TypeScript without generating output.

`build` compiles the backend TypeScript source into JavaScript.

---

## Development workflow

Once the local environment works, follow:

```text
docs/REPOSITORY_WORKFLOW.md
```

for branch naming, commits, Pull Requests, reviews, and merge rules.

For general project context and team onboarding, see:

```text
docs/ONBOARDING.md
```

For system architecture, see:

```text
docs/ARCHITECTURE.md
```
## Evaluation mode (HTTPS)

TokenScope runs in two modes from the same `compose.yaml`, the same `.env`
and the same PostgreSQL service and volume.

| | Development: `make up` | Evaluation: `make eval-up` |
|---|---|---|
| frontend | Vite dev server (hot reload) | Caddy serving the production build |
| backend | NestJS in watch mode | Compiled NestJS, migrations applied at startup |
| Address | `http://localhost:${FRONTEND_PORT}` | `https://localhost:8443` |
| Source changes | Hot reload | Rebuild with `make eval-up` |

Only the `frontend` container publishes a host port in evaluation mode
(`127.0.0.1:8443`). The backend and PostgreSQL stay on the Docker network.

### Start

```sh
make eval-up
```

The command checks prerequisites (Docker, Docker Compose, Make, curl), prepares
`.env` (creating it from `.env.example` and generating `JWT_SECRET` only if it
is missing or empty), builds the images, starts PostgreSQL and the backend
(which applies `prisma migrate deploy` before NestJS starts), starts the
frontend, exports Caddy's public root certificate to `.local/eval/caddy-root.crt`
and verifies `https://localhost:8443/api/v1/health/db` with that certificate.
Each stage has a 120 s limit and a failure names the stage that failed.

Running it again keeps your data and succeeds when no migration is pending.

### Trust the local certificate (once)

Caddy signs `localhost` with its own local CA. Importing the public root
certificate is a manual, one-time step. The CA private key stays inside the
`tokenscope_caddy_data` Docker volume.

**macOS** (Safari and Chrome use the system keychain):

```sh
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain .local/eval/caddy-root.crt
```

**Linux, system store** (curl and most CLI tools):

```sh
# Debian / Ubuntu
sudo cp .local/eval/caddy-root.crt /usr/local/share/ca-certificates/tokenscope-caddy-root.crt
sudo update-ca-certificates

# Fedora
sudo cp .local/eval/caddy-root.crt /etc/pki/ca-trust/source/anchors/tokenscope-caddy-root.crt
sudo update-ca-trust
```

**Chrome / Chromium on Linux** use their own store:

```sh
sudo apt install libnss3-tools   # or: sudo dnf install nss-tools
certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n tokenscope-caddy \
  -i .local/eval/caddy-root.crt
```

**Firefox** (all systems): Settings → Privacy & Security → Certificates →
View Certificates → Authorities → Import, select `.local/eval/caddy-root.crt`
and tick "Trust this CA to identify websites".

Restart the browser, then open `https://localhost:8443` without a warning.
Verify from a terminal without disabling verification:

```sh
curl --fail --show-error --cacert .local/eval/caddy-root.crt \
  https://localhost:8443/api/v1/health/db
# {"status":"healthy"}
```

### Switching modes and rebuilding

- `make up` returns to development: the `frontend` and `backend` containers
  are replaced, the database and its data are the same.
- After changing code in evaluation mode, run `make eval-up` again to rebuild.

### Logs, status and shutdown

```sh
make logs    # follow logs of the running mode
make ps      # service status
make stop    # stop containers, keep everything
make clean   # remove containers and network, keep named volumes
```

`make fullclean` also deletes volumes, including the database and the Caddy
CA. After it you must import the new certificate again.

### Common startup failures

| Message | Cause and fix |
|---|---|
| `ERROR at stage "prerequisites"` | Install the missing tool, or start Docker. |
| `ERROR at stage "env"` | A required value in `.env` is missing or invalid; the message names the key. Existing values are never overwritten. |
| `ERROR at stage "build"` | Image build failed; read the build output above the message. |
| `ERROR at stage "backend"` | Migration failed or NestJS did not become healthy; the last backend logs are printed. NestJS does not start if a migration fails. |
| `ERROR at stage "certificate"` | Caddy did not create its root CA; check `make logs`. |
| `ERROR at stage "readiness"` | HTTPS check failed; the HTTP status and curl error are shown. |
| Port 8443 already in use | Stop the other program using it, or run `EVAL_HTTPS_PORT=9443 make eval-up`. |
| Browser certificate warning | Import `.local/eval/caddy-root.crt` as described above. |