# Local Development

This document explains how to run TokenScope locally and how the development environment is structured.

Current architecture and feature ownership are defined in [EVALUATION_ARCHITECTURE.md](./EVALUATION_ARCHITECTURE.md).

Commands in this document describe implemented tooling unless explicitly marked as planned. Adding an architecture contract does not create its Make target, environment variable or test configuration.

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

Builds the development targets and starts the local stack in the background.
Use this command to return from evaluation mode to development mode.

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
2. The health-check action can call `/api/v1/health/db`.
3. The backend responds successfully.
4. The backend can communicate with PostgreSQL.

For problems, inspect:

```bash
make logs
```

---

## Type checking and builds

### Frontend

Run these commands from `frontend/` with Node 24 installed locally,
or inside the frontend development container after `make up`.
The evaluation frontend runs Caddy and does not contain Node or npm.

```bash
npm run check
npm run test
npm run build
```

`check` runs TypeScript validation without producing JavaScript output.

`build` creates the frontend production assets with Vite.

`test` runs the frontend HTTP-client, auth-invalidation, organization and
membership adapter, and page tests (including the organization deletion dialog) with Vitest.
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

The shared authentication, organization, membership and project integrations are present in the Sprint 1 baseline. Run the complete frontend suite when changing their shared transport or session behavior.

New unit/component tests remain under `frontend/test/`. Real browser journeys belong under `frontend/test/e2e/` once browser-test infrastructure is introduced.

Browser tests use Playwright; see "Browser end-to-end tests" below.

TSE-72 extends transport for multipart uploads, private binary responses and assistant streams while preserving current JSON callers.

See `EVALUATION_ARCHITECTURE.md` for current integration boundaries and `SPRINT_1_ARCHITECTURE.md` for the existing client/session design.

### Browser end-to-end tests

Browser tests run from the host against the running stack (frontend, backend
and PostgreSQL). Start and migrate the application first, then from `frontend/`:

```bash
npm ci
npx playwright install chromium
E2E_BASE_URL="http://localhost:5173" npm run test:e2e
```

Adjust `E2E_BASE_URL` to the actual frontend origin. The specs live in
`frontend/test/e2e/*.spec.ts` and create unique disposable accounts and
organizations; they never truncate the development database.

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

For the current architecture, see
[Evaluation Architecture](./EVALUATION_ARCHITECTURE.md).

## Evaluation setup and feature ownership

TSE-65 implements HTTPS evaluation startup using the existing Compose stack.
The ownership table below also includes separately delivered features;
their configuration and commands must be documented when implemented.

### Deployment ownership

TSE-65 introduces evaluation mode using the existing `compose.yaml`, service names and PostgreSQL volume.

The planned entry point is `make eval-up`, serving the built application at `https://localhost:8443`.

Do not create a second application stack merely for evaluation. Development/evaluation mode switching preserves the database.

TSE-65 provides `make eval-up`, serving the built application at `https://localhost:8443`.

Development and evaluation use the same `compose.yaml`, service names, `.env` and PostgreSQL volume. Switching mode preserves database contents.

See "Evaluation mode (HTTPS)" below for startup, certificate trust, readiness checks and mode switching.

### Configuration ownership

| Feature | Owner | Required integration |
|---|---|---|
| Evaluation mode and HTTPS | TSE-65 | Compose, Dockerfiles, proxy and Makefile |
| Public-request limits | TSE-67 | Trusted proxy/IP configuration |
| Realtime | TSE-73 | Origin allowlist and Socket.IO proxying |
| Private files | TSE-78 | `DOCUMENT_STORAGE_ROOT` and persistent private volume |
| Assistant | TSE-80 | `GEMINI_API_KEY`, `LLM_MODEL`, SSE proxy verification |
| Evaluation seed | TSE-70 | Explicit opt-in, operator-supplied password and documented command |

Backend configuration uses:

```text
backend/src/config/env.validation.ts
backend/src/config/configuration.module.ts
```

Because configuration has `skipProcessEnv: true`, new settings must be included in the typed validated configuration returned to consumers. Adding them only to Compose does not make them available through `ConfigService`.

Update `.env.example`, container environment mapping, validation, consumers and tests together. Commit placeholders only.

Missing optional Gemini configuration must not prevent unrelated application features from starting. Assistant requests report their documented unavailable state.

No secrets may use a frontend `VITE_` variable.

### Migration and verification

Use existing commands where applicable:

```bash
make db-generate
make db-migration name=<migration_name>
make db-status

make test-backend
make frontendcheck
make frontendtest
docker compose exec frontend npm run build
```

