# M1 demo and acceptance runbook

> This runbook’s existing numbered procedure verifies the Sprint 1 identity/workspace baseline.
>
> References to M2 placeholders and excluded features apply to that historical baseline. They do not prohibit the evaluation extensions defined in [EVALUATION_ARCHITECTURE.md](./EVALUATION_ARCHITECTURE.md).
>
> The evaluation section below records planned acceptance coverage. A checklist or expected value is not a passing test result.

## Purpose

This runbook is the executable acceptance contract for M1. It starts from a
clean database and proves the complete identity/workspace flow through both the
HTTP API and two browser sessions.

The commands in this document are expected to work before M1 is declared
complete. While backend M1 is under development, a failure identifies unfinished
implementation rather than an alternative contract.

## What the demo proves

- users can sign up, sign in, restore current-user state, and sign out;
- an organization is created with an initial owner;
- an owner can add a registered user and change their role;
- organization and project permissions follow the documented matrix;
- projects can be created, read, updated, and soft-archived;
- cross-organization access is rejected;
- the last owner cannot be removed or demoted;
- frontend routes use the real backend;
- M2 placeholders do not pretend API keys, traces, cost, or dashboards exist.

## Prerequisites

- Docker;
- Docker Compose;
- Make;
- Git;
- `curl`;
- `jq` for the API verification commands;
- ports configured in the local `.env` file are available.

## 1. Start from a clean environment

Clone and select the branch under test:

```bash
git clone git@github.com:lynyam/tokenscope.git
cd tokenscope
git switch <branch-under-test>
```

Create the environment file if it does not exist:

```bash
cp .env.example .env
```

Generate a local signing secret and set `JWT_SECRET` in your local `.env`:

```bash
docker run --rm node:24-alpine \
  node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```

Copy only the generated value into `JWT_SECRET`. Never commit `.env`.

### Destructive reset

The next command deletes the local TokenScope PostgreSQL volume and local
Compose images/volumes. Use it only for this deliberate clean-database demo:

```bash
make fullclean
```

Create the stack, generate Prisma Client, apply migrations, and restart the
services:

```bash
make up
make db-generate
make db-migrate
make restart
```

Do not run `make db-seed` for the authentication demo unless the seed has been
updated to contain valid Argon2id password hashes. The current placeholder hash
strings are data-model fixtures, not login credentials.

Verify services:

```bash
make ps
curl --fail --silent http://localhost:5173/api/v1/health
curl --fail --silent http://localhost:5173/api/v1/health/db
```

Expected response for each health endpoint:

```json
{
  "status": "healthy"
}
```

If startup fails:

```bash
make logs
```

## 2. API acceptance flow

Set the browser-facing API base URL:

```bash
DEMO_API_BASE=http://localhost:5173/api/v1
```

### Create Alice

```bash
ALICE_AUTH_JSON=$(
  curl --fail --silent \
    -X POST "$DEMO_API_BASE/auth/signup" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "alice.demo@tokenscope.dev",
      "password": "Alice-demo-password-2026",
      "displayName": "Alice"
    }'
)

ALICE_ACCESS_TOKEN=$(
  printf '%s' "$ALICE_AUTH_JSON" | jq -r '.accessToken'
)
```

Verify:

```bash
printf '%s' "$ALICE_AUTH_JSON" | jq

curl --fail --silent \
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
  curl --fail --silent \
    -X POST "$DEMO_API_BASE/auth/signup" \
    -H "Content-Type: application/json" \
    -d '{
      "email": "bob.demo@tokenscope.dev",
      "password": "Bob-demo-password-2026",
      "displayName": "Bob"
    }'
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
  curl --fail --silent \
    -X POST "$DEMO_API_BASE/organizations" \
    -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Acme Demo"
    }'
)

ALICE_ORGANIZATION_ID=$(
  printf '%s' "$ALICE_ORGANIZATION_JSON" | jq -r '.id'
)

printf '%s' "$ALICE_ORGANIZATION_JSON" | jq
```

