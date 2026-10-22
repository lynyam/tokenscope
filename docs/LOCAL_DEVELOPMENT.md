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
membership adapter, and page tests (including the organization deletion dialog) with Vitest. The shared test setup uses jsdom and
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

New unit/component tests remain under `frontend/test/`.

Browser tests use Playwright; see "Browser end-to-end tests" below. The API-key journeys display one-time plaintext secrets, so never enable traces, videos or screenshots for them.

TSE-72 extends transport for multipart uploads, private binary responses and assistant streams while preserving current JSON callers.

API keys (TSE-74): the plaintext key returned at creation exists only in the page's transient disclosure state. It is never written to browser storage, URLs, logs or test artifacts. Unit tests use obviously fake placeholder keys.

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

Automatic Playwright traces, screenshots and videos are disabled. Login and
authenticated requests contain credentials; do not attach network recordings
or credential-bearing artifacts to a PR.

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

### Public API documentation — TSE-69

The public trace guide is [PUBLIC_API.md](./PUBLIC_API.md).

After starting development mode with `make up`, open:

```text
http://localhost:5173/api/v1/public/docs/
```

After building evaluation mode with `make eval-up`, open:

```text
https://localhost:8443/api/v1/public/docs/
```

Use the configured application port if different.
Trust the evaluation certificate as described below.

The specification is served at:

```text
/api/v1/public/openapi.json
```

The generator is:

```text
backend/scripts/generate-public-api.cjs
```

It writes two committed copies:

- backend/src/public-docs/public-api.json
- docs/openapi/public-api.json

Edit the generator and regenerate both copies. Do not edit generated JSON
directly.

With Node 24 installed on the host, run from the repository root:

```bash
cd backend
npm run docs:generate
npm run docs:check
node scripts/generate-public-api.cjs --check
cd ..
```

The direct `--check` command verifies both generated copies.
The package `docs:check` command checks the backend copy and runs OpenAPI
linting; it does not prove that endpoint behavior matches the document.

Alternatively, generate and compare both copies without host Node.
Run from the repository root:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/repo" \
  --workdir /repo/backend \
  node:24-alpine \
  node scripts/generate-public-api.cjs

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$PWD,target=/repo" \
  --workdir /repo/backend \
  node:24-alpine \
  node scripts/generate-public-api.cjs --check
```

In development mode, run linting and compilation through the backend container:

```bash
docker compose exec backend npm run docs:check
docker compose exec backend npm run build
docker compose exec backend test -s dist/public-docs/public-api.json
```

The development backend container mounts only backend/ at /app.
Do not run generation of both copies there: the repository's docs/ directory
is outside that mount. Use host Node or the repository-mounted Docker command
above.

Swagger UI and its specification are accessible without credentials.
Executing trace operations through the UI requires a project API key and
uses real endpoints and quotas. Use a disposable project and key.

Before executing fixture requests, follow
[Explicit price catalogue loading](#explicit-price-catalogue-loading).
Use explicit fixture dates for list queries; historical examples may fall
outside the default last-seven-days window.

After changing documentation or endpoint contracts, run:

```bash
make test-backend
git diff --check
```

Rebuild evaluation mode after source changes before verifying the documentation
and trace operations through HTTPS.

### Project analytics — TSE-71

Run the existing backend gate from the repository root:

```bash
  make test-backend
