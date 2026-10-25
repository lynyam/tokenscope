# Evaluation demo data — TSE-70

This is the current entry point for preparing a local evaluation demo. It uses
the existing `.env`, `compose.yaml` and `frontend`, `backend`, `postgres` services.
It does not require starting development mode first. There is no new service,
separate evaluation environment file, provider account or reset command.

The current loader is version **1.3**: the original 59 verification traces plus
an **Analytics Demo** project with 840 varied traces across four fictional
providers and twelve models. See [the analytics demo guide](ANALYTICS_DEMO.md)
for its recent seven-day window, exact totals, price catalogue and safe upgrade.
The canonical contract fixture manifest remains version 1.2 intentionally.

## Start directly in evaluation mode

Prerequisites: Docker with Compose, Make, curl and OpenSSL. Use a local,
disposable evaluation database, not a shared or production database.

1. If `.env` does not exist, copy `.env.example` to `.env`. Keep existing settings.
2. In this Git-ignored `.env`, set `DEMO_PASSWORD` to your own 8–128-character
   password. All four demo users share it. Never commit, paste into a ticket,
   record or put the password in a Make command argument. Leave
   `EVALUATION_SEED_ENABLED=false`: the explicit seed command enables only its
   child process. Do not use a real account password.
3. Check the database name in `POSTGRES_DB` and `DATABASE_URL`. With the existing
   example configuration it is `tokenscope`. Run:

```sh
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

This one command builds and starts the HTTPS stack, applies committed migrations,
waits for database/frontend readiness, then seeds. A seed failure makes the
command fail; it does not print the final ready message. The healthy application
can remain running, but the seed transaction commits all its records or none.
Successful startup reports `https://localhost:8443`.