Expected:

- response status is `201`;
- slug is `acme-demo`;
- `currentUserRole` is `OWNER`;
- exactly one initial membership exists for Alice when members are listed.

### Alice creates a project

```bash
PROJECT_JSON=$(
  curl --fail --silent \
    -X POST \
    "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
    -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
      "name": "Customer Support AI",
      "description": "M1 demo project"
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
curl --fail --silent \
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
curl --fail --silent \
  "$DEMO_API_BASE/organizations" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq

curl --fail --silent \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq

curl --fail --silent \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" | jq
```

Expected:

- Bob's organization list contains `Acme Demo` with role `MEMBER`;
- Bob sees `Customer Support AI`;
- Bob can read its detail.

### A member cannot mutate projects

```bash
curl --silent \
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
curl --fail --silent \
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
curl --fail --silent \
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
curl --silent \
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
curl --fail --silent \
  -X PATCH \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Customer Support Assistant",
    "description": "Updated during the M1 demo"
  }' | jq
```

Expected: the name and description change, while the slug remains
`customer-support-ai`.

Archive:

```bash
curl --fail --silent \
  --output /dev/null \
  -X DELETE \
  "$DEMO_API_BASE/organizations/$ALICE_ORGANIZATION_ID/projects/$PROJECT_ID" \
  -H "Authorization: Bearer $ALICE_ACCESS_TOKEN"
```

Expected:

Expected: `204` with no body. Repeating the same request returns
`404 ORGANIZATION_NOT_FOUND`, and the organization no longer appears in
`GET /organizations`. Before archive, an existing `ADMIN` or `MEMBER` receives
`403 INSUFFICIENT_ORGANIZATION_ROLE` for this DELETE. After archive, every
former member receives `404 ORGANIZATION_NOT_FOUND`. The user session remains
valid for other active organizations.

### Prove cross-tenant isolation

Bob creates his own organization:

```bash
BOB_ORGANIZATION_JSON=$(
  curl --fail --silent \
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
curl --silent \
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
curl --silent \
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
curl --silent --output /tmp/tokenscope-org-archive-mismatch.json --write-out '%{http_code}\n' \
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

curl --silent --output /dev/null --write-out '%{http_code}\n' \
  -X DELETE "$DEMO_API_BASE/organizations/$BOB_ORGANIZATION_ID" \
  -H "Authorization: Bearer $BOB_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"confirmSlug\": \"$BOB_ORGANIZATION_SLUG\"}"
```

Expected: `204` with no body. Repeating the same request returns
`404 ORGANIZATION_NOT_FOUND`, and the organization no longer appears in
`GET /organizations`. An `ADMIN` or `MEMBER` attempting the same call receives
`403 INSUFFICIENT_ORGANIZATION_ROLE`.

## 3. Two-browser frontend demo

Use a normal browser window for Alice and a private/incognito window for Bob so
their bearer tokens remain separate.

### Alice window

1. Open `http://localhost:5173/signup`.
2. Create `alice.ui@tokenscope.dev`.
3. Verify redirect to `/organizations`.
4. Create organization `UI Demo Organization`.
5. Open the organization.
6. Create project `UI Demo Project`.
7. Open Members and add the already-registered Bob as `MEMBER`.

### Bob window

1. Open `http://localhost:5173/signup` in a private/incognito window.
2. Create `bob.ui@tokenscope.dev` before Alice adds that email.
3. Sign in after Alice adds the membership.
4. Verify `UI Demo Organization` appears.
5. Open its projects and `UI Demo Project`.
6. Verify the create-project and member-management controls are absent.
7. Verify the M2 placeholders are visible but no API-key, trace, cost, or
   dashboard action is active.

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

### Documents page (TSE-79)