```

Analytics uses the existing schema and price/trace records. No additional
migration or automatic seed is introduced.

Canonical inputs and expected responses are in:

- fixtures/evaluation/traces-golden.json
- fixtures/evaluation/responses/analytics-golden.json
- fixtures/evaluation/responses/analytics-empty.json

The golden selection is explicitly:
2026-10-01T00:00:00.000Z through 2026-10-02T00:00:00.000Z.

These historical records are not guaranteed to be inside a moving
last-seven-days window. The database tests load fixtures only into the
guarded test database; they do not seed development data.

### Dashboard assistant — TSE-80

Configuration (backend only, in your untracked `.env`):

```bash
GEMINI_API_KEY=<your key>
LLM_MODEL=gemini-3.5-flash-lite
```

Compose passes both to the backend. Without them the application starts
normally and the assistant answers `503 LLM_UNAVAILABLE`. Never put the key in a
`VITE_` variable, and never run `docker compose config` (it prints resolved
secrets). After editing `.env`, recreate the backend and check the key length
only:

```bash
docker compose up -d backend
docker compose exec backend sh -c 'echo ${#GEMINI_API_KEY}'
```

No Gemini call happens at startup or in health checks.

Automated tests never call Gemini (a fake provider is injected):

```bash
make test-backend
```

Assistant suites: `test/assistant/*.unit.spec.ts`, `test/assistant/assistant.e2e-spec.ts`
and `test/database/assistant.integration.spec.ts`.

Fixture data for a manual check (TSE-70's seed is not required):

1. Load the synthetic price catalogue ([Explicit price catalogue loading](#explicit-price-catalogue-loading)).
2. Sign in, create a disposable organization and project, and create a project API key.
3. Load the six golden traces into that project (repeatable; the key is not printed):

```bash
read -rs API_KEY && export API_KEY
BASE_URL=http://localhost:5173 backend/test/manual/load-assistant-fixture.sh
```

Opt-in live check (requires Bash, curl and jq; uses up to three provider attempts per run):

```bash
read -rs TOKEN && export TOKEN
export ORG_ID=<organization id> PROJECT_ID=<project id>
BASE_URL=http://localhost:5173 backend/test/manual/assistant-proxy-check.sh
CURL_CA_BUNDLE="$PWD/.local/eval/caddy-root.crt" \
BASE_URL=https://localhost:8443 backend/test/manual/assistant-proxy-check.sh
```

Run each mode separately, with a fresh rate-limit window (at least 60 seconds
since the previous run) and the corresponding `make up` or `make eval-up` setup.
For HTTPS fixture loading, also set `CURL_CA_BUNDLE` to the public evaluation CA.
Never disable TLS verification. Use `bash <script-path>` if not executable.

The script prints each complete SSE line with its arrival time (text must arrive
progressively), stops a second request after 2 seconds, then shows that a
new request gets `200` and a terminal `done` (the stopped request freed its slot).
The check fails if the interrupted request had already finished or had not
started. Adjust `STOP_AFTER_SECONDS` and rerun deliberately in that case.
It does not automatically retry a provider request. Then:

```bash
docker compose logs backend | grep assistant_answer | tail -3
```

The stopped request must appear with `"outcome":"client_left"`.

Proxies: the Vite proxy streams responses as they arrive. Caddy flushes
`text/event-stream` immediately and only compresses frontend routes, so no proxy
configuration change is proposed. Verify both behaviors through the real proxies
before recording them as passed. Do not add `flush_interval -1`: it can keep the backend request
running after the client disconnects.

Record the live results (model, tier, quota, timestamps, commit) separately from
the automated results.

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

### Private document storage (TSE-78)

`DOCUMENT_STORAGE_ROOT` is required and must be an absolute path. Compose sets it to `/var/lib/tokenscope/documents`, backed by the named volume `tokenscope_documents`, so uploads survive restarts. `make fullclean` removes that volume and therefore every uploaded file.

Outside Compose, point it to a private directory that the backend user can write, for example `DOCUMENT_STORAGE_ROOT=$HOME/.tokenscope/documents`.

Backend tests use a temporary directory and do not need the volume.

Small fixtures for manual and automated checks live in `backend/test/fixtures/documents/` (`valid.pdf`, `valid.txt`, `valid.md`, and encrypted PDFs that must be rejected). Run the full backend suite, including the real PostgreSQL and filesystem tests, with `make test-backend`.

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


### Explicit price catalogue loading

Catalogue loading is never automatic.

For the development backend:

docker compose exec backend npm run build
docker compose cp fixtures/evaluation/model-prices.json backend:/tmp/model-prices.json
docker compose exec backend npm run pricing:load -- --file /tmp/model-prices.json

Repeating an identical catalogue is a no-op. Existing identities cannot
be overwritten. Add a new effective date for a new price version.

The complete catalogue is limited to 1,000 rows and input files to 1 MiB.
Rates must be decimal strings. Non-synthetic entries require an HTTPS
pricing source and an explicit effective date.

Price catalogue loading never runs during normal application startup. The evaluation setup command loads the canonical synthetic catalogue before seeding traces. The standalone pricing:load command remains available for deliberate catalogue imports.(TSE-70 connects it to the evaluation setup)

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

## Trace Explorer checks

```sh
make frontendcheck
make frontendtest
docker compose exec frontend npm run build
```

The screen is read-only and uses existing backend endpoints documented in
`docs/API.md`. Shared filters and integration limitations are documented in
`docs/EVALUATION_ARCHITECTURE.md`, “Frontend Trace Explorer integration — TSE-75”.

### Trace Explorer browser tests

Playwright runs on the host against a stack that is already up (`make up`, then `make frontende2e-setup` once):

```bash
make frontende2e E2E_ARGS="trace-explorer"
E2E_BASE_URL=https://localhost:8443 make frontende2e E2E_ARGS="trace-explorer"   # evaluation mode
```

The suite creates its own users, organization and three projects, ingests `fixtures/evaluation/traces-golden.json`
and `traces-pagination.json` through the real public API (one API key per project) and then drives the browser.
Ingestion is limited to 60 requests per minute per client address, so a full run takes about two minutes.

The browser never loads prices: the fixture price catalogue must already be in the database. Once per database:

```bash
docker compose exec -T backend sh -c 'cat > /tmp/model-prices.json' < fixtures/evaluation/model-prices.json
docker compose exec backend sh -c 'npm run build >/dev/null && npm run pricing:load -- --file /tmp/model-prices.json'
```

The loader is idempotent. When the catalogue is missing, the suite stops at its first step with this pointer.

## Realtime development and HTTPS verification — TSE-73

Set this in the root `.env` (adapt exact origins when changing ports):

```dotenv
REALTIME_ALLOWED_ORIGINS=http://localhost:5173,https://localhost:8443
```

Recreate the backend after changing environment variables. `make up` uses the Vite
proxy; `make eval-up` rebuilds the existing Caddy deployment. Both forward `/socket.io`
for polling and WebSocket upgrades without exposing another backend port.
Caddy compression stays in the frontend-only handler so API ETags remain unchanged.

Backend verification: `make test-backend` runs unit, real-transport and guarded PostgreSQL tests.
The 100-write burst test uses real ingestion transactions directly because 100 HTTP
requests from one IP would exceed the separate public API quota of 60/minute.

Browser proxy verification uses the test-only Socket.IO bundle installed under backend/node_modules.
Run `npm ci` in backend and frontend on the host, then `npx playwright install chromium`
in frontend. No production frontend dependency is added by TSE-73.

Load the synthetic catalogue explicitly before running browser QA:

```sh
docker compose cp fixtures/evaluation/model-prices.json backend:/tmp/model-prices.json
docker compose exec -T backend npm run pricing:load -- --file /tmp/model-prices.json
```

With the database health endpoint returning 200, run from frontend:

```sh
E2E_BASE_URL=http://localhost:5173 npm run test:e2e -- realtime.spec.ts
```

After `make eval-up`, trust the evaluation CA as described above. Then run from frontend:

```sh
NODE_EXTRA_CA_CERTS="$PWD/../.local/eval/caddy-root.crt" \
E2E_BASE_URL=https://localhost:8443 npm run test:e2e -- realtime.spec.ts
```

Do not disable certificate verification. The three cases cover polling-only, WebSocket-only
and polling upgrade with actual browser-generated headers and two real accounts.
The test archives its disposable organizations; it does not reset the development database.
Test JWTs/API keys are not logged or recorded in Playwright artifacts.
This verifies transport and notifications, not the dashboard chart refresh owned by TSE-76.

### API-key browser tests — TSE-74

Use the existing browser setup and trusted HTTPS instructions above. Import the
canonical price catalogue using the same operator command documented for the
Trace Explorer tests before running `api-keys.spec.ts`. Its setup checks that
catalogue, and the main journey uses a canonical fixture with a unique external ID.

Run `E2E_ARGS=api-keys.spec.ts make frontende2e` with the chosen `E2E_BASE_URL`.
The key created in the UI must create a real trace, remain absent after closing
and reloading the disclosure, and fail with `401 INVALID_API_KEY` after UI
revocation. The suite also checks cross-project reads and archived parents.
Keep plaintext out of shared test evidence, including error reports on failures.


### Dashboard tests — TSE-76

The frontend Compose service mounts `fixtures/evaluation` read-only at `/fixtures/evaluation`
so the same golden JSON files work for Vitest on the host and inside `/app`.
Do not copy fixture values into another frontend-owned catalogue.

After starting development mode, run from the repository root:

```sh
make frontendcheck
make frontendtest
docker compose exec -T frontend npm run build
```

Browser tests use the host runner and the existing explicit price-catalogue loading instructions.
Load prices once into the running application database, then run:

```sh
cd frontend
E2E_BASE_URL=http://localhost:5173 npm run test:e2e -- project-dashboard.spec.ts
```

For evaluation mode, rebuild with `make eval-up`, keep certificate validation enabled,
and use the exported/trusted evaluation CA. From `frontend/`:

```sh
NODE_EXTRA_CA_CERTS="$PWD/../.local/eval/caddy-root.crt" \
E2E_BASE_URL=https://localhost:8443 npm run test:e2e -- project-dashboard.spec.ts
```

Retain the Vite and Caddy `/socket.io` proxies already provided by TSE-73.
Record the tested commit, mode, exact commands and results. A unit test does not prove HTTPS
or real socket/browser integration. Full responsive validation remains tracked by TSE-88.
