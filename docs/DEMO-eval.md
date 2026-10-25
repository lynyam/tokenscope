# TokenScope demonstration and evaluation guide

> Evaluation preparation copy. Keep the existing `DEMO.md` unchanged. This guide describes the integrated develop features and the current seed; pending features and missing execution evidence are identified explicitly. The selected evaluation commit, not a moving branch name, determines what is actually demonstrated.

## Purpose

Use this guide to prepare and run the TokenScope evaluation. It gives the team and evaluators an ordered feature walkthrough, expected results, and detailed API/browser checks. Setup details are in [Local Development](LOCAL_DEVELOPMENT-eval.md); contracts are in [API](API.md), [Data Model](DATA_MODEL.md) and [Security](SECURITY.md).

Follow the ordered walkthrough for the demonstration and use the detailed Alice/Bob procedures for permission and isolation checks. Record this guide's rehearsal results in [Evaluation evidence](#evaluation-evidence), and link existing feature evidence from [EVALUATION.md](EVALUATION.md) without replacing it or relabelling historical runs as current passes.

## 1. Prepare the evaluation environment

### Prerequisites and command context

Use Git, Docker with its daemon running, Docker Compose v2 with `up --wait` support, Make, curl, OpenSSL and jq. The containers supply Node.js 24, PostgreSQL 16 and Caddy 2. Host Node.js is needed only for the optional frontend test commands below.

All shell examples run **on the host**, in **Bash**, from the **rehearsal repository root**, unless stated otherwise. On macOS, enter `bash` first. Keep that shell open so the URL, certificate and authentication variables remain available. Do not enable shell tracing or capture credentials in screenshots.

### Isolated checkout and startup

Use a new directory and an unused Compose project name so rehearsal does not reset your working database. Replace `EVALUATION_COMMIT` with the full SHA selected from integrated `develop` before running the checkout command. Use the same candidate as the evaluation README and setup guide.

```bash
git clone --branch develop https://github.com/lynyam/tokenscope.git tokenscope-evaluation
cd tokenscope-evaluation
git checkout --detach "EVALUATION_COMMIT"
git rev-parse HEAD
export COMPOSE_PROJECT_NAME=tokenscope-rehearsal
export EVAL_HTTPS_PORT=9443
export REALTIME_ALLOWED_ORIGINS=https://localhost:9443
test -e .env || cp .env.example .env
```

Set a private local database password in `.env`, keeping `DATABASE_URL` consistent. Set `DEMO_PASSWORD` to a private 8–128-character evaluation-only password; the four demo accounts share it. Keep `EVALUATION_SEED_ENABLED=false`: the explicit command enables only its seed child process. Leave `GEMINI_API_KEY` empty for the initial no-provider check. Do not put credentials in Make arguments, reports or shell tracing. These steps require no running application services. Do not reuse an existing rehearsal project name containing data you need. The example uses port 9443; choose another unused port and update both settings if necessary.

```bash
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

Use the actual database name if it is not `tokenscope`. No preceding `make up`, `make db-setup`, `make db-seed` or manual catalogue import is required.

Expected: builds complete, committed migrations apply, the database becomes healthy, Caddy's public CA is exported to `.local/eval/caddy-root.crt`, and the final line gives `https://localhost:9443`. The script creates a missing JWT secret, using the existing Compose stack. With `SEED=1`, it then prepares the evaluation dataset before printing the final ready message. A seed failure exits unsuccessfully without claiming demo readiness; the application can remain healthy, but the seed transaction commits all of its records or none.