Documents are stored privately for project members. They are not used by the
assistant. Use `UI Demo Project` with Alice (OWNER) and Bob (MEMBER); small
sample files are in `fixtures/evaluation/uploads/`.

1. As Alice, open the project and choose **Documents**
   (`/organizations/:organizationId/projects/:projectId/documents`).
2. Verify the empty state only appears after the list has loaded.
3. Choose `sample-brief.pdf`. Verify nothing is sent until **Upload** is pressed.
4. Press **Upload**. Verify the progress bar, then **Processing file…** once all
   bytes are sent. The document appears only after the server answers `201`.
5. Try `empty.txt` and a renamed `.exe`: both are refused locally with an inline message.
   `malformed.pdf` and `invalid-utf8.txt` pass the local checks and are rejected by the server.
6. **Preview** the PDF (first page, "Page 1 of N"), `sample-guide.md` and
   `sample-policy.txt` (escaped plain text, first 100 KiB). Close and reopen each.
7. **Download** a file and compare its bytes with the fixture (`cmp`).
8. As Bob (MEMBER): the list, **Preview** and **Download** work; there is no upload form and no **Delete**.
9. As Alice, **Delete** a document: Cancel sends nothing; confirming removes the row and the list refreshes.
10. Archive the project and reload the page: an unavailable message appears and Alice stays signed in.

## 4. Automated checks

Run from the repository root:

```bash
make test-backend
make frontendcheck
```

`make test-backend` installs locked dependencies, checks source and test types,
builds the backend, applies migrations, and runs unit, HTTP, and PostgreSQL
integration suites in the isolated test Compose project.

Expected:

- all commands exit with status 0;
- tenant isolation, role rules, and last-owner protection have PostgreSQL
  coverage; unit and HTTP contract tests may substitute dependencies;
- the database suite uses the isolated test Compose project;
- browser console has no unexpected error or warning;
- backend logs have no unexpected exception;
- no API response contains `passwordHash`.

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
- [ ] OWNER has full M1 organization/project permissions.
- [ ] Project detail requires matching organization and project IDs.
- [ ] Archive is soft, hides the project, and preserves its slug.
- [ ] Cross-tenant requests return concealed `404` responses.
- [ ] Frontend calls the real API and has loading/error/empty states.
- [ ] Refresh and frontend sign-out behave as documented.
- [ ] Browser console and backend logs are clean.
- [ ] Required automated tests pass.
- [ ] API keys, traces, cost calculation, and dashboards remain M2 scope.
- [ ] Only an OWNER can delete (soft-archive) an organization after typing its exact slug; the organization then returns concealed `404` responses.

## Evaluation acceptance extension — planned

TSE-83 owns the executable evaluation runbook. TSE-85 records results against the final candidate.

For each verification, record:

- Commit SHA and environment.
- Exact command or browser steps.
- Expected and observed behavior.
- PASS, FAIL, BLOCKED or NOT RUN.
- Relevant safe evidence and known limitations.

Do not reuse older test totals as fresh evidence.

### Required integrated journeys

| Area | Required demonstration |
|---|---|
| Deployment | Trusted HTTPS, direct-route reload, readiness and persistence |
| Workspace | Real auth, memberships, role restrictions, last-owner protection and isolation |
| Organization archive | OWNER confirmation, retained data, inaccessible children and unchanged user session |
| API keys | One-time disclosure, public use, revocation and archived-parent rejection |
| Public traces | Create, identical replay, read, list, versioned correction and soft deletion |
| Search | Combined filters, stable sorting and 51-record pagination |
| Analytics | Exact totals, dates, filters, empty state and coherent snapshots |
| Realtime | Two clients, committed changes, reconnect repair and access revocation |
| Exports | CSV/PDF match the captured displayed snapshot, including empty and filtered results |
| Documents | Validated upload, role restrictions, private preview/download and eventual file cleanup |
| Assistant | Fixed context, streamed answer, Stop, errors, access loss and deliberate live Gemini call |
| Browsers | Chrome, Firefox and Edge evidence |
| Public pages | Accessible Privacy/Terms reflecting actual implementation |

