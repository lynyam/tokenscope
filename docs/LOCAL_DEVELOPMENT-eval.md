# Local Development

This document explains how to run TokenScope locally and how the development environment is structured.

Current architecture and feature ownership are defined in [EVALUATION_ARCHITECTURE.md](./EVALUATION_ARCHITECTURE.md).

For the ordered evaluation walkthrough and results, see [DEMO.md](./DEMO.md).

## Requirements

Install:

* Docker
* Docker Compose v2 with `up --wait` support
* Make
* Git

Node.js does not need to be installed on the host to run the application because frontend and backend run inside Docker containers. Host-side checks and browser tests require Node.js 24 and dependencies installed with `npm ci` in the relevant directory.

Keep Docker running. HTTPS setup also requires curl and OpenSSL; the API and assistant examples use jq. Use an available application port (5173 for development or 8443 for evaluation by default).

Unless a section says otherwise, run commands on the host from the repository root. `docker compose exec` runs the requested command inside a running container. Database commands require PostgreSQL and the backend; frontend container checks require development mode. Shell examples use Bash; on macOS, enter `bash` before following examples that use `read -p`.

---

## First setup

Clone the repository:

```bash
git clone --branch main git@github.com:lynyam/tokenscope.git
cd tokenscope
```

Create the local environment file if it does not already exist (keep your existing settings when returning to the project):

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
in your local .env. Never commit .env. Keep an existing valid secret when restarting.

Start the application:

```bash
make up
make db-setup
```