Trust that public CA in the browser/OS. On macOS, this host command requires administrator authorization:

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  .local/eval/caddy-root.crt
```

For other systems and Firefox's certificate store, use [certificate trust instructions](LOCAL_DEVELOPMENT-eval.md#trust-the-local-certificate). Restart the browser and open the HTTPS origin without bypassing certificate errors.

Set up the shell helpers used throughout this guide:

```bash
DEMO_ORIGIN="https://localhost:$EVAL_HTTPS_PORT"
DEMO_API_BASE="$DEMO_ORIGIN/api/v1"
DEMO_CA="$PWD/.local/eval/caddy-root.crt"
demo_curl() {
  curl --cacert "$DEMO_CA" --show-error --connect-timeout 5 --max-time 30 "$@"
}
make ps
demo_curl --fail --silent "$DEMO_API_BASE/health"
demo_curl --fail --silent "$DEMO_API_BASE/health/db"
```

With the stack running, both health calls should return HTTP 200 and `{"status":"healthy"}`. On failure, use `make logs` from this directory; press Ctrl+C to leave log viewing. Do not continue the demonstration while readiness is failing.

### Evaluation accounts, data and optional provider

The [seed guide](EVALUATION_SEED.md) is the authoritative setup and repeatability reference. Seed version **1.3** preserves the canonical [1.2 fixture manifest](../fixtures/evaluation/manifest.json) and [identities](../fixtures/evaluation/identities.json), and adds the [Analytics Demo](ANALYTICS_DEMO.md). It creates these working sign-in accounts with independently salted password hashes:

| Account | Role / organization | Use |
|---|---|---|
| `owner@demo.tokenscope.test` | OWNER, Acme Demo | Membership changes, keys and archive |
| `admin@demo.tokenscope.test` | ADMIN, Acme Demo | Project/key/document management |
| `member@demo.tokenscope.test` | MEMBER, Acme Demo | Read access and denied mutations |
| `outsider@demo.tokenscope.test` | OWNER, Other Tenant | Cross-organization isolation |

Use **Analytics Demo** for the main varied dashboard, **Support Golden** for exact numerical verification, **Empty Project** for empty states, and **Pagination Project** for its 51 rows. Create a separate disposable organization and projects for membership changes, mutations, uploads and archive. Leave the seeded organizations, memberships, projects and traces unchanged; extra resources inside Acme Demo can also make a later seed verification refuse. Never archive Acme Demo or Support Golden.

The successful JSON summary reports `outcome` as `inserted`, `upgraded` (verified unchanged 1.2 installation to 1.3) or `already-present`. Expect 4 users, 2 organizations, 4 memberships, 6 projects, 15 synthetic price versions and 899 traces; one receipt records the installation. The seed creates no API key, JWT, upload or live LLM request.

Use your configured `DEMO_PASSWORD` to sign in. Save only the non-secret summary, especially `dashboardRange`, `analyticsDemo.range` and `analyticsDemo.dashboardPath`. On a current, already-running dev or eval backend, the explicit command is:

```bash
make eval-seed CONFIRM_DATABASE=tokenscope
```

This does not start or switch modes. If you changed `.env`, recreate the backend with `make eval-up` first so its environment is current, or follow the seed guide's private exported-password procedure. Keep the same password and golden anchor between reruns.

An unchanged rerun is a no-op; it does not refresh the analytics window. Changed/deleted fixtures or collisions produce `SEED_CONFLICT` instead of repair. Use a new, unused Compose project for a fresh rehearsal, not `fullclean`, deletion of the receipt or manual database edits. After mutation demonstrations, ordinary `make eval-up` starts the application without reseeding.

The seed already loads its prices. **Do not pre-import the fixture catalogue before a first evaluation seed:** even identical reserved prices without its receipt conflict. A separate price-only import is an alternative solely for a disposable test database that will not subsequently receive this seed; see [setup guidance](LOCAL_DEVELOPMENT-eval.md#explicit-price-catalogue-loading).

Gemini setup is implemented: set backend-only `GEMINI_API_KEY` and an account-supported `LLM_MODEL` in the root ignored `.env`, then rebuild with `make eval-up`. See [assistant configuration](LOCAL_DEVELOPMENT-eval.md#configure-the-gemini-assistant) and [private storage](LOCAL_DEVELOPMENT-eval.md#private-document-storage). Remaining live evidence must identify the actual model, account tier, commit and results; a synthetic fixture model is not a deployable provider choice.

Run the main application both without Gemini configuration and with a configured test account. Without it, non-assistant features should work and assistant requests should return the documented unavailable response. With it, step 8 includes a deliberate live request. Record provider-model/account-tier details and the error code in the evidence section; do not publish keys or assume universal model availability.

## Analytics Demo checkpoint

Sign in as an Acme member and open the printed `analyticsDemo.dashboardPath` on this rehearsal's HTTPS origin. Its query selects the exact full `analyticsDemo.range`; do not assume the moving “Last 7 days” preset includes all data on a later rehearsal.

| Metric | Expected, full unfiltered Analytics Demo |
|---|---:|
| Traces | 840 |
| Providers / models | 4 fictional providers / 12 models |
| Input / output tokens | 5,516,730 / 760,941 |
| Total tokens | 6,277,671 |
| Estimated synthetic USD | 8.550480200000 |
| ERROR traces / error rate | 49 / 5.83% |
| Average latency | 1562.205 ms |

Inspect unequal daily usage, provider/model groups, workflows, token variation and latency outliers. Apply provider/model/workflow filters, then clear them to restore the full checkpoint. The simulated ERROR traces are analytics data, not application or console failures.

The first enriched install captures the last completed UTC hour and the preceding seven days. Its receipt freezes that period on reruns. `ANCHOR` shifts only the original golden fixtures, not the analytics window. UTC calendar-day grouping may show eight buckets when the seven-day interval ends outside midnight. See [Analytics Demo](ANALYTICS_DEMO.md) for exact dates, per-provider expectations and safe upgrades.

## Golden checkpoint

Use the full UTC day:

```text
from = 2026-10-01T00:00:00.000Z
to   = 2026-10-02T00:00:00.000Z
```

For a fresh seed with a custom `ANCHOR`, use its printed `dashboardRange` instead; the loader shifts the canonical fixture times consistently. Do not edit fixture JSON or re-anchor an existing installation. Never rely on old golden records remaining inside “Last 7 days.”

Expected golden results:

| Metric | Expected |
|---|---|
| Trace count | `6` |
| Input tokens | `"6000"` |
| Output tokens | `"1200"` |
| Total tokens | `"7200"` |
| Estimated cost | `"0.015350000000"` |
| Error count | `2` |
| Error rate | `33.33` |
| Average latency | `1833.333` |
| `fixture-a/demo-fast` cost | `"0.007150000000"` |
| `fixture-b/demo-large` cost | `"0.008200000000"` |
| Hourly buckets | `24`, including `18` empty buckets |

These values are fixture expectations, not live-provider prices.

Keep the 51-row pagination dataset, cross-tenant data and mutation demonstrations separate from the golden project so they do not change its expected totals.

## Ordered feature walkthrough

Each row specifies the actor, starting screen, action, expected result and recovery. Use separate browser profiles for simultaneous accounts. Keep the exact golden UTC dates selected, including after navigating between pages.

| Step / account | Starting screen and action | Expected result / module | Recovery |
|---|---|---|---|
| 1 — OWNER | HTTPS landing page: sign in, open Acme Demo and Support Golden, then reload the protected page directly. | Session and authorized project access survive reload; frameworks and organizations. | Sign out before switching accounts in the same profile. |
| 2 — OWNER, ADMIN, MEMBER, outsider | Members/project screens: verify each role; use a disposable member for role changes/removal. Rename a disposable organization; reject demotion/removal of its last owner. Attempt outsider access by URL and API. | OWNER manages memberships; ADMIN manages projects but not memberships; MEMBER reads; outsider gets concealed 404s. Current membership governs already-issued JWTs. Organization module. | Re-add the disposable member and restore roles. Leave golden memberships unchanged. Detailed API checks follow below. |
| 3 — any Acme member | Open Analytics Demo using its printed exact path; show varied daily/provider/model usage and filters. Then open Support Golden with its printed golden interval, no filters; repeat with `provider=fixture-a`, then Empty Project. | Analytics Demo and golden checkpoints match. Golden fixture-a has 3 traces and USD `0.007150000000`; empty state has zero counts/cost and null rate/latency. Analytics. | Clear filters and explicitly restore the intended project's interval. No mutation. |
| 4 — any Acme member | Trace Explorer: combine provider/model/workflow/status and text filters, sort, open detail and return. In Pagination Project set page size 25 and visit pages 1–3. | Filter intersection, retained selection and stable ordering; 25/25/1 rows for 51 records. Advanced search. | Clear filters and return to the intended project; no data changes. |
| 5 — OWNER/ADMIN | Disposable project's key screen: create a named key; call public POST, list GET, detail GET, PUT and DELETE. Show identical replay, stale version, invalid/revoked credentials and quota handling. | Secret displayed once; five operations are project-scoped. New POST 201, replay 200; current ETag required for mutations; stale version 412; revoked key 401; quota 429 with Retry-After. Public API. | Use fresh external IDs; retain the key for step 6, then revoke it. Wait the advertised Retry-After before other checks. |
| 6 — two authorized users | Same disposable dashboard in two browsers: insert the realtime fixture, correct and delete it; disconnect/reconnect one browser. Remove a disposable viewer's membership. | Committed changes trigger notifications and HTTP refetch; charts update. Replay/no-op does not create another change. Reconnect repairs the view; removed viewer loses access. Realtime. | Restore the disposable membership; revoke test keys; leave Support Golden untouched. See detailed realtime procedure. |
| 7 — any Acme member | Support Golden dashboard: export the displayed snapshot as CSV and PDF. Repeat with fixture-a filter and Empty Project. | Project, dates, filters, snapshot ID, summary and all series/model rows match the captured selection. Empty exports remain valid. Analytics. | Delete local sample downloads when finished; clear filters. No database mutation. |
| 8 — any Acme member | Support Golden assistant: ask “Which model costs the most in this period, and how many errors occurred?” Observe streaming, then test Stop on another request. Change filters and ask again; try Empty Project and configured error cases. | The initial answer reflects demo-large USD `0.008200000000` and 2 errors; wording may vary. Server-built context stays fixed for that answer. Empty data returns `422 ASSISTANT_NO_DATA`; errors are recoverable and rate limits respected. LLM. | Clear interrupted responses and restore selection. Restore provider configuration after negative tests; record real-provider and controlled-error tests separately. |
| 9 — OWNER/ADMIN, MEMBER, outsider | Disposable project's documents: upload sample PDF/TXT/Markdown, observe progress, preview/download, compare hashes, reject invalid files, then delete. Repeat upload/delete as MEMBER and retrieve as outsider. | Samples follow the upload manifest. MEMBER can read but cannot upload/delete; outsider cannot retrieve bytes. Deletion removes normal access and queues durable file cleanup. File upload. | Remove test uploads; record cleanup verification separately from UI disappearance. Do not archive the parent as a substitute for file deletion. |
| 10 — OWNER/ADMIN | Disposable project: archive as ADMIN or OWNER. Separate disposable organization: reject ADMIN archive, reject wrong confirmation slug, then archive as OWNER with the exact slug. | Archived resources/children are inaccessible; database rows and private file bytes are retained. User session and unrelated organizations still work. Organizations. | No application restore. Create new disposable resources for another run. |
| 11 — team | Public pages and browser results: open `/privacy` and `/terms` without login, reload with an invalid stored session and unavailable backend. Review Chrome/Firefox/Edge runs and explain architecture/contributions. | Relevant readable legal pages, consistent responsive UI and documented browser results. Notifications trigger HTTP analytics; assistant uses analytics, not uploaded files. Browser module and mandatory requirements. | Undo network blocking and return to a working session. |

### Public API checkpoints

Use [Public API](PUBLIC_API.md) for the full request examples. A browser JWT and a project API key serve different routes. For the public trace demonstration:

- Use exactly one `X-API-Key` header; no key in URLs or screenshots.
- List with explicit `from` and `to`; historical traces will not appear in a moving seven-day window.
- Save the ID and quoted ETag from POST/GET. PUT is full replacement with the same `externalId`; use `If-Match` with the current ETag for PUT/DELETE.
- Check `428 TRACE_VERSION_REQUIRED` when the header is missing, `412 TRACE_VERSION_CONFLICT` when stale, and no version change for a no-op PUT.
- After DELETE returns 204, detail returns 404 and a reused external ID returns `409 TRACE_DELETED`.
- Use a key from a second disposable project to verify that it cannot read the first project's trace.
- Show published API documentation and `429 RATE_LIMITED` / `Retry-After` evidence. Keep quota stress checks separate from the main walkthrough.

### Export, upload and assistant details

Compare exported numeric strings rather than rounded chart labels. The CSV includes one summary row, every series bucket and every model group; the PDF includes the complete tables across pages. A refresh during generation must not mix two snapshots.

Use the files and expected statuses in [uploads-manifest.json](../fixtures/evaluation/uploads-manifest.json). On the host, `shasum -a 256 <downloaded-file>` should match the corresponding manifest hash. Valid samples return 201; empty text, invalid UTF-8 and malformed PDF return 422. Also test size/type rejection on both client and backend, following [document contracts](API.md#private-documents--tse-78--tse-79).

For the assistant, inspect the selected dates/filters and returned context as well as the answer. A later trace change affects a subsequent answer, not the context already streaming. Stop ends TokenScope's output; it does not guarantee provider-side computation stops. Uploaded files, saved conversation history and automatic actions are outside this assistant's scope. Test unavailable configuration, provider failures, timeout, rate limits and access loss using the feature owner's supported test setup.

### External Chat and Translation example — pending PR #48

**BLOCKED pending integration:** [PR #48 / TSE-86](https://github.com/lynyam/tokenscope/pull/48) is not merged into the reviewed develop snapshot. Its `examples/external-demo/` files are not available here. Skip this optional section until the implementation is merged and verified on the selected candidate; it is not a prerequisite for seed loading or the dashboard assistant.

After integration, use the standalone demo to submit one Chat request and one Translation request to Gemini. Verify actual token usage reaches **Demo Chat** and **Demo Translation** respectively, each through its own project key and the shared `callWithTrace` wrapper. Revoke one project's key: its answer should remain available while trace delivery reports failure, and the other project's delivery should remain unaffected. Restore access with a new key and remove test resources afterward.

**To complete after TSE-86 integration:** verify its setup/report paths and record the tested application/demo commits for the evaluation candidate. Do not mark its branch-only results as integrated evidence. This example demonstrates an external client integration; the streamed dashboard assistant is demonstrated separately in step 8.

## Detailed API acceptance flow

Run these commands in the same host Bash session as setup, from the repository root, with the HTTPS stack healthy. They use disposable Alice/Bob accounts and organizations, separate from the golden fixtures. Run once per fresh rehearsal database; for a repeat, use new account emails and organization names. Archived slugs remain reserved.

Enter a password for these disposable accounts (8–128 characters; do not use a personal password):

```bash
read -r -s -p 'Disposable account password: ' DEMO_ACCOUNT_PASSWORD
printf '\n'
```

### Create Alice

```bash
ALICE_AUTH_JSON=$(
  demo_curl --fail --silent \
    -X POST "$DEMO_API_BASE/auth/signup" \
    -H "Content-Type: application/json" \
    --data-binary "$(printf '%s' "$DEMO_ACCOUNT_PASSWORD" | jq -Rs \
      '{email: "alice.demo@tokenscope.dev", password: ., displayName: "Alice"}')"
)