### API keys management UI — TSE-74

Status: NOT RUN. These steps can be performed by hand. `frontend/test/e2e/api-keys.spec.ts` automates the same journey against a running stack (see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md)); a skipped journey is not a pass.

Use Alice (OWNER) and Bob (MEMBER) in two browser windows, as in section 3. Never record a real key: take screenshots before the key is displayed or with the key field hidden, and keep it out of notes, logs and shared recordings.

| # | Steps | Expected |
|---|---|---|
| 1 | Alice opens `UI Demo Project` and selects **API keys** | The list loads; with no key it reads "No API keys yet." |
| 2 | Alice creates a key named `Demo writer` | A dialog shows the full key once, with a Copy button and the scope wording |
| 3 | Alice clicks **Copy** and pastes into a scratch editor | "Copied to clipboard." appears only after the clipboard accepted the key; the pasted value is complete |
| 4 | Alice closes the dialog and reloads the page | The list shows the name, the prefix and `Active`; the full key appears nowhere |
| 5 | Alice clicks **Revoke**, then **Cancel** | No request is sent (browser network tab) |
| 6 | Alice clicks **Revoke**, then **Revoke key** | The row shows `Revoked` and a date after the list refresh |
| 7 | Bob opens the same URL | A permission-denied message, no controls and no list request |
| 8 | Alice archives the project and reopens the page | "Project not found." and no list request (the backend would answer 404 for an archived project) |
| 9 | Before revocation, use the UI-created key to POST a canonical trace; after UI revocation, GET that trace with the same key | POST returns 201; the JWT project detail endpoint finds the trace in the intended project; after revocation the public GET returns 401 INVALID_API_KEY |
| 10 | Alice creates a key, then presses Escape on the secret dialog | "Close without saving?" appears and the key stays visible; a second Escape goes back to the key |
| 11 | With the secret dialog open, Alice clicks outside it, then **Close and discard** | The same confirmation appears; after **Close and discard** the key is gone and cannot be shown again |

Public clients send the key in exactly one header. A JWT is not accepted there, and the key is not accepted on browser workspace routes (see [API.md](./API.md)). The public trace routes and interactive documentation at `/api/v1/public/docs` are available:

```sh
curl "$TOKENSCOPE_ORIGIN/api/v1/public/traces" -H "X-API-Key: <PROJECT_API_KEY>"
```

For each row record the commit SHA, the environment, PASS, FAIL, BLOCKED or NOT RUN, and safe evidence only.

### Canonical analytics fixture

Use the full UTC day:

```text
from = 2026-10-01T00:00:00.000Z
to   = 2026-10-02T00:00:00.000Z
```

If the explicit seed anchor changes, shift fixture dates and examples consistently. Never rely on old fixture records remaining inside “Last 7 days.”

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

### Evidence boundaries

- Fixtures do not automatically populate the application.
- Evaluation seeding is explicit and uses an operator-supplied password.
- Normal startup must not reset or seed user data.
- Mocked HTTP tests do not prove database authorization.
- Simulated streams do not prove a working Gemini account.
- A Chromium run does not prove Firefox or actual Edge compatibility.
- Export/download existence alone does not prove correct contents.
- A passing retry does not erase an unexplained flaky failure.

The 16-point figure remains a target until complete functionality and the subject’s requirements have been demonstrated.

### Assistant demo — TSE-80

Backend/proxy check (golden project loaded as in
LOCAL_DEVELOPMENT.md, "Dashboard assistant — TSE-80 / TSE-81").
The UI demonstration follows under "Dashboard assistant UI — TSE-81":

1. Select the golden period: `2026-10-01T00:00:00.000Z` to `2026-10-02T00:00:00.000Z`, no filters.
2. Ask: "Which model contributes most to the estimated cost?"
3. Show `start`: its `context` has the scope, the generation time, 6 traces,
   `"0.015350000000"` USD and `containsSyntheticPricing: true`.