Trust `.local/eval/caddy-root.crt` in the host/browser once, following
[the local HTTPS instructions](LOCAL_DEVELOPMENT.md#trust-the-local-certificate).
Do not disable TLS verification. Startup checks HTTPS using this public CA;
it cannot install browser trust for you.

Ordinary startup deliberately does **not** seed or reset data:

```sh
make eval-up
```

`SEED=1` is explicit demo preparation, not a new default. It satisfies a
single-command demo startup without making every application restart a data
mutation. It also avoids silently restoring records deleted during a demo.

## Seed an already-running dev or eval backend

```sh
make eval-seed CONFIRM_DATABASE=tokenscope
```

This uses `docker compose exec`: it never builds, starts, recreates or switches
services. The launcher reads the running container's `APP_MODE`: development
uses the existing TSX runner; evaluation uses the compiled CLI. Evaluation keeps
`NODE_ENV=production`. The actual connected PostgreSQL database must match your
confirmation. Only the repository's `postgres` service is accepted; remote
database URLs and URL query overrides are rejected.

Apply committed migrations first when using a development stack created before
this change:

```sh
docker compose exec -T backend npx prisma migrate deploy
make eval-seed CONFIRM_DATABASE=tokenscope
```

Changing `.env` does not change a running container's environment. Re-run
`make eval-up`, or export the password privately in your terminal before
`make eval-seed`. An exported `DEMO_PASSWORD` is forwarded by name, not as a
command-line value. Do not change it between seed reruns.

Do not run the old M1 `db-seed` or pre-load the fixture price catalogue as a
prerequisite. This seed owns its complete atomic dataset. Pre-existing fixture
IDs, demo emails, organization slugs or fixture provider/model prices without
its receipt cause a conflict, even if those rows look identical.

## What is installed

| Records | Count | Purpose |
| --- | ---: | --- |
| Users | 4 | Real sign-in accounts, independently salted Argon2id hashes |
| Organizations | 2 | Acme Demo and Other Tenant |
| Memberships | 4 | Three Acme roles and an isolated outsider |
| Projects | 6 | Golden, empty, pagination, other-tenant, archived and Analytics Demo |
| Synthetic model-price versions | 15 | 3 original historical versions + 12 analytics prices |
| Traces | 899 | 6 golden + 51 pagination + 2 isolation/archive + 840 analytics |
| Seed receipt | 1 | Detects changes or deletion without recreating data |

All fixture IDs are stable UUIDs. The seed reuses authentication hashing,
trace validation, payload hashing, historical price selection and decimal cost
calculation. It does not hard-code persisted cost totals. The six independently
specified golden results are checked inside the transaction.

No API key, JWT, LLM credential, upload metadata or private file is created.
No LLM request is made. Create project API keys through the normal management
UI/API, and use the normal upload flow when demonstrating files.

### Sign-in accounts

Open `/signin` and use your `DEMO_PASSWORD` with:

| Email | Organization | Role |
| --- | --- | --- |
| `owner@demo.tokenscope.test` | Acme Demo | OWNER |
| `admin@demo.tokenscope.test` | Acme Demo | ADMIN |
| `member@demo.tokenscope.test` | Acme Demo | MEMBER |
| `outsider@demo.tokenscope.test` | Other Tenant | OWNER |

The outsider has no Acme membership. Owner/admin/member see Support Golden,
Empty Project, Pagination Project and Analytics Demo. The outsider sees Private Other Tenant.
Archived Project remains stored with its trace, but is absent from the active
project list and cannot be opened through the normal project API.

## Analytics Demo: the recent, varied dashboard

Use **Acme Demo → Analytics Demo** for the main analytics demonstration.
Its 840 traces contain 6,277,671 tokens, an estimated synthetic cost of
`8.550480200000` USD and 49 simulated upstream errors (5.83%).
It includes unequal daily volume, twelve provider/model combinations, four
workflows, varied input/output sizes, latency outliers and quiet hours.
No external provider request is made to create these records.

On first installation or the verified 1.2 upgrade, the seed captures the last
completed UTC hour and generates the preceding seven-day window. The receipt
stores that end time. Later reruns reuse it; they do not move old traces forward.
The summary prints `analyticsDemo.range` and `analyticsDemo.dashboardPath`.
Open the path on your frontend origin for the exact full dataset, even after
it has aged out of the current "Last 7 days" preset.

`ANCHOR` still controls only the original golden fixtures described below.
It does not refresh the analytics window. See [ANALYTICS_DEMO.md](ANALYTICS_DEMO.md)
for prices, daily expectations, demonstration steps and fresh rehearsal isolation.

## Golden fixtures: dates and exact verification values

Default anchor: `2026-10-01`. Select this explicit UTC interval, not a moving
"last seven days" preset:

```text
from = 2026-10-01T00:00:00.000Z   inclusive
to   = 2026-10-02T00:00:00.000Z   exclusive
```

Use Support Golden (`30000000-0000-4000-8000-000000000001`) in Acme Demo
(`20000000-0000-4000-8000-000000000001`). UI display precision may round a value;
the API exposes the exact decimal strings below. Check your browser's date
control timezone against the actual UTC query.

| Selection | Traces | Input / output tokens | Estimated USD | Errors | Average latency ms |
| --- | ---: | --- | --- | ---: | ---: |
| No filters | 6 | 6000 / 1200 | `0.015350000000` | 2 | 1833.333 |
| `workflow=batch` | 3 | 4000 / 900 | `0.010750000000` | 1 | 1000 |
| `status=ERROR` | 2 | 1500 / 300 | `0.005400000000` | 2 | 2500 |
| `provider=fixture-a` | 3 | 3500 / 800 | `0.007150000000` | 0 | 1000 |
| `provider=fixture-b` | 3 | 2500 / 400 | `0.008200000000` | 2 | 2666.667 |
| `to=2026-10-01T15:00:00.000Z` | 5 | 4500 / 900 | `0.009950000000` | 1 | 2000 |

The unfiltered total is 7200 tokens, error rate 33.33%, 24 hourly buckets with
18 empty buckets. Model costs are `0.007150000000` for `fixture-a/demo-fast` and
`0.008200000000` for `fixture-b/demo-large`. All prices are synthetic, not live
provider quotes.

- Search `SUPPORT`: `golden-001`, `golden-003`, `golden-004`.
- `fixture-b` + `ERROR`: `golden-004`, `golden-006`.
- Newest-first, pages of two: `006/005`, `004/003`, `002/001`.
- Cost descending: `006`, `002`, `003`, `001`, `005`, `004` (all `golden-` IDs).
- Pagination Project: 51 traces, `workflow=pagination`, `page-001`–`page-051`,
  pages of 25/25/1 with no duplicates, total `0.009180000000`. Timestamp ties
  use the existing API's ascending-ID tie-breaker, including descending sort.
- Empty Project: zero counts/tokens/cost, null error rate and average latency,
  and 24 zero buckets. The configured assistant rejects an empty selection
  with `422 ASSISTANT_NO_DATA` without calling its provider. If no LLM provider
  is configured at all, the existing assistant returns unavailable first.

### Choose another anchor

On a fresh evaluation database only:

```sh
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope ANCHOR=2026-10-02
```

The loader shifts every fixture price/trace/archive instant, the explicit
dashboard interval and generated mutation request by the same whole-UTC-day
offset. Amounts and relative ordering are unchanged; canonical files are not
rewritten. For this example use October 2 inclusive to October 3 exclusive.
Use a completed UTC day. Production trace validation still rejects future
records; the application clock is never overridden.

The JSON files under `responses/` and `assistant/` remain the canonical October 1
contract examples. Their generated-at/record timestamps are examples, not a
claim that seeding sets the runtime clock. The seed's entity timestamps are the
selected anchor midnight; the receipt records the actual installation time.
Existing SSE protocol fixtures also retain their fixed example description;
real assistant requests use the richer description from the seeded project.

## Repeatability, conflicts and rehearsal isolation

An unchanged rerun reports `already-present` and writes nothing: IDs, hashes,
costs, trace versions and timestamps stay unchanged. Different password,
anchor/content, changed or missing fixture rows, and extra related
projects/traces/memberships/prices cause `SEED_CONFLICT`. Unrelated data is left
alone. The seed does not restore, upsert, reset, delete or repair user data.

There is one explicitly supported version transition: an **unchanged 1.2
installation → 1.3**. After applying the code and its new nullable receipt-column
migration, run the same `make eval-up SEED=1 CONFIRM_DATABASE=tokenscope`
(and the same `ANCHOR` if you used a custom one). The seed verifies the old
fingerprint, all stored baseline records and the password, checks new reserved
IDs/prices, and adds the project, twelve prices and 840 traces in one transaction.
Only the receipt is updated; existing accounts, hashes, memberships, projects,
traces, prices and timestamps are untouched. Success reports `upgraded`.
Any failure rolls back the complete upgrade. Unsupported versions are refused.

One `EvaluationSeedReceipt` database row stores fixture/state fingerprints and
the anchor/version and nullable analytics-window end. It has no foreign keys, so deleting the demo organization
cannot erase the record of the installation and cause an automatic resurrection
on the next seed. It contains neither plaintext passwords nor copied user rows.
A transaction-scoped lock refuses concurrent seed execution with `SEED_BUSY`.
These are accidental-write safeguards, not protection against an administrator
who deliberately changes the database or deployment settings.

After a mutation demo, normal `make eval-up` remains usable. Do not expect
`SEED=1` to reset the demo. For a fresh independent rehearsal, use a **new,
unused** Compose project name and port, retaining the same Compose file:

```sh
COMPOSE_PROJECT_NAME=tokenscope-demo-live EVAL_HTTPS_PORT=9443 \
  make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

Its Compose-scoped volumes are separate. Use that same `COMPOSE_PROJECT_NAME`
for later commands against it. A second project has a different CA: startup
replaces the exported public CA file with that project's CA, which must be
trusted for its HTTPS endpoint. Keep the ordinary project running or stop it
explicitly; do not run `fullclean` on a shared stack. Merely reusing an old
project name does not give a fresh database.

## Independent live, correction and deletion demonstrations

Start each scenario from its own unchanged baseline; do not add their expected
totals together. These mutations are **not** applied by the seed.

Create a project API key for Support Golden using the real UI/API. Do not
commit or record it. The actual public requests are:

| Scenario | Method and path | Input | Expected golden total |
| --- | --- | --- | --- |
| Live insert | `POST /api/v1/public/traces` | Generated `live` body | 7 traces, `0.017450000000` USD |
| Correct T1 | `PUT /api/v1/public/traces/50000000-0000-4000-8000-000000000001` | Generated `correction` body, `If-Match: "1"` | 6 traces, `0.017150000000` USD |
| Delete T1 | `DELETE /api/v1/public/traces/50000000-0000-4000-8000-000000000001` | No body, `If-Match: "1"` | 5 traces, `0.013550000000` USD |

Use `X-API-Key` for these requests and `Content-Type: application/json` for
POST/PUT. Live insertion returns 201, correction 200 and deletion 204. The live
body's fixed `externalId` makes repeating that same POST idempotent, not a second
new trace. Correction/deletion use the baseline trace's version 1; later writes
must use the current ETag/version.

Generate a request matching your anchor without touching the database:

```sh
docker compose exec -T backend npm run --silent eval:request -- live 2026-10-01
docker compose exec -T backend npm run --silent eval:request -- correction 2026-10-01
```

Replace the date with the anchor printed by the seed. These commands print only
synthetic request JSON; they do not authenticate or transmit it. For an isolated
rehearsal project, prefix them with its `COMPOSE_PROJECT_NAME`. Use the same
explicit dashboard interval to inspect the resulting totals and realtime
refresh. Full token, latency and error expectations are in
`fixtures/evaluation/expected-results.json`.

## Tests and acceptance

```sh
make test-eval-startup
make test-backend
```

The first command uses fake Docker/curl/openssl executables to test orchestration
only: ordinary startup never seeds; explicit seeding follows readiness; failures
propagate; confirmation is required; standalone seeding never starts dev mode.
It is not proof of a real container build or TLS handshake.

`make test-backend` uses the existing isolated `postgres-test` database. It runs
type checks, build, migrations, unit, HTTP and database integration tests. The
new integration suite uses real PostgreSQL and HTTP endpoints for login, tenant
access, analytics, pagination, historical pricing and independent mutations;
it also covers atomic rollback, unchanged reruns, collisions, changed/deleted
data, anchors, connected-database confirmation and concurrent seeds. It checks
the seeded dashboard/project context sent to the fake assistant. The
assistant is replaced with the existing fake provider: tests never spend LLM
quota. Destructive test cleanup is restricted to the existing guarded test DB.

Run the seeded browser suite against a running isolated evaluation stack after
trusting its certificate and installing Playwright with `make frontende2e-setup`.
Export the same `DEMO_PASSWORD` privately into the terminal; `.env` is not
automatically loaded by host Playwright:

```sh
E2E_EVALUATION_SEED=1 E2E_BASE_URL=https://localhost:8443 \
  make frontende2e E2E_ARGS=evaluation-seed.spec.ts
```

It verifies four accounts' normal sign-in and tenant/project visibility,
including direct 404 responses for the outsider's Analytics Demo access. A fifth
test reads the persisted demo window through the authenticated price API, opens
the exact dashboard, checks twelve model rows and filters, and asserts no
browser console warnings/errors, unhandled errors or assistant requests.
It is skipped without explicit opt-in, does not seed itself,
does not bypass HTTPS verification and disables automatic credentials-bearing
trace/video/screenshot artifacts. It does not prove live Gemini or uploads.
The opt-in also selects the console-only reporter, and password-entry failures
are sanitized. Do not override it with credential-bearing HTML/JSON reports.

Before marking TSE-70 accepted, retain the actual full backend gate, real
dev/eval startup/seed/rerun results and browser results. Source code, fixture
values, successful compilation and a test listing are not passing integration
or browser evidence.

## Failure messages

| Code/stage | Meaning and safe next step |
| --- | --- |
| `SEED_VALIDATION` / `SEED_TARGET` | Check explicit mode, password, confirmation, anchor and local Compose database URL. Do not print connection credentials. |
| `SEED_FIXTURES` | Restore the canonical fixture files and choose a completed UTC day. |
| `SEED_CONFLICT` | Existing/changed data is protected. Inspect locally, or prepare a new disposable rehearsal project. |
| `SEED_BUSY` | Another seed owns the transaction lock. Retry after it completes. |
| `SEED_FAILED` | Check migrations and DB readiness; diagnostics intentionally omit raw driver errors and credentials. |
| Startup stage `seed` | HTTPS startup succeeded but seeding failed; fix the seed error and use `make eval-seed`. |

The final summary contains counts, anchor/range, account emails/roles and outcome.
It never prints passwords, hashes, access tokens, API keys or connection URLs.