ALICE_ACCESS_TOKEN=$(
  printf '%s' "$ALICE_AUTH_JSON" | jq -r '.accessToken'
)
```

Verify:

```bash
printf '%s' "$ALICE_AUTH_JSON" | jq 'del(.accessToken)'

demo_curl --fail --silent \
  "$DEMO_API_BASE/auth/me" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" | jq
```

Expected:

- sign-up returns `201`;
- `accessToken` is non-empty;
- `/auth/me` returns Alice;
- neither response contains `password` or `passwordHash`.

### Create Bob

```bash
BOB_AUTH_JSON=$(
  demo_curl --fail --silent \
    -X POST "$DEMO_API_BASE/auth/signup" \
    -H "Content-Type: application/json" \
    --data-binary "$(printf '%s' "$DEMO_ACCOUNT_PASSWORD" | jq -Rs \
      '{email: "bob.demo@tokenscope.dev", password: ., displayName: "Bob"}')"
)

BOB_ACCESS_TOKEN=$(
  printf '%s' "$BOB_AUTH_JSON" | jq -r '.accessToken'
)

BOB_USER_ID=$(
  printf '%s' "$BOB_AUTH_JSON" | jq -r '.user.id'
)
```

### Alice creates an organization

```bash
ALICE_ORGANIZATION_JSON=$(
  demo_curl --fail --silent \
    -X POST "$DEMO_API_BASE/organizations" \
    -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "API Acceptance Demo"
    }'
)