4. Show the `delta` lines arriving over time, then `done`.
5. The answer should name `fixture-b/demo-large` (`"0.008200000000"`) and say the
   prices are synthetic. Do not expect exact wording.
6. Stop: run the same request and interrupt it. An immediate new question
   is accepted (`200`, not `429`).
7. Access loss: while an answer streams, remove the member or archive the
   project; the stream ends with an `error` event `PROJECT_NOT_FOUND` within 5 seconds.

`backend/test/manual/assistant-proxy-check.sh` runs steps 2–6 through the
Vite proxy or the evaluation HTTPS proxy. It uses real Gemini quota.

### Canonical evaluation data

Fixture inputs and expected responses are available under
fixtures/evaluation/. Read its README for consumers and lifecycle rules.

The golden period is 2026-10-01T00:00:00.000Z inclusive through
2026-10-02T00:00:00.000Z exclusive.

The six golden traces total 0.015350000000 USD in synthetic
estimated cost.

TSE-70 owns loading usable evaluation data. Fixture presence alone
does not demonstrate implemented feature endpoints or live Gemini
integration.

## Private documents — TSE-78 manual check

Replace the variables with a real organization and an owner access token.

```bash
# Use a fresh, active project: the archive step above made the earlier $PROJECT_ID inaccessible.
PROJECT_ID=$(curl --fail --silent -X POST "$DEMO_API_BASE/organizations/$ORG_ID/projects" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Documents demo"}' | jq -r '.id')

P="$DEMO_API_BASE/organizations/$ORG_ID/projects/$PROJECT_ID/documents"
H="Authorization: Bearer $TOKEN"

printf 'hello' > /tmp/demo.txt
DOC_ID=$(curl --fail --silent -H "$H" -F "file=@/tmp/demo.txt" "$P" | jq -r '.id')   # upload: 201 summary, no storage key
curl -s -H "$H" "$P"                                          # list, newest first
curl -s -H "$H" "$P/$DOC_ID/content"                          # hello
curl -s -D - -o /dev/null -H "$H" "$P/$DOC_ID/content?download=true"   # attachment, nosniff, no-store
```

Member access (before the document is deleted):

```bash
# Add a second user as MEMBER (see section 2), then:
curl -s -H "Authorization: Bearer $MEMBER_TOKEN" "$P/$DOC_ID/content"        # 200, same bytes
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $MEMBER_TOKEN" -F "file=@/tmp/demo.txt" "$P"   # 403

curl -s -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $MEMBER_TOKEN" "$P/$DOC_ID"   # 403
```

Delete, then archive retention:

```bash
curl -s -X DELETE -o /dev/null -w '%{http_code}\n' -H "$H" "$P/$DOC_ID"  # 204
curl -s -X DELETE -o /dev/null -w '%{http_code}\n' -H "$H" "$P/$DOC_ID"  # 404

# Upload one more document, then archive the project: access is denied, files are kept.
curl -s -o /dev/null -H "$H" -F "file=@/tmp/demo.txt" "$P"
curl --fail --silent -X DELETE -H "$H" "$DEMO_API_BASE/organizations/$ORG_ID/projects/$PROJECT_ID"
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" "$P"   # 404 PROJECT_NOT_FOUND
docker compose exec backend ls -R /var/lib/tokenscope/documents                    # the bytes are still there
```

Expected rejections: a `.docx` file gives `415`, a text file with invalid UTF-8 gives `422`, an 11 MiB file gives `413`, the sixth upload within a minute gives `429` with `Retry-After`, and a member token gives `403` on upload or delete.
### Trace Explorer (read-only)

Open a project, then **Traces**. The list shows UTC time, provider/model, workflow, tokens, estimated cost,
latency and status for the last seven days (resolved to explicit dates in the URL). For the golden period use:

```
/organizations/<org>/projects/<project>/traces?from=2026-10-01T00:00:00.000Z&to=2026-10-02T00:00:00.000Z
```

Search, filters, sorting and paging all live in the URL, so a copied link reproduces the screen.
Integration and shared-filter ownership:
`docs/EVALUATION_ARCHITECTURE.md`, “Frontend Trace Explorer integration — TSE-75”.
Realtime refresh remains pending shared frontend client integration.

## Realtime handoff — TSE-73 / TSE-76

1. Load the documented synthetic price catalogue and use a disposable organization/project.
2. Open two authorized dashboard sessions when TSE-76 is integrated. Both must subscribe
   successfully to the same project. Confirm another project does not receive its notifications.
3. Select `[2026-10-01T00:00:00.000Z, 2026-10-02T00:00:00.000Z)` for the supplied
   `fixtures/evaluation/realtime/live-trace-request.json`; its timestamp is historical.
4. Send that body to `POST /api/v1/public/traces` with a valid project `X-API-Key`.
   Use a fresh externalId for each demonstration; identical POST replay produces no notification.
5. Confirm one minimal `traces.changed` reaches each authorized viewer, then the dashboard
   fetches fresh analytics with its current applied dates/filters. Under normal local evaluation
   conditions both dashboards should update within two seconds (TSE-76 integrated evidence).
6. Correct the trace with PUT and the current If-Match, then soft-delete with DELETE and
   the new If-Match. Both actual commits must invalidate; no-op PUT must not.
7. Remove a member or archive a parent: affected sockets receive `access.revoked` and
   stop receiving data. Demotion to MEMBER keeps read access. Expired JWT disconnects.
8. Disconnect/reconnect a browser: it must re-subscribe and refetch; no missed-event replay is promised.

Before the dashboard is available, run `frontend/test/e2e/realtime.spec.ts` in development
and HTTPS evaluation modes using LOCAL_DEVELOPMENT.md. Record commit, mode, commands and
actual results. Transport-only evidence must not be presented as a completed dashboard demo.

For a disposable evaluation project, set `TOKENSCOPE_KEY` locally and send the fixture:

```sh
curl --fail-with-body --cacert .local/eval/caddy-root.crt \
  -H "X-API-Key: $TOKENSCOPE_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary @fixtures/evaluation/realtime/live-trace-request.json \
  https://localhost:8443/api/v1/public/traces
```

Keep the returned trace id and ETag for PUT/DELETE. Do not commit the key.


### Project Overview dashboard — TSE-76

1. Load the canonical price catalogue explicitly and ingest the six golden traces into a disposable project.
2. Open its Overview and apply `2026-10-01T00:00:00.000Z` to `2026-10-02T00:00:00.000Z`.
3. Confirm 6 traces, 6,000 input tokens, 1,200 output tokens and estimated cost USD 0.015350000000.
4. Open each chart's exact-value table and operate its legend with the keyboard.
5. Open the project in two authorized browser contexts and wait for Live.
6. Ingest `fixtures/evaluation/realtime/live-trace-request.json` with a new externalId.
   Its fixed occurrence time is inside the selected golden period. Both dashboards must update within two seconds.
7. Correct and delete that new trace with its current ETag; both dashboards must refetch authoritative totals.
8. Disconnect one browser, write again, reconnect and verify recovery. Remove a member and confirm their
   project content disappears while their login remains valid.
9. For genuinely current traces, deliberately choose a custom UTC window covering their occurrence times.
   Presets resolve once: Live does not silently advance their upper boundary.

Record dev and trusted-HTTPS browser results separately. Dashboard realtime does not establish
that Explorer realtime is integrated; verify that separately in TSE-87.


### Dashboard assistant UI — TSE-81

