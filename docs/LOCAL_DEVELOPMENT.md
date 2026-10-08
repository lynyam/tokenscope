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

The shared authentication, organization, membership and project integrations are present in the Sprint 1 baseline. Run the complete frontend suite when changing their shared transport or session behavior.

New unit/component tests remain under `frontend/test/`. Real browser journeys belong under `frontend/test/e2e/` once browser-test infrastructure is introduced.

At baseline `854da94`, the frontend package has no Playwright dependency or browser-test command. Do not present planned browser tests as an existing executable suite.

TSE-72 extends transport for multipart uploads, private binary responses and assistant streams while preserving current JSON callers.

See `EVALUATION_ARCHITECTURE.md` for current integration boundaries and `SPRINT_1_ARCHITECTURE.md` for the existing client/session design.
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

## Evaluation setup extensions — planned

At baseline `854da94`, evaluation startup, evaluation seeding, realtime, private-file storage and Gemini configuration are not implemented.

### Deployment ownership

TSE-65 introduces evaluation mode using the existing `compose.yaml`, service names and PostgreSQL volume.

The planned entry point is `make eval-up`, serving the built application at `https://localhost:8443`.

Do not create a second application stack merely for evaluation. Development/evaluation mode switching preserves the database.

The implementation PR must document certificate trust, readiness, migration execution and the final executable commands.

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