ALICE_ORGANIZATION_ID=$(
  printf '%s' "$ALICE_ORGANIZATION_JSON" | jq -r '.id'
)

printf '%s' "$ALICE_ORGANIZATION_JSON" | jq
```

Expected:

- response status is `201`;
- slug is `api-acceptance-demo`;
- `currentUserRole` is `OWNER`;
- exactly one initial membership exists for Alice when members are listed.

### Alice creates a project

```bash
PROJECT_JSON=$(
  demo_curl --fail --silent \
    -X POST \
    "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
    -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Customer Support AI",
      "description": "workspace demo project"
    }'
)

PROJECT_ID=$(
  printf '%s' "$PROJECT_JSON" | jq -r '.id'
)

printf '%s' "$PROJECT_JSON" | jq
```

Expected:

- response status is `201`;
- `organizationId` equals `ALICE_ORGANIZATION_ID`;
- `slug` is `customer-support-ai`;
- `archivedAt` is `null`.

### Alice adds Bob

```bash
demo_curl --fail --silent \
  -X POST \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/members" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "bob.demo@tokenscope.dev",
    "role": "MEMBER"
  }' | jq
```

Expected:

- response status is `201`;
- returned role is `MEMBER`;
- nested user data contains Bob's safe profile only.

### Bob sees the shared workspace

```bash
demo_curl --fail --silent \
  "$DEMO_API_BASE/organizations" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq

demo_curl --fail --silent \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq

demo_curl --fail --silent \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq
```

Expected:

- Bob's organization list contains `API Acceptance Demo` with role `MEMBER`;
- Bob sees `Customer Support AI`;
- Bob can read its detail.

### A member cannot mutate projects

```bash
demo_curl --silent \
  --output /tmp/tokenscope-member-create.json \
  --write-out '%{http_code}\n' \
  -X POST \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Forbidden Project"
  }'

jq . /tmp/tokenscope-member-create.json
```

Expected:

- status is `403`;
- code is `INSUFFICIENT_ORGANIZATION_ROLE`;
- no project is created.

### Alice promotes Bob to admin

```bash
demo_curl --fail --silent \
  -X PATCH \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/members/$BOB_USER_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "ADMIN"
  }' | jq
```

Bob can now create a project:

```bash
demo_curl --fail --silent \
  -X POST \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin Project"
  }' | jq
```

The same JWT now succeeds because the backend reads Bob's current database role
instead of embedding a stale role in the token.

### The last owner cannot be demoted

Extract Alice's ID:

```bash
ALICE_USER_ID=$(
  printf '%s' "$ALICE_AUTH_JSON" | jq -r '.user.id'
)
```

Attempt to demote Alice while she is the only owner:

```bash
demo_curl --silent \
  --output /tmp/tokenscope-last-owner.json \
  --write-out '%{http_code}\n' \
  -X PATCH \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/members/$ALICE_USER_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "MEMBER"
  }'

jq . /tmp/tokenscope-last-owner.json
```

Expected:

- status is `409`;
- code is `LAST_OWNER_REQUIRED`;
- Alice remains `OWNER`.

### Update and archive the project

```bash
demo_curl --fail --silent \
  -X PATCH \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Support Assistant",
    "description": "Updated during the workspace demo"
  }' | jq
```

Expected: the name and description change, while the slug remains
`customer-support-ai`.

Archive:

```bash
demo_curl --fail --silent \
  --output /dev/null \
  -X DELETE \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN"
```

Expected: `204` with no body. The project disappears from active project lists; its detail and a repeated archive return `404 PROJECT_NOT_FOUND`. The organization remains accessible. Both OWNER and ADMIN can archive a project; MEMBER receives `403 INSUFFICIENT_ORGANIZATION_ROLE`. The record and slug remain stored, and there is no restore endpoint.

### Prove cross-tenant isolation

Bob creates his own organization:

```bash
BOB_ORGANIZATION_JSON=$(
  demo_curl --fail --silent \
    -X POST "$DEMO_API_BASE/organizations" \
    -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Bob Private"
    }'
)

BOB_ORGANIZATION_ID=$(
  printf '%s' "$BOB_ORGANIZATION_JSON" | jq -r '.id'
)
```

Alice attempts to read it:

```bash
demo_curl --silent \
  --output /tmp/tokenscope-tenant-isolation.json \
  --write-out '%{http_code}\n' \
  "$DEMO_API_BASE/organizations/$BOB_ORGANIZATION_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN"

jq . /tmp/tokenscope-tenant-isolation.json
```

Expected:

- status is `404`;
- code is `ORGANIZATION_NOT_FOUND`;
- the response reveals no private organization fields.

Also request Alice's archived project under Bob's organization:

```bash
demo_curl --silent \
  --output /tmp/tokenscope-route-mismatch.json \
  --write-out '%{http_code}\n' \
  "$DEMO_API_BASE/organizations/$BOB_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN"

jq . /tmp/tokenscope-route-mismatch.json
```

Expected: `404 PROJECT_NOT_FOUND`.

### Delete (soft-archive) an organization

A wrong slug is rejected:

```bash
demo_curl --silent --output /tmp/tokenscope-org-archive-mismatch.json --write-out '%{http_code}\n' \
  -X DELETE "$DEMO_API_BASE/organizations/$BOB_ORGANIZATION_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirmSlug": "wrong-slug"}'

jq . /tmp/tokenscope-org-archive-mismatch.json
```

Expected: `409 ORGANIZATION_CONFIRMATION_MISMATCH`.

The owner confirms the exact slug:

```bash
BOB_ORGANIZATION_SLUG=$(
  printf '%s' "$BOB_ORGANIZATION_JSON" | jq -r '.slug'
)

demo_curl --silent --output /dev/null --write-out '%{http_code}\n' \
  -X DELETE "$DEMO_API_BASE/organizations/$BOB_ORGANIZATION_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"confirmSlug\": \"$BOB_ORGANIZATION_SLUG\"}"