Wait for dependency installation and the backend to finish starting before running `make db-setup`. It generates Prisma Client, applies development migrations and runs the development seed. Expect each stage to finish without an error. The seed accounts contain placeholder password hashes; create a user through sign-up for local login. Evaluation accounts use the separate [evaluation dataset](#prepare-the-evaluation-dataset).

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

Each developer creates the local environment from it once, without overwriting an existing `.env`:

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

### Configuration details

| Setting | Value or default | Required for | Secret? |
|---|---|---|---|
| `POSTGRES_USER`, `POSTGRES_DB` | Template: `tokenscope` | Database | No |
| `POSTGRES_PASSWORD` | Replace the local example password | Database | Yes |
| `DATABASE_URL` | Must match database credentials; Compose host is `postgres:5432` | Backend/Prisma | Yes |
| `FRONTEND_PORT`, `BACKEND_PORT` | Template: `5173`, `3000` | Application | No |
| `JWT_SECRET` | Generated locally; at least 32 bytes, without whitespace or placeholder values | Authentication | Yes |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Template: `tokenscope`, `tokenscope-web` | Authentication | No |
| `JWT_ACCESS_TTL_SECONDS` | Template: `3600`; positive integer | Authentication | No |
| `TRUSTED_PROXY_HOST` | Compose supplies `frontend` | Trusted proxy handling | No |
| `REALTIME_ALLOWED_ORIGINS` | Exact origins; template: `http://localhost:5173,https://localhost:8443` | Realtime | No |
| `EVAL_HTTPS_PORT` | Host-shell setting; default `8443` | HTTPS port override | No |
| `COMPOSE_PROJECT_NAME` | Optional unique name; retain it for follow-up commands | Isolated rehearsal | No |
| `DOCUMENT_STORAGE_ROOT` | Compose: `/var/lib/tokenscope/documents`; absolute writable path | Backend with private documents | No; private server path |
| `GEMINI_API_KEY`, `LLM_MODEL` | No fallback; supply an authorized key and model ID | Assistant requests | Key: yes; model: no |
| `DEMO_PASSWORD` | No committed default; loader setup below | Evaluation accounts | Yes |

Change `REALTIME_ALLOWED_ORIGINS` when changing the application port. The evaluation hostname is `localhost`; the public certificate is exported to `.local/eval/caddy-root.crt`.

`DOCUMENT_STORAGE_ROOT` is also required by the private-document backend. Compose supplies it; outside Compose, configure it explicitly as described in [Private document storage](#private-document-storage).

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

Follows logs from the Docker Compose services. Press Ctrl+C to stop following logs; the services remain running.

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

Generate Prisma Client, apply development migrations and seed the database.
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

**Warning:** this deletes the local PostgreSQL database, frontend/backend `node_modules` volumes, Caddy CA and any private-document volume in the stack. It also removes locally built images.

Use it only when a complete local reset is required.

---

## Verify the environment

For a first startup, complete `make up` and `make db-setup` above. To resume containers that already exist, run:

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

You can also check database health directly from the host:

```bash
curl --fail --show-error --max-time 10 http://localhost:5173/api/v1/health/db
```

Expect HTTP 200 and `{"status":"healthy"}`. Use your configured frontend port if different. In HTTPS mode, use the certificate-verified command in [Evaluation mode](#evaluation-mode-https).

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

New unit/component tests remain under `frontend/test/`. Real browser journeys belong under `frontend/test/e2e/`.

Browser tests use Playwright; see "Browser end-to-end tests" below.

TSE-72 extends transport for multipart uploads, private binary responses and assistant streams while preserving current JSON callers.

Returned API-key plaintext must remain only in transient UI memory.

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

From `backend/` on the host with Node.js 24 and `npm ci` completed, or from `/app` in the backend development container:

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

With Node 24 installed on the host and backend dependencies installed (`npm ci` from `backend/`), run from the repository root:

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

HTTPS evaluation startup uses the existing Compose stack. The table below links each configuration area to its implementation ticket.

### Deployment ownership

TSE-65 introduces evaluation mode using the existing `compose.yaml`, service names and PostgreSQL volume.

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
make db-migration name=describe_your_change
make db-status

make test-backend
make frontendcheck
make frontendtest
docker compose exec frontend npm run build
```

Replace `describe_your_change` with a short migration name. Run these commands in development mode.

`db-migration` creates/applies a development migration against the configured development database. Use isolated disposable databases for migration-upgrade and destructive test scenarios.

The existing backend gate runs type checks, builds, migrations, unit tests, HTTP tests and PostgreSQL integration tests through the test Compose configuration.

Use a disposable environment for evaluation data; keep it separate from your working database.

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

With the backend and PostgreSQL running, compile the loader in development mode:

```bash
docker compose exec backend npm run build
```

Evaluation images already contain the compiled loader. In either mode, run from the host repository root:

```bash
docker compose cp fixtures/evaluation/model-prices.json backend:/tmp/model-prices.json
docker compose exec backend npm run pricing:load -- --file /tmp/model-prices.json
```

Expect the import to finish successfully; an identical repeat leaves the catalogue unchanged.

Repeating an identical catalogue is a no-op. Existing identities cannot
be overwritten. Add a new effective date for a new price version.

The complete catalogue is limited to 1,000 rows and input files to 1 MiB.
Rates must be decimal strings. Non-synthetic entries require an HTTPS
pricing source and an explicit effective date.

Price catalogue loading never runs during normal application startup. Load the catalogue before submitting the fixture traces. This command imports prices only; it does not create evaluation accounts or traces.

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

Load the synthetic catalogue explicitly before running browser QA. In development mode, first run `docker compose exec backend npm run build` as described in [Explicit price catalogue loading](#explicit-price-catalogue-loading):

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


## Prepare the evaluation dataset

The evaluation dataset supplies known accounts, traces and expected totals for the demonstration. It is not needed to start the application. Load it into a disposable rehearsal environment. HTTPS startup applies committed migrations without seeding or resetting data. The development `make db-setup` command runs its own development seed; it does not load this evaluation dataset. Evaluation accounts require an operator-supplied password rather than a committed default.

**To complete with TSE-70:** the evaluation loader command, how to supply `DEMO_PASSWORD`, required services, password hashing, safe repeat/reset behaviour and the printed success output/effective period. The fixture files and standalone price loader do not create the evaluation accounts or load the full dataset.

Use [the fixture manifest](../fixtures/evaluation/manifest.json), [identities](../fixtures/evaluation/identities.json) and [expected results](../fixtures/evaluation/expected-results.json). The golden interval is `2026-10-01T00:00:00.000Z` inclusive to `2026-10-02T00:00:00.000Z` exclusive. If the loader prints a different anchor, use its effective period consistently.

The expected loaded dataset contains working accounts and six golden traces totalling 6,000 input tokens, 1,200 output tokens and USD `0.015350000000` in synthetic estimated cost. Keep pagination and destructive demonstrations in separate projects. See [DEMO.md](DEMO.md#golden-checkpoint) for the full checkpoint.

## Configure the Gemini assistant

These settings enable real assistant responses. They are not required to start the rest of the application. Set both values in the root, untracked `.env` for the dashboard assistant:

```dotenv
GEMINI_API_KEY=<your Gemini API key>
LLM_MODEL=<model ID available to your account>
```

Replace both placeholders before starting the assistant. Neither setting has a fallback value. Compose passes them to the backend, where typed configuration makes them available to the assistant. They must never use a frontend `VITE_` prefix. The standalone Chat/Translation demo has its own configuration file; setting that file does not configure the dashboard assistant.

If either setting is missing, the application and non-assistant features remain available. An authorized assistant request returns HTTP `503` with application code `LLM_UNAVAILABLE`. Startup and health checks do not call Gemini.

After editing the root `.env`, recreate the application in the same mode you were using. Run **one** command from the host repository root with Docker running:

```bash
make up
```

For HTTPS evaluation mode, use this instead:

```bash
make eval-up
```

A simple container restart does not apply changed environment variables. Check service health using [Verify the environment](#verify-the-environment). To check that the key reached the running backend without displaying it:

```bash
docker compose exec backend sh -c 'test -n "$GEMINI_API_KEY" && test -n "$LLM_MODEL" && printf "Assistant configuration is present\n"'
```

Expected: `Assistant configuration is present` and exit status 0. This confirms that both values are present, not that the provider accepts them. Avoid printing the resolved Compose configuration because it includes secrets.

### Check the assistant

With the complete stack healthy, sign in to a project you can access, select the intended dashboard dates and filters, and ask a short question about its analytics. Expect progressively displayed text. Check Stop and a subsequent request using the walkthrough in [DEMO.md](DEMO.md). The assistant sends authorized project metadata and analytics to Gemini; uploaded documents are excluded.

The backend gate (`make test-backend`, from the host repository root) uses a fake provider for automated assistant tests. Live provider checks use real quota and are separate. Record the actual model, account tier, commit, environment and live results in [the evaluation run record](DEMO.md#evaluation-run-record). Use a model available to the configured account, not a synthetic fixture model label.

For the scripted streaming and Stop checks, use Linux with Bash, jq, curl and GNU coreutils (`timeout` and `date` with millisecond formatting). The proxy script is not directly portable to the default macOS command-line tools; on macOS, use the browser walkthrough above or run the script in a Linux environment that can reach the application. Use a disposable project with known analytics. The assistant's manual scripts live in `backend/test/manual/`. Load the [synthetic price catalogue](#explicit-price-catalogue-loading) first, then sign in, create a disposable organization/project and create its project API key.

From the host repository root, in Bash, read the project key without displaying it and load the six golden traces:

```bash
read -r -s -p "Disposable project API key: " API_KEY
printf '\n'
export API_KEY
BASE_URL=http://localhost:5173 backend/test/manual/load-assistant-fixture.sh
unset API_KEY
```

For evaluation, set `BASE_URL=https://localhost:8443` and prefix the script command with `CURL_CA_BUNDLE="$PWD/.local/eval/caddy-root.crt"` so curl verifies the exported CA. Check that each printed HTTP status is `201` for creation or `200` for an identical replay; the script’s final “Done” message alone does not establish success. Successful ingestion should produce the [golden totals](DEMO.md#golden-checkpoint) for the fixed fixture dates.

The live proxy check makes three provider requests. In the same Bash shell, supply the signed-in user's token privately and replace the organization/project identifiers:

```bash
read -r -s -p "User access token: " TOKEN
printf '\n'
export TOKEN
export ORG_ID="your-organization-id"
export PROJECT_ID="your-project-id"
BASE_URL=http://localhost:5173 backend/test/manual/assistant-proxy-check.sh
unset TOKEN
```

For evaluation, use the HTTPS base URL and `CURL_CA_BUNDLE` setting above. Inspect the printed HTTP statuses and SSE events, not only the script exit status. Expect timestamped SSE output, an interrupted second request and a successful new request after Stop releases its slot. The stopped request's backend log records `"outcome":"client_left"`. Keep credentials out of shared output. Preserve the Vite/Caddy streaming configuration; changing proxy buffering or disconnect handling can affect Stop behaviour.

## Private document storage

`DOCUMENT_STORAGE_ROOT` must be an absolute path. Compose supplies `/var/lib/tokenscope/documents`, backed by the named volume `tokenscope_documents`. No additional host directory is needed when using that volume.

When running the backend outside Compose, set `DOCUMENT_STORAGE_ROOT` to a private directory writable by the backend user, for example `$HOME/.tokenscope/documents`. Do not place it inside frontend assets or a publicly served directory. Downloads and previews use authenticated project routes.

The cleanup service starts automatically with the backend. It resumes pending deletion work on startup, checks queued deletions every 10 seconds and sweeps old unreferenced files hourly. No separate worker command or extra cleanup environment variable is required. Failed deletions are retried. Organization/project archive retains files; individual document deletion removes metadata and schedules file cleanup.

### Check storage and persistence

With the complete stack healthy, use a disposable project and the small valid files in `backend/test/fixtures/documents/`:

1. Upload `valid.txt`, `valid.md` or `valid.pdf`. Confirm it appears in the project's documents.
2. Preview and download it through the application. Confirm the downloaded content matches the original.
3. Run `make stop`, then `make start` from the host repository root. Wait for health checks to pass, then confirm the document is still downloadable.
4. Recreate the stack with `make up` or `make eval-up`, matching the mode in use, and confirm the file remains available.
5. Delete the disposable document. Confirm it disappears and is no longer downloadable.

The encrypted PDF fixtures must be rejected. Backend document tests use temporary directories and real database/filesystem checks through `make test-backend`; they do not need the application's upload volume.

`make clean` preserves the storage volume. **`make fullclean` deletes it and all uploaded files**, together with the other project volumes. Do not use a full reset to check persistence.

## Clean-checkout rehearsal

Use a separate checkout of `main` and an unused Compose project name. From that checkout's root, with `.env` prepared, select an available port and matching realtime origin:

```bash
git rev-parse HEAD
export COMPOSE_PROJECT_NAME=tokenscope-rehearsal
export EVAL_HTTPS_PORT=9443
export REALTIME_ALLOWED_ORIGINS=https://localhost:9443
make eval-up
```

Expected: a separate application database/volumes and successful readiness at `https://localhost:9443`. Trust this checkout's exported certificate. Keep these settings in the same host shell for follow-up commands; set them again if reopening the terminal. Use the same application Compose file, not a second evaluation stack.

Record the tested commit, OS/tool versions, exact commands and results in [DEMO.md](DEMO.md#evaluation-run-record). Verify startup without Gemini first, then explicit data loading, optional provider/storage configuration and persistence across `make stop` / `make start`. Complete the browser matrix with Chrome, Firefox and Edge results. Keep setup failures and remaining issues with the affected result.

### Command outcomes

| Command group | Expected result |
|---|---|
| `make up`, `make eval-up` | Containers start; the database health endpoint returns HTTP 200. HTTPS startup also reports successful readiness checks. |
| Prisma generate/migrate/status | Client generation and migrations finish without errors; status reports applied migrations. |
| Type checks, builds and documentation checks | Exit status 0; builds produce their output files. |
| Unit, integration and browser tests | A passing test summary; retain failures in the run record. |
| `make shell`, `make db-shell` | A shell or PostgreSQL prompt opens; use `exit` or `\q` to leave it. |
| `make stop`, `make start` | Containers stop or resume; after resuming, health checks pass again. |
| `make clean` | Containers and network are removed; named volumes remain. |

`make test-backend` creates its own test services and uses the fixed Compose project `tokenscope-test`; do not run multiple copies concurrently. Host-only type checks and builds do not require the application stack. Browser tests require all application services. Record actual commands, versions and results in the [evaluation run record](DEMO.md#evaluation-run-record), using PASS, FAIL, BLOCKED or NOT RUN.
