# M1 demo and acceptance runbook

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
cp .env.exemple .env
```

The repository currently names the committed template `.env.exemple`. If that
file is later renamed, update this runbook in the same pull request.

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

- archive returns `204`;
- the project disappears from the active-project list;
- direct detail and a second archive attempt return `404 PROJECT_NOT_FOUND`.

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

## 4. Automated checks

Run from the repository root:

```bash
make test-db-fresh
make frontendcheck
make backeNDcheck
```

M1 should also expose one command that runs backend unit/controller/end-to-end
tests. When that command is added, place it here and in the Makefile in the same
pull request.

Expected:

- all commands exit with status 0;
- no test relies only on in-memory authorization mocks;
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