`db-migration` creates/applies a development migration against the configured development database. Use isolated disposable databases for migration-upgrade and destructive test scenarios.

The existing backend gate runs type checks, builds, migrations, unit tests, HTTP tests and PostgreSQL integration tests through the test Compose configuration.

New browser and seed commands must be documented when implemented. Do not substitute development data resets for isolated evaluation tests.

## Evaluation mode (HTTPS)

Development and evaluation use the same Compose project, `.env`,
services and PostgreSQL volume.

| Behavior | `make up` | `make eval-up` |
|---|---|---|
| Frontend | Vite development server | Production assets served by Caddy |
| Backend | NestJS development mode | Compiled NestJS |
| Address | `http://localhost:5173` by default | `https://localhost:8443` by default |
| Source changes | Development reload | Run `make eval-up` again |
| Database | Existing PostgreSQL volume | The same PostgreSQL volume |

### Start evaluation mode

Requirements: Docker, Docker Compose, Make, curl and OpenSSL.

```sh
make eval-up
```

Startup prepares `.env`, builds the images, waits for PostgreSQL,
starts the backend, starts Caddy, exports the public CA certificate,
and checks the frontend and database health endpoint over HTTPS.

If `.env` is absent, it is copied from `.env.example`.
A cryptographically random JWT secret is generated only when
`JWT_SECRET` is missing or empty. Existing configured values are preserved.
The backend still validates its configuration.

The backend runs `prisma migrate deploy` before starting NestJS.
A migration failure prevents NestJS from starting.
Startup does not generate migrations, reset the database or seed data.

Service readiness waits, certificate availability and each HTTPS
readiness check have a 120-second limit. Image downloads and builds
are separate and may take longer.

The evaluation frontend serves assets from `/srv`.
The evaluation backend runs from `/opt/tokenscope/backend`.
Development bind mounts under `/app` do not replace these built files.

Only the frontend publishes an evaluation port, bound to
`127.0.0.1:8443`. Backend and PostgreSQL remain on the Docker network.

To use another evaluation port:

```sh
EVAL_HTTPS_PORT=9443 make eval-up
```

### Trust the local certificate

Caddy's CA persists in its Docker data volume.
Startup exports only its public certificate:

```text
.local/eval/caddy-root.crt
```

On macOS, trust this certificate:

```sh
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  .local/eval/caddy-root.crt
```

Restart the browser and open `https://localhost:8443`.
The browser must accept the certificate without a warning.

On Debian/Ubuntu, install the public certificate in the system trust store:

```sh
sudo cp .local/eval/caddy-root.crt \
  /usr/local/share/ca-certificates/tokenscope-caddy-root.crt
sudo update-ca-certificates
```

If a browser uses a separate certificate store, import the public
certificate as a trusted certificate authority in its certificate settings.

Do not use browser-warning bypasses or `curl -k` as successful verification.

Verify the API with explicit CA verification:

```sh
curl --fail --show-error --max-time 10 \
  --cacert .local/eval/caddy-root.crt \
  https://localhost:8443/api/v1/health/db
```

Expected response:

```json
{"status":"healthy"}
```

### Switching modes and persistence

Run `make up` to rebuild and return to development mode.
Run `make eval-up` to rebuild and return to evaluation mode.

Both modes retain the database. Browser sessions may differ because
HTTP development and HTTPS evaluation are different browser origins.
Signing in again after switching origins is expected.

The evaluation frontend contains Caddy, not npm.
Run frontend checks and tests locally or in development mode.

```sh
make ps
make logs
make stop
make start
make clean
```

`make start` resumes existing stopped containers; it does not switch mode.
`make clean` removes containers and the network while preserving volumes.
The database and Caddy CA survive container recreation.

`make fullclean` deletes the project's volumes, including database data
and the Caddy CA. A newly generated CA must be trusted again.

### Troubleshooting

| Stage | Action |
|---|---|
| prerequisites | Install the missing tool or start Docker. |
| env | Correct the named setting; do not commit `.env`. |
| build | Inspect the image build output. |
| postgres | Inspect PostgreSQL logs and configuration. |
| backend | Inspect backend logs for migration or configuration failure. |
| frontend | Inspect Caddy startup and host-port availability. |
| certificate | Inspect Caddy logs and its persistent data volume. |
| readiness | Inspect service logs and retry the HTTPS health command above. |

Use a separate checkout and a unique Compose project name for fresh-database
and deliberate migration-failure tests. Never reset the working database
to demonstrate evaluation startup.