```

Expected: `204` with no body. Repeating the same request returns
`404 ORGANIZATION_NOT_FOUND`, and the organization no longer appears in
`GET /organizations`. Before archive, an `ADMIN` or `MEMBER` attempting this call receives
`403 INSUFFICIENT_ORGANIZATION_ROLE`; after archive, former members receive
`404 ORGANIZATION_NOT_FOUND`. Accounts and unrelated organizations remain usable.

## Detailed two-browser workspace demo

Starting screen: the HTTPS signup page. These are new UI accounts, separate from the API accounts above. Register Bob first, then follow the Alice steps; sign back in as Bob to check the shared project. Use new names/emails when repeating.

Use a normal browser window for Alice and a private/incognito window for Bob so
their bearer tokens remain separate.

### Alice window

1. Open the rehearsal origin followed by `/signup`.
2. Create `alice.ui@tokenscope.dev`.
3. Verify redirect to `/organizations`.
4. Create organization `UI Demo Organization`.
5. Open the organization.
6. Create project `UI Demo Project`.
7. Open Members and add the already-registered Bob as `MEMBER`.

### Bob window

1. Open the rehearsal origin followed by `/signup` in a private/incognito window.
2. Create `bob.ui@tokenscope.dev` before Alice adds that email.
3. Sign out and sign back in after Alice adds the membership.
4. Verify `UI Demo Organization` appears.
5. Open its projects and `UI Demo Project`.
6. Verify the create-project and member-management controls are absent.
7. Verify project read access and continue with the analytics/search walkthrough. Key management, project mutation and document upload/delete remain restricted to OWNER/ADMIN.

### Isolation check

1. In Bob's window, create `Bob UI Private`.
2. Copy its organization ID from the URL.
3. In Alice's window, manually navigate to that organization URL.
4. Verify Alice sees the not-found/unauthorized page state and no Bob data.

### Session check

In each window:

1. Refresh a protected page and verify the user remains authenticated while the
   access token is valid.
2. Sign out.
3. Verify protected pages redirect to sign-in.
4. Verify the token has been removed from frontend storage.

## Automated checks

From the repository root on the host, with Docker running:

```bash
make test-backend
```

This target installs locked dependencies, checks source/test types, builds the backend, applies migrations and runs unit, HTTP and PostgreSQL integration suites in the separate `tokenscope-test` Compose project. It does not use the rehearsal database. Do not run concurrent test sessions under that fixed project name.

For frontend checks, use host Node.js 24 in the rehearsal checkout (no application service required for these commands):

```bash
cd frontend
npm ci
npm run check
npm run test
npm run build
cd ..
```

Expected: each command exits 0. In development mode, `make frontendcheck` and `make frontendtest` provide container alternatives. Do not use those targets in HTTPS evaluation mode: its frontend container runs Caddy, not Node/npm. Browser tests require a running application and the setup in [Local Development](LOCAL_DEVELOPMENT-eval.md). The runner has Chrome, Firefox and Edge projects; configuration alone does not establish compatibility. See [the current candidate matrix and historical results](BROWSER_COMPATIBILITY-eval.md).

Record actual outputs with commit and environment. Check browser consoles and backend logs for unexpected errors, and verify responses exclude password hashes. Database integration tests establish persistence/authorization separately from mocked HTTP tests; live Gemini behaviour needs separate provider evidence.

## Final acceptance checklist

- [ ] Clean setup completes from committed instructions.
- [ ] Health and database-health endpoints return `200`.
- [ ] Sign-up/sign-in/current-user flow works.
- [ ] Wrong credentials return the documented generic `401`.
- [ ] Organization creation creates exactly one initial owner.
- [ ] Organization lists are membership-scoped.
- [ ] Owner can add, promote/demote, and remove registered users.
- [ ] Last owner cannot be removed or demoted.
- [ ] MEMBER is read-only for project operations.
- [ ] ADMIN can manage projects but cannot manage memberships.
- [ ] OWNER has full organization/project permissions.
- [ ] Project detail requires matching organization and project IDs.
- [ ] Archive is soft, hides the project, and preserves its slug.
- [ ] Cross-tenant requests return concealed `404` responses.
- [ ] Frontend calls the real API and has loading/error/empty states.
- [ ] Refresh and frontend sign-out behave as documented.
- [ ] Browser console and backend logs are clean.
- [ ] Required automated tests pass.
- [ ] All 11 feature walkthrough steps have recorded observed results.
- [ ] Only an OWNER can delete (soft-archive) an organization after typing its exact slug; the organization then returns concealed `404` responses.

## Detailed realtime demonstration

1. Use the catalogue already installed by the evaluation seed and a separate disposable organization/project. Do not load the catalogue again as a seed prerequisite.
2. Open two authorized dashboard sessions on the same project. Both must subscribe
   successfully to the same project. Confirm another project does not receive its notifications.
3. Select the seed's printed `dashboardRange` (by default `[2026-10-01T00:00:00.000Z, 2026-10-02T00:00:00.000Z)`). Generate the live request with the same original `ANCHOR` below; its timestamp belongs to that golden interval, not the recent Analytics Demo window.
4. Send that body to `POST /api/v1/public/traces` with a valid project `X-API-Key`.
   Use a fresh externalId for each demonstration; identical POST replay produces no notification.
5. Confirm one minimal `traces.changed` reaches each authorized viewer, then the dashboard
   fetches fresh analytics with its current applied dates/filters. Under normal local evaluation
   conditions both dashboards should update within two seconds; record the observed delay.
6. Correct the trace with PUT and the current If-Match, then soft-delete with DELETE and
   the new If-Match. Both actual commits must invalidate; no-op PUT must not.
7. Remove a member or archive a parent: affected sockets receive `access.revoked` and
   stop receiving data. Demotion to MEMBER keeps read access. Expired JWT disconnects.
8. Disconnect/reconnect a browser: it must re-subscribe and refetch; no missed-event replay is promised.

The transport regression test is [realtime.spec.ts](../frontend/test/e2e/realtime.spec.ts). Follow [Local Development](LOCAL_DEVELOPMENT-eval.md) for its execution environment. Observe actual chart updates in addition to WebSocket messages.

For a disposable evaluation project, create an API key as OWNER/ADMIN. If you used a custom seed anchor, export that same non-secret `ANCHOR` in this shell first. Stop if request generation fails. Enter it without saving it in shell history, generate a fresh external ID, and send the fixture from the repository root on the host:

```bash
read -r -s -p 'Disposable project API key: ' TOKENSCOPE_KEY
printf '\n'
set -o pipefail
DEMO_TRACE_BODY=$(docker compose exec -T backend npm run --silent eval:request -- live "${ANCHOR:-2026-10-01}" | \
  jq --arg id "rehearsal-$(date +%s)" '.externalId = $id')