This is an **opt-in live Gemini check**, not the intercepted Playwright suite.
Use a disposable project, backend-only Gemini configuration and the canonical
catalogue + six golden traces described in LOCAL_DEVELOPMENT.md. Do not load
transcripts into the application or use uploaded documents as assistant context.

1. Sign in as an organization member and open the project detail's Analytics dashboard.
   Apply `2026-10-01T00:00:00.000Z` to `2026-10-02T00:00:00.000Z`, without filters.
2. Open **Ask assistant**. Confirm no assistant POST occurs until Ask. Read the disclosure.
3. Ask which model contributes most to estimated cost. In Network verify one authenticated
   POST containing only `question`, `from`, `to`, `filters`; do not export credentials.
4. In **Context used**, verify six traces, 6,000 input + 1,200 output = 7,200 total tokens,
   `$0.01535` (wire value `0.015350000000`), explicit UTC dates, generation timestamp
   and synthetic pricing. Verify visible text arrives before completion, without
   asserting exact Gemini wording. The expected highest-cost group is fixture-b/demo-large.
5. Refresh dashboard data for the same selection: the answer/context stay unchanged.
   Edit a date draft without applying: it also stays. Apply changed dates or filters:
   the answer/context clear, and any current generation is aborted.
6. Deliberately submit another question. While requesting/streaming, click **Stop**.
   Text must stop growing and show **Stopped — answer incomplete**. Verify the backend
   records `assistant_answer` with `outcome: client_left` for that request. If it had
   already completed, that attempt did not test cancellation; record it honestly.
7. After cleanup, explicitly Ask again: one new request may succeed; no automatic retry.
   Close and reopen: question, context and answer are cleared. Test keyboard Escape too.
8. Repeat generation and Stop through `https://localhost:8443`, with the real CA trusted.
   Use a fresh rate-limit window between runs. A timeout/quota failure is a visible failure,
   not proof of successful streaming. Never change deadlines just to get this check green.

OWNER, ADMIN and MEMBER mounting, deterministic failures and scope handling are also
covered by `assistant.spec.ts`; those assistant responses are intercepted. Keep that
result separate from this live-provider proof. Record commit, mode, results and limits;
redact JWTs, API keys and Gemini credentials from evidence.

### Dashboard exports — TSE-77 manual check

Use a project containing the six golden traces with the synthetic catalogue
loaded. Open its Analytics section; apply the exact UTC period
`2026-10-01T00:00:00.000Z` to `2026-10-02T00:00:00.000Z` (exclusive end).

1. Confirm six traces, 6000 input tokens, 1200 output tokens and estimated cost
   USD 0.01535. Export CSV and PDF; neither click should request analytics again.
2. CSV has 24 columns and 27 data rows: one summary, 24 series buckets and two
   models. Its summary cost is exactly `0.015350000000`. Selection metadata and
   snapshot identity agree across every row.
3. Open the actual PDF. Check project identity, generated time, UTC period,
   filters, summary, all model/series rows, repeated table headers, page numbers
   and the estimate/synthetic-pricing note. Check wrapping with a long name.
4. Filter `provider=fixture-a`: three traces and cost `0.007150000000`. Both files
   describe that filter. Then select an empty period: export stays available,
   series contains zero buckets and PDF null averages/rates say `No observations`.
5. While a new applied selection loads, exports are disabled. A same-selection
   refresh can export the last displayed snapshot. Sign-out, access loss or
   navigation must discard pending downloads; generation failure offers Retry.
6. Verify a name such as `Équipe Ελληνικά Кириллица` visually. DejaVu Sans does
   not cover all accepted Unicode characters (notably CJK and some emoji): do
   not count that test as proof of unrestricted Unicode coverage. Broader font
   coverage remains an acceptance gap until a font/fallback is supplied and tested.

Run in development and HTTPS evaluation mode using the setup in
`docs/LOCAL_DEVELOPMENT.md`, “Dashboard export checks — TSE-77”. Record the tested
commit/mode and distinguish automated download checks from visual PDF inspection.