demo_curl --fail-with-body -D /tmp/tokenscope-trace-headers.txt \
  -H "X-API-Key: $TOKENSCOPE_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary "$DEMO_TRACE_BODY" \
  "$DEMO_API_BASE/public/traces"
```

Expected: `201`, a trace ID and an `ETag`. Repeat the exact body for a `200` replay without another trace or notification. Keep the returned ID and current ETag for PUT/DELETE; use the operation examples in [Public API](PUBLIC_API.md). Delete the disposable trace and revoke its key after the checks. A soft-deleted external ID cannot be reused for a new execution.

If starting from an empty disposable project with the synthetic catalogue, this insertion gives one trace, 1,000 input tokens, 100 output tokens, USD `0.002100000000`, zero errors and 500 ms average latency. It does not change Support Golden. The fixture's `after_live_insert` totals apply only to an isolated copy of all six golden traces plus this insertion.

## Evaluation evidence

For each evaluation run, record the application commit, date, environment, actions, observed results and report links. Use PASS, FAIL, BLOCKED or NOT RUN in the tables below. These statuses refer to the evaluation run identified in the run record.

### Module evidence map

The selected modules total 16 planned points, not awarded points. Subject references use v21.1. Implementation references identify where to inspect the behaviour; the result column records the evaluation run.

| Module / subject section | Points | Implementation / test reference | Walkthrough | Result and report |
|---|---:|---|---|---|
| Frontend/backend frameworks — IV.1 | 2 | [React router](../frontend/src/router/AppRouter.tsx), [NestJS application](../backend/src/app.module.ts), frontend/backend package scripts | Startup, 1, 11 | NOT RUN — add candidate report. |
| ORM — IV.1 | 1 | [Prisma schema](../backend/prisma/schema.prisma), [migrations](../backend/prisma/migrations), [database suites](../backend/test/database) | Startup, persistence, API checks | NOT RUN — add candidate report. |
| Organization system — IV.3 | 2 | [Organizations](../backend/src/organizations), [memberships](../backend/src/memberships), [projects](../backend/src/projects), database suites | 1, 2, 10; detailed API/browser flows | NOT RUN — add candidate report. |
| Public API — IV.1 | 2 | [Public trace controller](../backend/src/traces/public-traces.controller.ts), [keys](../backend/src/api-keys), [API documentation](PUBLIC_API.md) | 5; external demo only after PR #48 integration | NOT RUN — add candidate report. |
| Realtime — IV.1 | 2 | [Realtime module](../backend/src/realtime), [browser regression](../frontend/test/e2e/realtime.spec.ts) | 6; detailed realtime flow | NOT RUN — add dashboard-refresh evidence. |
| Analytics dashboard — IV.8 | 2 | [Analytics backend](../backend/src/analytics), [expected results](../fixtures/evaluation/expected-results.json), [dashboard](../frontend/src/pages/projects/ProjectDashboard.tsx), [exports](../frontend/src/features/analytics), [browser dashboard spec](../frontend/test/e2e/project-dashboard.spec.ts), [export spec](../frontend/test/e2e/dashboard-export.spec.ts) | 3, 6, 7 | NOT RUN — add candidate report. |
| LLM system interface — IV.4 | 2 | [Assistant contract](API.md#assistant--tse-80--tse-81), [backend](../backend/src/assistant), [UI](../frontend/src/pages/projects/DashboardAssistant.tsx), [browser spec](../frontend/test/e2e/assistant.spec.ts) | 8 | NOT RUN — separate live and controlled-provider results. |
| File upload — IV.1 | 1 | [Document contract](API.md#private-documents--tse-78--tse-79), [upload fixtures](../fixtures/evaluation/uploads-manifest.json), [backend](../backend/src/documents), [UI](../frontend/src/pages/documents/DocumentsPage.tsx), [database tests](../backend/test/database/documents.integration.spec.ts), [browser spec](../frontend/test/e2e/documents.spec.ts) | 9 | NOT RUN — include access, progress and cleanup checks. |
| Advanced search — IV.1 | 1 | [Trace query](../backend/src/traces/dto/trace-query.dto.ts), [read service](../backend/src/traces/trace-reads.service.ts), [Trace Explorer](../frontend/src/pages/projects/TracesPage.tsx), [browser spec](../frontend/test/e2e/trace-explorer.spec.ts) | 4 | NOT RUN — add candidate report. |
| Additional browsers — IV.2 | 1 | TSE-84 browser matrix below | 11 | NOT RUN — add versions and results. |

### Mandatory requirements

These checks apply independently of module points (subject chapters II, III and VI).

| Requirement | Demonstration / evidence | Result |
|---|---|---|
| Web frontend, backend and relational database | Startup, browser-to-API flow and persisted records | NOT RUN |
| Meaningful Git history and team participation | Each member explains contributions, roles and review process | NOT RUN |
| Single-command container startup | Isolated checkout and `make eval-up` | NOT RUN |
| Secure user management | Signup/signin, invalid credentials, Argon2 hashing and session checks | NOT RUN |
| Frontend and backend input validation | Invalid forms and direct API requests | NOT RUN |
| Concurrent users and consistent data | Two browser profiles, isolation and database concurrency tests | NOT RUN |
| Responsive, accessible interface and styling | Desktop/mobile widths, keyboard use and all principal screens | NOT RUN |
| Latest stable Chrome, no console warnings/errors | Versioned browser report and console inspection | NOT RUN |
| Relevant public Privacy/Terms | Step 11, direct reload and failure-state checks | NOT RUN |
| Local secrets ignored; example configuration provided | `.env.example`, ignore rules and sanitized evidence | NOT RUN |
| Clear schema and relationships | Prisma schema/migrations and database checks | NOT RUN |
| HTTPS for browser, script and external API calls | Trusted certificate and the HTTPS examples above | NOT RUN |
| Required English README and AI disclosure | README sections and confirmed team contributions/review details | NOT RUN |
| Individual understanding | Each member explains their request flow, access checks and tests | NOT RUN |

### Browser matrix — TSE-84

Test the complete walkthrough, including search, realtime, exports, assistant, documents, public pages and responsive layout. Record browser-specific limitations. A Chromium automation run is not a Firefox or Microsoft Edge result.

| Browser | Exact version / OS | Application commit | Result / report |
|---|---|---|---|
| Google Chrome (latest stable at evaluation) | To complete. | To complete. | NOT RUN |
| Mozilla Firefox | To complete. | To complete. | NOT RUN |
| Microsoft Edge | To complete. | To complete. | NOT RUN |

### Reused feature evidence

Preserve [EVALUATION.md](EVALUATION.md), including its TSE-88 historical-author report, candidate checks and NOT RUN statuses. Link reports with their original SHA and environment; do not copy an older PASS into this candidate's result column. This guide's run record supplements that evidence, not a replacement evidence ledger. The presence of a test file above does not prove its tests passed.

Link the feature owners' test reports with their tested commits, environments, commands, results and related walkthrough steps. Keep these reports separate from the results of the full evaluation rehearsal.

**To complete with feature owners:** source reports for the module table and TSE-84 browser results. Keep controlled-provider tests separate from live Gemini calls. Record the configured live model/account tier and applicable provider data-handling terms without including credentials.

### Evaluation run record

Complete this record for each rehearsal and link the detailed results from the module and browser tables.

| Field | Value |
|---|---|
| Run date and team member(s) | To complete. |
| Tested application commit(s) | To complete. |
| OS and architecture | To complete. |
| Docker / Compose versions | To complete. |
| Node.js and browser versions, where used | To complete. |
| Checkout, Compose project and HTTPS origin | To complete. |
| Dataset version and effective UTC period | To complete. |
| Gemini model / account tier for live checks | To complete; omit credentials. |
| Commands executed and report locations | To complete. |

| Verification | Result | Observations / report |
|---|---|---|
| Clean-checkout startup, migrations and trusted HTTPS | NOT RUN | To complete. |
| Evaluation data loading and golden checkpoint | NOT RUN | To complete. |
| Optional-provider setup and behaviour without configuration | NOT RUN | To complete. |
| Ordered walkthrough and recovery steps | NOT RUN | To complete. |
| Automated suites | NOT RUN | To complete. |
| Chrome, Firefox and Edge walkthroughs | NOT RUN | See browser matrix. |
| Documentation links, paths and command examples | NOT RUN | To complete. |

Record unresolved issues and their owners with the affected result. Keep the dataset-loading, provider and storage instructions in the setup section up to date with the tested configuration.

### Result entry template

```text
Check / walkthrough step:
Application commit(s):
Date, OS, tool/browser versions:
Account / role and starting screen:
Command or actions:
Expected result:
Observed result:
Status: PASS / FAIL / BLOCKED / NOT RUN
Evidence path/link (credentials removed):
Fixture changes and recovery:
Remaining issue / owner:
```

## Shutdown and repeat runs

From the rehearsal repository root in the same host shell:

```bash
make stop
```

Expected: rehearsal containers stop and data remains. `make start` resumes them. For a persistence check, resume, sign in and confirm a previously created active disposable resource remains.

`make clean` removes containers/network but retains volumes. `make fullclean` deletes the selected Compose project's volumes and local images, including its database and local CA. Use it only for a deliberate reset of the disposable rehearsal environment, after checking `COMPOSE_PROJECT_NAME`; it is not a normal shutdown step. A rebuilt CA must be trusted again. Follow the confirmed loader instructions to restore evaluation data after a reset.

Clear credentials from the shell when finished:

```bash
unset DEMO_ACCOUNT_PASSWORD ALICE_AUTH_JSON BOB_AUTH_JSON
unset ALICE_ACCESS_TOKEN BOB_ACCESS_TOKEN TOKENSCOPE_KEY
```
