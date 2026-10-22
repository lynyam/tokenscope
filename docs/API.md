
# TokenScope API contracts

## Purpose

This document owns TokenScope’s external contracts.

The identity, organization, membership and project sections describe the Sprint 1 baseline present at `854da94`.

The evaluation extensions section contains both implemented contracts and
agreed contracts awaiting implementation. Implementation-status notes identify
the delivered scope; a documented route alone does not prove implementation.

The public trace API guide is [PUBLIC_API.md](./PUBLIC_API.md).

See [EVALUATION_ARCHITECTURE.md](./EVALUATION_ARCHITECTURE.md) for feature ownership and integration boundaries.

Controllers, frontend adapters, tests and examples must agree with these contracts. A feature PR must update its implementation status when the contract is delivered.

## Conventions

### Base URL

```text
/api/v1
```

Examples use the browser-facing local URL:

```text
http://localhost:5173/api/v1
```

The Vite development proxy forwards `/api/v1/*` to the backend without
removing the prefix.

### JSON

- JSON endpoints use application/json. Explicitly documented multipart uploads, binary responses and SSE streams use their own content types.
- Successful responses return the documented resource directly; M1 does not
  wrap them in a generic `data` envelope.
- Dates are ISO-8601 UTC strings.
- IDs are UUID strings.
- Unknown request fields are rejected.
- Empty collections use `[]`, never `null`, within the endpoint's documented
  response shape.
- Pagination is not required for M1.

### Authentication

Sprint 1 protected endpoints and evaluation browser APIs require a user JWT as shown below. Public trace endpoints instead require X-API-Key; their authentication contract is defined in the evaluation section. Sign-up, sign-in and health checks remain public.

```http
Authorization: Bearer <access-token>
```

Sign-up and sign-in return a short-lived JWT access token. Organization roles
are not stored in the token; the backend resolves the current membership for
each organization-scoped request.

M1 has no server logout endpoint. Frontend sign-out removes the access token and
clears current-user state. Server-side revocation and refresh tokens are
post-M1 work.

### Request IDs

The backend accepts an optional `X-Request-Id` header. If it is absent or
invalid, the backend generates one. Every response returns the effective value
in `X-Request-Id`, and every error body includes `requestId`.

>A supplied request ID must be a single value containing 1–128 ASCII
>letters, digits, `.`, `_`, `:`, or `-`. Missing or invalid values are
>replaced with a generated UUID. Request IDs are diagnostic metadata
>and do not grant authorization.

### Ordering

M1 list endpoints return records ordered by `createdAt` ascending and then
`id` ascending. This makes the UI and demo deterministic.

## Shared response types

### SafeUser

```json
{
  "id": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
  "email": "alice@example.com",
  "displayName": "Alice"
}
```

`passwordHash` is never present.

### AuthResponse

```json
{
  "user": {
    "id": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
    "email": "alice@example.com",
    "displayName": "Alice"
  },
  "accessToken": "<jwt>",
  "tokenType": "Bearer",
  "expiresIn": 3600
}
```

`expiresIn` is expressed in seconds.

### OrganizationSummary

```json
{
  "id": "3749d96b-4e33-4606-900a-9a319cfa0504",
  "name": "Acme AI",
  "slug": "acme-ai",
  "currentUserRole": "OWNER",
  "createdAt": "2026-09-04T10:00:00.000Z",
  "updatedAt": "2026-09-04T10:00:00.000Z"
}
```

`currentUserRole` is derived from the authenticated user's membership. It is
not stored on `Organization`.

### MembershipWithUser

```json
{
  "id": "ec12d5c4-79fa-4c97-903a-e50698011002",
  "userId": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
  "organizationId": "3749d96b-4e33-4606-900a-9a319cfa0504",
  "role": "OWNER",
  "createdAt": "2026-09-04T10:00:00.000Z",
  "updatedAt": "2026-09-04T10:00:00.000Z",
  "user": {
    "id": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
    "email": "alice@example.com",
    "displayName": "Alice"
  }
}
```

### Project

```json
{
  "id": "cf6cc60b-f681-447f-b12f-112f6bf64546",
  "organizationId": "3749d96b-4e33-4606-900a-9a319cfa0504",
  "name": "Customer Support AI",
  "slug": "customer-support-ai",
  "description": "LLM monitoring for the support workflow",
  "archivedAt": null,
  "createdAt": "2026-09-04T10:05:00.000Z",
  "updatedAt": "2026-09-04T10:05:00.000Z"
}
```

## Endpoint summary

| Method | Path | Authentication | Required organization role |
|---|---|---|---|
| `GET` | `/health` | No | — |
| `GET` | `/health/db` | No | — |
| `POST` | `/auth/signup` | No | — |
| `POST` | `/auth/signin` | No | — |
| `GET` | `/auth/me` | Yes | — |
| `GET` | `/organizations` | Yes | Returns only memberships of current user |
| `POST` | `/organizations` | Yes | Any authenticated user |
| `GET` | `/organizations/:organizationId` | Yes | OWNER, ADMIN, MEMBER |
| `PATCH` | `/organizations/:organizationId` | Yes | OWNER |
| `GET` | `/organizations/:organizationId/members` | Yes | OWNER, ADMIN, MEMBER |
| `POST` | `/organizations/:organizationId/members` | Yes | OWNER |
| `PATCH` | `/organizations/:organizationId/members/:userId` | Yes | OWNER |
| `DELETE` | `/organizations/:organizationId/members/:userId` | Yes | OWNER |
| `GET` | `/organizations/:organizationId/projects` | Yes | OWNER, ADMIN, MEMBER |
| `POST` | `/organizations/:organizationId/projects` | Yes | OWNER, ADMIN |
| `GET` | `/organizations/:organizationId/projects/:projectId` | Yes | OWNER, ADMIN, MEMBER |
| `PATCH` | `/organizations/:organizationId/projects/:projectId` | Yes | OWNER, ADMIN |
| `DELETE` | `/organizations/:organizationId/projects/:projectId` | Yes | OWNER, ADMIN |

All paths in the table are relative to `/api/v1`.

## Health

### GET /health

Returns backend liveness.

Response — `200 OK`:

```json
{
  "status": "healthy"
}
```

### GET /health/db

Returns database readiness.

Response — `200 OK`:

```json
{
  "status": "healthy"
}
```

If PostgreSQL is unavailable, return `503 Service Unavailable` using the
standard error format, with the message `Database is unavailable.`.

## Authentication

### POST /auth/signup

Creates a user and signs them in.

Request:

```json
{
  "email": "alice@example.com",
  "password": "correct-horse-battery-staple",
  "displayName": "Alice"
}
```

Validation:

- `email`: valid email, trimmed, lowercased before lookup/persistence,
  maximum 254 characters;
- `password`: 8–128 characters; it is not trimmed or normalized;
- `displayName`: trimmed, 1–80 characters.

Response — `201 Created`: `AuthResponse`.

Errors:

- `400 VALIDATION_ERROR`;
- `409 EMAIL_ALREADY_EXISTS`.

### POST /auth/signin

Authenticates an existing user.

Request:

```json
{
  "email": "alice@example.com",
  "password": "correct-horse-battery-staple"
}
```

Response — `200 OK`: `AuthResponse`.

Unknown email and wrong password both return the same
`401 INVALID_CREDENTIALS` response.

### GET /auth/me

Returns the authenticated user.

Response — `200 OK`: `SafeUser`.

Errors:

- `401 AUTHENTICATION_REQUIRED`;
- `401 INVALID_ACCESS_TOKEN`;
- `401 ACCESS_TOKEN_EXPIRED`.

## Organizations

### GET /organizations

Returns only organizations in which the current user has a membership.

Response — `200 OK`:

```json
[
  {
    "id": "3749d96b-4e33-4606-900a-9a319cfa0504",
    "name": "Acme AI",
    "slug": "acme-ai",
    "currentUserRole": "OWNER",
    "createdAt": "2026-09-04T10:00:00.000Z",
    "updatedAt": "2026-09-04T10:00:00.000Z"
  }
]
```

### POST /organizations

Creates an organization and its initial `OWNER` membership atomically.

Request:

```json
{
  "name": "Acme AI"
}
```

Validation:

- `name`: trimmed, 1–100 characters.

Response — `201 Created`: `OrganizationSummary` with
`currentUserRole: "OWNER"`.

Errors:

- `400 VALIDATION_ERROR`;
- `409 ORGANIZATION_SLUG_CONFLICT`.

### GET /organizations/:organizationId

Returns an organization only when the current user is a member.

Response — `200 OK`: `OrganizationSummary`.

An unknown organization and an organization inaccessible to the current user
both return `404 ORGANIZATION_NOT_FOUND`.

### PATCH /organizations/:organizationId

Renames an organization. Its slug remains unchanged.

Required role: `OWNER`.

Request:

```json
{
  "name": "Acme Intelligence"
}
```

Response — `200 OK`: updated `OrganizationSummary`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`.

### DELETE /organizations/:organizationId

Soft-archives an organization. The organization row is kept and marked with an
internal `archivedAt` timestamp; nothing is physically deleted. There is no
restore endpoint.

Required role: `OWNER`.

Request:

```json
{
  "confirmSlug": "acme"
}
```

`confirmSlug` is required, must be a non-empty string that is not only
whitespace, and is compared exactly with the organization slug (no trimming,
no case folding). Any other property is rejected.

Response — `204 No Content` with no body.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`;
- `409 ORGANIZATION_CONFIRMATION_MISMATCH`;
- `409 CONCURRENT_MODIFICATION`.

The role is checked before the slug is compared, so a caller who is not an
`OWNER` never learns whether a submitted slug is correct. An unknown
organization, an organization the caller does not belong to, and an already
archived organization all return `404 ORGANIZATION_NOT_FOUND`; a second
deletion therefore returns `404`. `CONCURRENT_MODIFICATION` is returned when
competing writes still conflict after three bounded attempts.

Once an organization is archived, it no longer appears in `GET /organizations`,
and its organization, membership, and project endpoints behave as if it did not
exist: `404 ORGANIZATION_NOT_FOUND` for organization, membership, project list,
and project creation routes, and `404 PROJECT_NOT_FOUND` for single-project
routes. `OrganizationSummary` is unchanged and never exposes `archivedAt`. An
archived organization keeps reserving its slug.

## Memberships

Both `organizationId` and the target `userId` route parameters must be UUIDs.
The actor comes from the verified bearer token; clients cannot set it in the
request body. An invalid route UUID returns `400 VALIDATION_ERROR`.

### GET /organizations/:organizationId/members

Returns the organization's memberships with safe user data and the
authenticated user's role.

Required role: any organization member.

Response — `200 OK`:

```json
{
  "memberships": [
    {
      "id": "ec12d5c4-79fa-4c97-903a-e50698011002",
      "userId": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
      "organizationId": "3749d96b-4e33-4606-900a-9a319cfa0504",
      "role": "OWNER",
      "createdAt": "2026-09-04T10:00:00.000Z",
      "updatedAt": "2026-09-04T10:00:00.000Z",
      "user": {
        "id": "8e32b232-eeda-4c5e-bbf0-427e799ff076",
        "email": "alice@example.com",
        "displayName": "Alice"
      }
    }
  ],
  "currentUserRole": "OWNER"
}
```

Errors:

- `404 ORGANIZATION_NOT_FOUND`.

### POST /organizations/:organizationId/members

Adds an already-registered user by email.

Required role: `OWNER`.

Request:

```json
{
  "email": "bob@example.com",
  "role": "MEMBER"
}
```

`role` is optional and defaults to `MEMBER`. If supplied, it must be
`OWNER`, `ADMIN`, or `MEMBER`; `null` is invalid.

`email` is required, trimmed, lowercased, validated as an email address, and
limited to 254 characters after normalization. The user must already exist.

Response — `201 Created`: `MembershipWithUser`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`;
- `404 USER_NOT_FOUND`;
- `409 MEMBERSHIP_ALREADY_EXISTS`.

Invitation email and creation of an unregistered user are out of scope.

### PATCH /organizations/:organizationId/members/:userId

Changes an existing member's organization-scoped role.

Required role: `OWNER`.

`role` is required and must be `OWNER`, `ADMIN`, or `MEMBER`. Empty bodies,
`null` roles, and unknown fields return `400 VALIDATION_ERROR`.

Request:

```json
{
  "role": "ADMIN"
}
```

Response — `200 OK`: updated `MembershipWithUser`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`;
- `404 MEMBERSHIP_NOT_FOUND`;
- `409 LAST_OWNER_REQUIRED`.

Setting the same role is idempotent and returns `200 OK` without changing
`updatedAt`. An owner may demote themselves only when another owner remains.

### DELETE /organizations/:organizationId/members/:userId

Removes the membership, not the global user.

Required role: `OWNER`.

Response — `204 No Content`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`;
- `404 MEMBERSHIP_NOT_FOUND`;
- `409 LAST_OWNER_REQUIRED`.

An owner may remove themselves only when another owner remains.

## Projects

### GET /organizations/:organizationId/projects

Returns active projects belonging to the organization.

Required role: any organization member.

Response — `200 OK`:

```json
[
  {
    "id": "cf6cc60b-f681-447f-b12f-112f6bf64546",
    "organizationId": "3749d96b-4e33-4606-900a-9a319cfa0504",
    "name": "Customer Support AI",
    "slug": "customer-support-ai",
    "description": "LLM monitoring for the support workflow",
    "archivedAt": null,
    "createdAt": "2026-09-04T10:05:00.000Z",
    "updatedAt": "2026-09-04T10:05:00.000Z"
  }
]
```

Archived projects are omitted.

### POST /organizations/:organizationId/projects

Creates a project inside the organization.

Required role: `OWNER` or `ADMIN`.

Request:

```json
{
  "name": "Customer Support AI",
  "description": "LLM monitoring for the support workflow"
}
```

Validation:

- `name`: trimmed, 1–100 characters;
- `description`: optional, trimmed, maximum 2,000 characters; an empty value
  is stored as `null`.

Response — `201 Created`: `Project`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 ORGANIZATION_NOT_FOUND`;
- `409 PROJECT_SLUG_CONFLICT`.

### GET /organizations/:organizationId/projects/:projectId

Returns one active project only when it belongs to the organization in the URL
and the current user belongs to that organization.

Required role: any organization member.

Response — `200 OK`: `Project`.

An unknown project, an archived project, a project from another organization,
and a project inaccessible to the user all return `404 PROJECT_NOT_FOUND`.

### PATCH /organizations/:organizationId/projects/:projectId

Updates an active project.

Required role: `OWNER` or `ADMIN`.

At least one field must be supplied.

Request:

```json
{
  "name": "Support Assistant",
  "description": null
}
```

`null` clears the description. Renaming a project does not change its slug.

Response — `200 OK`: updated `Project`.

Errors:

- `400 VALIDATION_ERROR`;
- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 PROJECT_NOT_FOUND`.

### DELETE /organizations/:organizationId/projects/:projectId

Soft-archives an active project by setting `archivedAt`. It does not delete
the database record.

Required role: `OWNER` or `ADMIN`.

Response — `204 No Content`.

Errors:

- `403 INSUFFICIENT_ORGANIZATION_ROLE`;
- `404 PROJECT_NOT_FOUND`.

There is no project-restore endpoint in M1. The archived project continues to
reserve its slug.

## Error contract

Every expected API failure uses:

```json
{
  "statusCode": 403,
  "code": "INSUFFICIENT_ORGANIZATION_ROLE",
  "error": "Forbidden",
  "message": "You are not allowed to perform this action.",
  "requestId": "req_01J6Y7CQB56W7YZT68Q5YMG9T3"
}
```

Validation errors add field details:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "error": "Bad Request",
  "message": "Request validation failed.",
  "details": [
    {
      "field": "email",
      "messages": ["email must be an email"]
    }
  ],
  "requestId": "req_01J6Y7CQB56W7YZT68Q5YMG9T3"
}
```

Nested validation fields use dot-separated paths, such as child.name.
Validation errors that cannot identify a field use body.
Details contain only field and messages.

### Default code table
| Status | Meaning |
|---:|---|
| `400` | Body, route parameter, or query validation failed |
| `401` | Authentication is absent, invalid, or expired |
| `403` | The user belongs to the organization but lacks the required role |
| `404` | The resource does not exist or is concealed from this caller |
| `409` | A unique/business invariant conflicts with the requested change |
| `500` | Unexpected server failure; internal details are not exposed |
| `503` | A required dependency such as PostgreSQL is unavailable |

Backend application error logs contain the request ID, HTTP method,
matched route template, status code, and application error code.
Unmatched routes are logged as <unmatched>.

Responses and application logs never include raw exception objects,
stack traces, SQL, database-driver messages, request bodies,
Authorization headers, passwords, hashes, tokens, or secrets.

| HTTP status | Default application code  |
| ----------- | ------------------------- |
| 400         | `VALIDATION_ERROR`        |
| 401         | `AUTHENTICATION_REQUIRED` |
| 403         | `FORBIDDEN`               |
| 404         | `NOT_FOUND`               |
| 409         | `CONFLICT`                |
| 413         | `PAYLOAD_TOO_LARGE`       |
| 415         | `UNSUPPORTED_MEDIA_TYPE`  |
| 500         | `INTERNAL_SERVER_ERROR`   |
| 503         | `SERVICE_UNAVAILABLE`     |

Explicit application exceptions use the more specific codes documented
for each endpoint. Every 500 response uses the generic
INTERNAL_SERVER_ERROR code and message.

Other recognized HTTP errors retain their status and receive a generic
HTTP_ERROR code for 4xx responses or INTERNAL_SERVER_ERROR for 5xx
responses. Unexpected non-HTTP exceptions return 500.

## Frontend integration requirements

- Keep HTTP calls in `frontend/src/api/*.api.ts`.
- Use one shared client/helper for base URL, JSON, bearer token, and error
  parsing.
- Replace `MockApiError` with an API error type matching this document.
- Replace mock account/password/session persistence; never send or store
  `passwordHash`.
- Extend the frontend domain types with the response fields documented here.
- Clear the token and user state on frontend sign-out and on an unrecoverable
  `401`.
- Do not redirect on `403` or `404` until the page can display the relevant
  error state.
- UI role checks may hide controls, but they never replace backend
  authorization.

## Contract-change rule

A pull request that changes an endpoint, DTO, status code, response shape,
permission, slug rule, or archive rule must update:

1. this document;
2. the relevant backend tests;
3. the frontend API/type layer;
4. [SECURITY.md](./SECURITY.md) or [DATA_MODEL.md](./DATA_MODEL.md) when the changed behavior affects those
   contracts.

## Evaluation extensions — contracts and implementation status

The extensions below were planned at baseline `854da94`.
Feature-specific implementation-status notes record subsequently delivered
scope. Sections without a delivered-status note remain agreed targets.

Existing Sprint 1 routes and response shapes remain compatible unless an explicit extension below changes their behavior.

Paths below are relative to `/api/v1`.

For project routes, `P` abbreviates:

```text
/organizations/:organizationId/projects/:projectId
```

`P` is documentation notation, not a literal URL segment.

### Authentication and route ownership

| Operation | Route | Authentication | Permission |
|---|---|---|---|
| Archive organization | `DELETE /organizations/:organizationId` | JWT | OWNER |
| List/create API keys | `GET/POST P/api-keys` | JWT | OWNER, ADMIN |
| Revoke API key | `DELETE P/api-keys/:apiKeyId` | JWT | OWNER, ADMIN |
| Create/list traces | `POST/GET /public/traces` | `X-API-Key` | Verified project credential |
| Read/replace/delete trace | `GET/PUT/DELETE /public/traces/:traceId` | `X-API-Key` | Verified project credential |
| Browser trace list/detail | `GET P/traces`, `GET P/traces/:traceId` | JWT | Any organization member |
| Analytics | `GET P/analytics` | JWT | Any organization member |
| Assistant | `POST P/assistant` | JWT | Any organization member |
| List documents | `GET P/documents` | JWT | Any organization member |
| Upload document | `POST P/documents` | JWT | OWNER, ADMIN |
| Read document bytes | `GET P/documents/:documentId/content` | JWT | Any organization member |
| Delete document | `DELETE P/documents/:documentId` | JWT | OWNER, ADMIN |

All project browser operations require current membership, an active organization and an active project belonging to that organization.

JWTs and project API keys are not interchangeable.

There is no backend dashboard-export endpoint.

### Organization archive — TSE-66

Request:

```http
DELETE /api/v1/organizations/:organizationId
Content-Type: application/json
Authorization: Bearer <JWT>
```

```json
{
  "confirmSlug": "acme-demo"
}
```

Accept only the required `confirmSlug` string. Reject missing, empty,
whitespace-only and non-string values with `400 VALIDATION_ERROR`.
Reject unknown properties.

Compare the submitted value exactly with the stored slug; do not trim
or lowercase it into a match. A nonblank value that does not match
returns `409 ORGANIZATION_CONFIRMATION_MISMATCH`.

For stored `acme-demo`:

- `acme-demo` matches.
- `Acme-Demo` does not.
- `acme-demo ` does not.

After authentication and valid input, verify access and OWNER permission before comparing the confirmation.

Results:

- `204`: organization archived.
- `400 VALIDATION_ERROR`: invalid input.
- `403 INSUFFICIENT_ORGANIZATION_ROLE`: accessible organization, insufficient role.
- `404 ORGANIZATION_NOT_FOUND`: missing, inaccessible or already archived organization.
- `409 ORGANIZATION_CONFIRMATION_MISMATCH`: confirmation does not match.

Retain children and files. There is no deletion-summary or restore endpoint.

After archive, organization/member/project-collection routes conceal the organization. Individual project and project-resource routes conceal the project using `PROJECT_NOT_FOUND`.

### API keys — TSE-67 / TSE-74

Create with `{ "name": "Evaluation writer" }`.

Trim the name and require 1–64 characters. Duplicate display names are allowed.

```ts
type ApiKeySummary = {
  id: string;
  projectId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type CreatedApiKey = ApiKeySummary & {
  key: string;
};
```

- Creation returns `201 CreatedApiKey`.
- List returns `200 ApiKeySummary[]`, including revoked keys.
- Order by `createdAt DESC`, then `id ASC`.
- Revoke returns `204`; repeating an accessible revocation also returns `204` without changing its timestamp.
- Missing/cross-project key returns `404 API_KEY_NOT_FOUND`.
- Use `Cache-Control: no-store`.
- Never return hashes.
- Plaintext appears only in the creation response.

Do not automatically retry creation after an uncertain network outcome. List metadata, revoke the uncertain credential and deliberately create another if needed.

Implementation status: TSE-67 implements key management and the reusable public authentication foundation. Trace operations belong to TSE-68/69.

Frontend behavior — TSE-74:

- The management page is `/organizations/:organizationId/projects/:projectId/api-keys`. It is available to OWNER and ADMIN of an active project. The role comes from `GET /organizations/:organizationId` (`currentUserRole`), never from the URL, storage or token. A MEMBER sees a denied state and the key list is not requested.
- The plaintext `key` exists only in the page's transient disclosure state. Closing the dialog, leaving the route, changing project or session, or detecting access loss discards it. It is never written to the list, the URL, browser storage or logs.
- A creation whose outcome is uncertain (network failure) is never retried automatically. The page reloads the list and asks the user to check it.
- `403 INSUFFICIENT_ORGANIZATION_ROLE` clears the list and any secret and re-reads the role. `404` on the project or organization clears the page content. `404 API_KEY_NOT_FOUND` on revocation closes the dialog and reloads the list. `429` uses the shared `ApiError.retryAfterSeconds` value to disable deliberate retries until its deadline. No mutation is retried automatically.
- The browser calls these management routes with the user's JWT. The key created here is only for the `X-API-Key` header of public trace routes; see [Authentication and route ownership](#authentication-and-route-ownership).

Public authentication uses exactly one X-API-Key header containing a canonical tsk_ secret. Query parameters, JSON fields, cookies and bearer JWTs are not alternative API-key locations.

Missing, malformed, unknown, revoked and archived-parent credentials return 401 INVALID_API_KEY with the same message.

Project credentials remain valid when their creator is removed or demoted. Current OWNER/ADMIN members manage them.

lastUsedAt records best-effort successful authenticated admission, not successful trace persistence. It is updated at most once per minute.

Public trace requests share:
- 60 requests per trusted client IP per minute.
- 120 requests per verified key ID per minute.

Both use fixed 60-second windows beginning at the first counted request.
429 responses contain RATE_LIMITED and an integer Retry-After header.
Invalid credentials consume only the IP budget. Requests admitted by
the guard consume quota even if later validation or business logic fails.

### Trace writes and historical values — TSE-68 / TSE-69

Public clients send:

```http
X-API-Key: <project-key>
```

The verified key determines the project. Client-supplied tenant, project, actor, pricing and lifecycle fields are rejected.

POST and PUT accept this writable shape:

```ts
type TraceInput = {
  externalId: string;
  provider: string;
  model: string;
  workflow: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: "SUCCESS" | "ERROR";
  occurredAt: string;
  metadata?: Record<string, string | number | boolean | null>;
};
```

Validation:

| Field | Rule |
|---|---|
| `externalId` | Trimmed, case-preserving, 1–128 ASCII letters/digits/`.`/`_`/`:`/`-` |
| `provider` | Trimmed/lowercase, maximum 40, `[a-z0-9][a-z0-9._-]*` |
| `model` | Trimmed/lowercase, maximum 100, `[a-z0-9][a-z0-9._:/-]*` |
| `workflow` | Trimmed, case-preserving, 1–80, no control characters |
| Token counters | JSON integers from 0 to 1,000,000,000 |
| `latencyMs` | JSON integer from 0 to 86,400,000 |
| `occurredAt` | Valid UTC instant ending in `Z`, at most millisecond precision, no more than five minutes in the future |
| `metadata` | Flat object, maximum 20 keys; omitted means `{}` |

Metadata keys contain 1–64 characters. String values contain at most 400 characters. Numeric values must be finite. Arrays and nested objects are rejected. Serialized metadata is limited to 4,096 UTF-8 bytes.

The actual JSON request body is limited to 16 KiB.

Creation and correction share normalization, hashing, historical-price selection and Decimal calculations.

- New POST: `201`.
- Identical normalized POST replay: `200`, preserving stored values.
- Conflicting existing external ID: `409`.
- External ID reserved by a deleted trace: `409 TRACE_DELETED`.
- No applicable historical price: `400 MODEL_PRICE_NOT_FOUND`.

Trace responses explicitly map IDs, normalized writable fields, `priceVersionId`, pricing, stored costs, version and timestamps. They exclude hashes, credentials and internal deletion state.

Rates use six-decimal strings. Costs use twelve-decimal strings.

Public POST, detail and PUT responses include the trace version:

```http
ETag: "1"
```

PUT is full replacement. `externalId` remains immutable. Omitted metadata replaces previous metadata with `{}`.

PUT and DELETE require:

```http
If-Match: "1"
```

- Missing precondition: `428 TRACE_VERSION_REQUIRED`.
- Malformed precondition: `400 VALIDATION_ERROR`.
- Stale version: `412 TRACE_VERSION_CONFLICT`.
- Inaccessible/deleted trace: `404 TRACE_NOT_FOUND`.

A current-version no-op PUT preserves version, timestamps and historical pricing.

An actual correction updates its values atomically and increments version once.

DELETE sets `deletedAt`, increments version and returns `204`. Later GET/DELETE returns `404`. The external ID remains reserved.

### TSE-68 implementation status

Implemented:

- POST /api/v1/public/traces with X-API-Key authentication.
- 201 creation and 200 identical replay.
- ETag containing the quoted stored trace version.
- Historical price selection and stored estimated costs.
- GET /api/v1/model-prices with user JWT authentication.

TSE-69 extends this foundation with public trace list/search, detail,
replacement and soft deletion, plus JWT-authenticated browser list/detail.
Their contract and implementation status are described below.

The POST body is limited to 16,384 actual JSON bytes. Metadata is limited
to 4,096 serialized UTF-8 bytes. Null characters and invalid Unicode
sequences are rejected because PostgreSQL cannot represent them safely.

POST replay compares the current normalized writable payload. It does not
reprice the trace or modify its version/timestamps. A different payload
returns TRACE_EXTERNAL_ID_CONFLICT; a retained deleted identity returns
TRACE_DELETED.

### TSE-69 implementation status

Implemented public trace operations, relative to `/api/v1`:

| Method | Route | Success |
|---|---|---|
| `POST` | `/public/traces` | `201` creation or `200` identical normalized replay |
| `GET` | `/public/traces` | `200` paginated list with search and filters |
| `GET` | `/public/traces/:traceId` | `200` trace with its version ETag |
| `PUT` | `/public/traces/:traceId` | `200` replacement or current-version no-op |
| `DELETE` | `/public/traces/:traceId` | `204` soft deletion without a response body |

All five operations require a project API key in `X-API-Key`.
A user JWT alone does not authorize them.

Public operations share the existing quotas across routes:
60 requests/minute per trusted client IP before key authentication,
and 120 requests/minute per verified key.

PUT and DELETE require exactly one `If-Match` header containing the quoted
current version. A stale version returns `412 TRACE_VERSION_CONFLICT`,
including when the submitted replacement matches the current content.

Public documentation is available without credentials:

- Interactive Swagger UI: `/api/v1/public/docs/`
- OpenAPI JSON: `/api/v1/public/openapi.json`

Documentation requests do not consume the trace-operation quotas.
Swagger's interactive trace requests use the real endpoints, require an API
key and consume the normal quotas.

See [PUBLIC_API.md](./PUBLIC_API.md) for examples and
[openapi/public-api.json](./openapi/public-api.json) for the generated contract.

### Browser trace reads — TSE-69

Implemented routes, relative to `/api/v1`:

| Method | Route | Success |
|---|---|---|
| `GET` | `P/traces` | `200` paginated list |
| `GET` | `P/traces/:traceId` | `200` trace detail |

`P` uses the organization/project prefix defined above.

Both routes require the existing user JWT.
OWNER, ADMIN and MEMBER may read traces within an accessible active project
and active organization. Project API keys do not authorize these routes.

The list uses the shared dates, filters, pagination and sorting contract below.
Detail lookup has no default seven-day restriction.

An inaccessible or archived project/organization returns
`404 PROJECT_NOT_FOUND`. Within an accessible project, an absent, deleted or
cross-project trace returns `404 TRACE_NOT_FOUND`.

Browser list and detail share one quota of 60 requests per minute for each
authenticated user/project pair. Changing the trace ID or switching between
list and detail does not create another quota.

The interceptor consumes quota before parameter pipes and service-level
project authorization. An invalid project UUID is passed to the UUID pipe
without consuming this budget; requests with a valid project UUID can count
even if later validation or authorization fails.

A rejected request returns `429 RATE_LIMITED` with `Retry-After` in seconds.
This response does not invalidate the user's authentication session.

Analytics (`GET P/analytics`) shares this same user/project budget.
Switching between trace list, trace detail and analytics does not reset the allowance. Realtime refreshes in the Trace Explorer (TSE-87) are ordinary reads of this same allowance: the client coalesces
them and respects `Retry-After`.

### Shared dates, filters and pagination

Trace lists and analytics accept both dates or neither. When omitted, resolve the last seven days using one captured server time.

The dashboard sends explicit resolved dates. The assistant requires explicit dates.

Rules:

- UTC ISO instants ending in `Z`.
- `from < to`.
- Maximum interval: 90 days.
- Matching boundary: `from <= occurredAt < to`.
- Deleted traces are excluded.
- Unknown, repeated or incorrectly typed parameters are rejected.

Shared filters:

| Filter | Meaning |
|---|---|
| `q` | Trimmed, case-insensitive literal substring across workflow, external ID and model; maximum 100 |
| `provider` | Exact normalized provider |
| `model` | Exact normalized model |
| `workflow` | Exact trimmed, case-sensitive workflow |
| `status` | `SUCCESS` or `ERROR` |

Search fields within `q` combine with OR. Different filters combine with AND. `%` and `_` are literal search characters.

Trace lists additionally accept:

- `page`: default 1.
- `pageSize`: default 25, maximum 100.
- `sortBy`: `occurredAt`, `estimatedCostUsd`, `latencyMs`, `inputTokens` or `outputTokens`.
- `sortOrder`: `asc` or `desc`; default `desc`.
- Default sort field: `occurredAt`.
- Secondary order: `id ASC`.

Response:

```ts
type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};
```

An empty collection has `totalPages: 0`. A page beyond the end returns empty items and actual totals.

Authorization, count and page rows execute in one PostgreSQL Repeatable Read
transaction and share its database snapshot. Concurrent changes committed
after that snapshot is established are not reflected halfway through the
response.

Each HTTP request obtains a new snapshot. Separate page requests remain live;
pagination does not preserve a snapshot between requests.

Detail lookup does not apply the list's default seven-day window.

### Analytics — TSE-71
Implemented by TSE-71.

Authentication: existing user JWT. Current OWNER, ADMIN and MEMBER may read analytics for an active project in an active organization.
Project API keys do not authorize this endpoint.

Accepted query fields:
`from`, `to`, `q`, `provider`, `model`, `workflow`, `status`, `bucket`.

The common date/filter rules above apply. Pagination and sorting
parameters are rejected. `bucket` accepts `hour` or `day`.

Responses:

- `200`: direct AnalyticsSnapshot, including accessible empty results.
- Existing `401`: missing, invalid or expired JWT.
- `400 VALIDATION_ERROR`: invalid route/query/date/bucket selection.
- `404 PROJECT_NOT_FOUND`: missing membership, wrong tenant, or missing/
  archived organization or project.
- `429 RATE_LIMITED`: shared browser-read quota exhausted, with Retry-After.
- Existing safe server error: database/internal failure.

Responses use Cache-Control: no-store and preserve request IDs.
Database errors are not converted into empty snapshots.

`GET P/analytics` returns this object directly:

```ts
type AnalyticsSnapshot = {
  snapshotId: string;
  generatedAt: string;
  projectId: string;

  window: {
    from: string;
    to: string;
    timezone: "UTC";
    bucket: "hour" | "day";
  };

  filters: {
    q: string | null;
    provider: string | null;
    model: string | null;
    workflow: string | null;
    status: "SUCCESS" | "ERROR" | null;
  };

  summary: {
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    estimatedCostUsd: string;
    errorCount: number;
    errorRatePct: number | null;
    averageLatencyMs: number | null;
  };

  series: Array<{
    bucketStart: string;
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    estimatedCostUsd: string;
  }>;

  byModel: Array<{
    provider: string;
    model: string;
    traceCount: number;
    inputTokens: string;
    outputTokens: string;
    estimatedCostUsd: string;
  }>;
};
```

Requirements:

- Aggregate every matching trace, independent of pagination.
- Sum stored costs using exact arithmetic.
- Serialize aggregate token totals as decimal integer strings.
- Serialize costs with twelve fractional digits.
- Count fields must remain safe JSON integers.
- Round error rate to two decimals and average latency to three, half-up.
- Include ERROR traces unless a filter excludes them.
- Preserve legitimate zero latency.
- Use `Cache-Control: no-store`.

Default buckets are hourly for intervals up to 48 hours and daily otherwise. Accept an explicit valid `hour` or `day` bucket.

Align buckets to UTC boundaries, include intersecting partial buckets and zero-fill gaps. Enforce the actual maximum of 2,160 hourly buckets.

Order model groups by cost descending, provider ascending, model ascending.

An empty matching set is a successful snapshot: zero counts, `"0"` token totals, `"0.000000000000"` cost, null average/rate, empty model groups and a zero-filled series.

Internal project metadata and synthetic-pricing information used by the assistant are not added to this public response.

Authorization and all contributing reads execute in one short PostgreSQL Repeatable Read transaction. Each request obtains a fresh snapshot.

AnalyticsService.getSnapshot(scope, query) owns that transaction and returns only AnalyticsSnapshot.

AnalyticsService.readSnapshotInTransaction(tx, scope, query) requires a caller-owned Repeatable Read transaction, performs authorization itself, and returns { snapshot, project, pricing }. Every database read uses tx.

The internal project contains id, name and description.
The internal pricing contains currency: "USD" and containsSyntheticPricing, derived from historical prices referenced by matching traces. Empty matching sets return false.

TSE-80 imports AnalyticsModule and uses this internal method. It finishes the transaction before contacting Gemini. No analytics result is persisted as a resumable snapshot.

### Realtime — TSE-73

Use same-origin Socket.IO:

- Namespace: `/realtime`.
- Engine.IO path: `/socket.io`.
- Handshake authentication: `{ token: "<JWT>" }`.

Client events:

```ts
// project.subscribe
{ organizationId: string; projectId: string }

// Success acknowledgement
{ ok: true; projectId: string }

// Failure acknowledgement
{ ok: false; error: { code: string; message: string } }

// project.unsubscribe: no payload
```

One socket has at most one active project subscription. Leave the previous subscription before authorizing a replacement.

Server events:

```ts
// traces.changed
{
  eventId: string;
  projectId: string;
  occurredAt: string; // Notification time, not trace occurrence time.
}

// access.revoked
{
  projectId: string;
  code: "PROJECT_NOT_FOUND";
}
```

`traces.changed` contains no trace contents or calculated totals.

Publish only after committed creation, actual correction or deletion. Coalesce changes using the agreed fixed 150 ms window.

Delivery is best effort. Subscription/reconnection must be followed by a fresh HTTP read.

Realtime errors use `{ code, message }`: `connect_error.data` for namespace
connection rejection and `realtime.error` before terminating an accepted connection.
Codes: `AUTHENTICATION_REQUIRED`, `INVALID_ACCESS_TOKEN`, `ACCESS_TOKEN_EXPIRED`,
`VALIDATION_ERROR`, `PROJECT_NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_SERVER_ERROR`.
Origin rejection occurs at the Engine.IO HTTP layer before namespace authentication.

`project.unsubscribe` may request an acknowledgement: `{ ok: true }`.
A payload is rejected with `VALIDATION_ERROR`, while still clearing the subscription.
Subscriptions require exactly two UUID fields; unknown fields are rejected.
A superseded subscription receives `PROJECT_NOT_FOUND`; it never restores an old room.

Limits: five concurrent sockets/user; ten subscription attempts/ten seconds/socket,
including invalid payloads. Failed initialization/disconnect releases the connection slot.
The collection window is a fixed 150 ms; changes during dispatch cause a later flush.
Each flush batch-checks current membership and active parents, then rechecks connection,
verified expiry and subscription generation. Authorization failure emits a safe
`INTERNAL_SERVER_ERROR` and disconnects affected sockets without sending trace data.
Membership removal or parent archive emits `access.revoked`; demotion to MEMBER does not.

Origin policy is defined in SECURITY.md. Same-origin polling GETs may omit Origin;
the documented Fetch Metadata + Referer exception is deliberate.

The TSE-76 client subscribes after every connection, refetches after every successful acknowledgement,
refetch on `traces.changed`, on visible focus and every 30 seconds while visible.
Keep the applied dates/filters when refetching. Stop/re-subscribe when project changes.
Treat revoked access as project unavailability; do not clear an otherwise valid login.
Expired/invalid JWT requires the existing session-expiry behavior. A transport outage
alone must preserve the session. Reconnect with bounded backoff; there is no event replay.
Do not calculate totals from notifications, and do not change an in-flight assistant context.

The Trace Explorer (TSE-87) list and detail follow this contract through the shared client and `RefreshScheduler`, with two
documented differences: there is no periodic 30-second refresh, and a refresh is redone on visibility or network return only
when one was skipped while the tab was hidden or the browser offline. Notices are coalesced (250 ms, at most 1 s), at most one
follow-up read is queued, a `Retry-After` deadline is respected and a failed read is never retried automatically; the last
data stays visible as stale, with a Retry action.

### Assistant — TSE-80 / TSE-81

Request:

```http
POST P/assistant
Content-Type: application/json
Accept: text/event-stream
Authorization: Bearer <JWT>
```

```ts
type AssistantRequest = {
  question: string;
  from: string;
  to: string;
  filters: {
    q?: string;
    provider?: string;
    model?: string;
    workflow?: string;
    status?: "SUCCESS" | "ERROR";
  };
};
```

Require a trimmed question of 1–2,000 characters, explicit dates and a filters object. `{}` means no additional filters.

Limit the actual request body to 8 KiB. Reject unknown fields, trace IDs, raw traces, client totals, project metadata, pagination and sorting.

The backend constructs:

```ts
type AssistantContext = Pick<
  AnalyticsSnapshot,
  | "snapshotId"
  | "generatedAt"
  | "window"
  | "filters"
  | "summary"
  | "series"
  | "byModel"
> & {
  project: {
    id: string;
    name: string;
    description: string | null;
  };
  pricing: {
    currency: "USD";
    containsSyntheticPricing: boolean;
  };
};
```

Build this context from one consistent authorized read and finish the transaction before contacting Gemini.

Maximum serialized context: 32 KiB.

- No matching traces: `422 ASSISTANT_NO_DATA`.
- Oversized context: `422 ASSISTANT_CONTEXT_TOO_LARGE`.

Neither condition calls the provider. Do not silently truncate the matching dataset.

SSE events contain JSON data:

| Event | Payload |
|---|---|
| `start` | `{ requestId, provider: "gemini", model, context }` |
| `delta` | `{ text }` |
| `done` | `{ requestId, finishReason: "stop" \| "length", usage }` |
| `error` | `{ requestId, code, message, retryable }` |

`usage` contains provider-reported `{ inputTokens, outputTokens }` or `null`.

A started stream has one `start` and one terminal `done` or `error`. Cancellation may close without a terminal event. Unexpected EOF is not success. Complete frames remain below 64 KiB.

Before streaming, failures use the normal HTTP JSON envelope. After streaming starts, send a terminal SSE error and close.

Provider configuration/authentication failures are not user `401` responses.

The answer context stays fixed. Project/date/filter changes cancel and clear the old answer; same-selection dashboard refreshes do not.

### TSE-80 implementation status

Implemented, relative to `/api/v1`:

```http
POST /organizations/:organizationId/projects/:projectId/assistant
```

JWT only (the global guard). OWNER, ADMIN and MEMBER of an active organization
and project may ask. Project API keys are rejected with `401`.

Request example (`fixtures/evaluation/assistant/request.json`):

```json
{
  "question": "Which model contributes most to the estimated cost?",
  "from": "2026-10-01T00:00:00.000Z",
  "to": "2026-10-02T00:00:00.000Z",
  "filters": {}
}
```

Dates and filters use the same parser as `GET .../analytics` (TSE-69 / TSE-71):
`from <= occurredAt < to`, at most 90 days, UTC instants ending in `Z`,
hourly buckets up to 48 hours and daily buckets otherwise.
`from`, `to` and `bucket` are not accepted inside `filters`.

Order of checks:

1. JWT, route UUIDs, `Content-Type: application/json`, 8 KiB of real body bytes, body validation.
2. Current project access (a rejected request uses no rate-limit capacity).
3. Provider configuration.
4. One active answer per user, 5 accepted attempts per user and 30 per project in a rolling minute. Both rate budgets are admitted together.
5. Context built in one Repeatable Read transaction, closed before Gemini is called.
6. JWT expiry and project access checked again, then one provider request.

Access reads have a five-second wait limit. Slow readers cannot retain an active
slot after cancellation or a deadline: normal writes observe cancellation and
terminal writes end the response with a five-second flush grace period. A client
that cannot receive the final frame must treat the stream as interrupted.

The SSE response starts when Gemini accepts the request (before the first text):

```http
200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
X-Request-Id: <same value as start.requestId>
```

Each frame is `event: <name>\ndata: <json>\n\n`. Long text is split into
several `delta` events (at most 4,000 characters each), so frames stay far
below 64 KiB. Transcripts: `fixtures/evaluation/assistant/*.sse`; a unit test
proves they are byte-for-byte what the backend writes.

Errors:

| Situation | Before the stream (JSON) | After the stream started (`error` event) |
|---|---|---|
| Missing / invalid / expired JWT | `401` existing codes | `ACCESS_TOKEN_EXPIRED` |
| Invalid UUID, body, filter or dates | `400 VALIDATION_ERROR` | — |
| Body over 8,192 bytes | `413 PAYLOAD_TOO_LARGE` | — |
| Wrong content type | `415 UNSUPPORTED_MEDIA_TYPE` | — |
| No access, archived organization/project | `404 PROJECT_NOT_FOUND` | `PROJECT_NOT_FOUND` |
| No matching traces | `422 ASSISTANT_NO_DATA` | — |
| Context over 32 KiB | `422 ASSISTANT_CONTEXT_TOO_LARGE` | — |
| Refusal / safety block | `422 LLM_REFUSED` | `LLM_REFUSED` |
| Answer already running for this user | `429 ASSISTANT_ALREADY_RUNNING` | — |
| Local rate limit | `429 RATE_LIMITED` + `Retry-After: <seconds>` | — |
| Key/model missing or rejected by Gemini | `503 LLM_UNAVAILABLE` | `LLM_UNAVAILABLE` |
| Gemini quota or overload (`429`/`503`) | `503 LLM_PROVIDER_BUSY` | `LLM_PROVIDER_BUSY` |
| Other provider failure, empty answer, cut stream | `502 LLM_PROVIDER_ERROR` | `LLM_PROVIDER_ERROR` |
| 15 s without text / 60 s in total | `504 LLM_TIMEOUT` | `LLM_TIMEOUT` |
| Server shutdown | — | `SERVICE_UNAVAILABLE` |
| Database or unexpected failure | `500 INTERNAL_SERVER_ERROR` | `INTERNAL_SERVER_ERROR` |

`retryable` is a hint for a deliberate user retry. It never means "retry automatically".

`usage` mapping: `inputTokens = usageMetadata.promptTokenCount`,
`outputTokens = usageMetadata.candidatesTokenCount` (thinking tokens are not
included). `null` when Gemini does not report both. Usage is never estimated
and never written to project traces.

Handoff to TSE-81:

- Types: `backend/src/assistant/assistant.types.ts` (`AssistantContext`) and the tables above.
- Fixtures: `fixtures/evaluation/assistant/` (request, context, five SSE transcripts, chunk boundaries).
- Fake-provider tests run with `make test-backend`; live checks are opt-in (see LOCAL_DEVELOPMENT.md).

Ownership notes:

- TSE-71: reused as is through `AnalyticsService.readSnapshotInTransaction()`; no change was needed.
- TSE-76: the dashboard must send its applied, resolved selection (never "last7days").
- TSE-81: owns the UI, Stop button, and the complete / truncated / stopped / interrupted / failed states.

### Private documents — TSE-78 / TSE-79

Upload accepts exactly one multipart file field named `file`, no extra fields, and 1–10,485,760 file bytes.

Supported content:

- PDF: `application/pdf`.
- TXT: `text/plain`.
- Markdown: `text/markdown`.

Validate actual content, not only the extension or client MIME type.

Original filenames are display data, limited to 255 UTF-8 bytes, and must pass the document filename checks. They never become filesystem paths.

```ts
type DocumentSummary = {
  id: string;
  projectId: string;
  originalName: string;
  mediaType: "application/pdf" | "text/plain" | "text/markdown";
  sizeBytes: number;
  createdAt: string;
};
```

- Upload: `201 DocumentSummary`.
- List: `200 Page<DocumentSummary>`, default page 1 and size 25, maximum 100.
- List order: `createdAt DESC`, then `id ASC`.
- Duplicate display filenames are allowed.
- Content route returns bytes, not JSON or a public storage URL.
- `download` accepts only `true` or `false`; default false.
- Content headers include validated MIME, length, safe disposition, `no-store` and `nosniff`.
- Delete has no body and returns `204`.
- Repeated delete returns `404 DOCUMENT_NOT_FOUND`.

Never expose storage keys, private paths or cleanup jobs.

#### Routes (implemented by TSE-78)

`P` is `/api/v1/organizations/:organizationId/projects/:projectId`. All routes require a user JWT and send `Cache-Control: no-store`.

| Route | Roles | Success |
|---|---|---|
| `POST P/documents` | OWNER, ADMIN | `201 DocumentSummary` |
| `GET P/documents?page&pageSize` | any member | `200 Page<DocumentSummary>` |
| `GET P/documents/:documentId/content?download=true\|false` | any member | `200` file bytes |
| `DELETE P/documents/:documentId` | OWNER, ADMIN | `204` |

Upload body: `multipart/form-data` with exactly one part named `file` and no other part. Any other shape is `400 VALIDATION_ERROR`. The file name is read as UTF-8. Names containing `/`, `\`, control characters, or equal to `.` or `..` are rejected. The extension (`.pdf`, `.txt`, `.md`, case-insensitive) selects the media type.

Content route headers: `Content-Type` (stored media type), `Content-Length`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Content-Disposition` (`inline` by default, `attachment` with `download=true`) with an ASCII `filename` and a UTF-8 `filename*`. Any other `download` value, or a repeated one, is `400`.

Errors:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad multipart shape, empty file, bad file name, bad query |
| 403 | `INSUFFICIENT_ORGANIZATION_ROLE` | A member without OWNER/ADMIN uploads or deletes |
| 404 | `PROJECT_NOT_FOUND` | Unknown, archived or inaccessible project or organization |
| 404 | `DOCUMENT_NOT_FOUND` | Unknown document, document of another project, or already deleted |
| 409 | `CONCURRENT_MODIFICATION` | Transaction conflict persisted after retries |
| 413 | `PAYLOAD_TOO_LARGE` | File larger than 10,485,760 bytes |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Extension is not `.pdf`, `.txt` or `.md` |
| 422 | `INVALID_DOCUMENT_CONTENT` | Text that is not UTF-8 or contains NUL; PDF that is damaged, password-protected, permission-encrypted or not inspectable within 10 seconds |
| 429 | `RATE_LIMITED` | More than 5 authorized upload attempts per rolling minute per user; `Retry-After` is set |
| 503 | `STORAGE_UNAVAILABLE` | Bytes cannot be written or are missing |

Order of checks for an upload: authentication, project access and role (before the body is read), quota, multipart parsing and size, file name, media type, content, then storage and a final access re-check in the same transaction as the insert. Denied requests do not consume quota.

### Dashboard exports — TSE-77

Exports are local browser operations using a captured input:

```ts
type DashboardExportInput = {
  project: {
    id: string;
    name: string;
  };
  snapshot: AnalyticsSnapshot;
};
```

Require matching project IDs, valid current access and a snapshot matching the applied selection.

Export the captured snapshot even if a same-selection refresh completes during generation. Do not issue another analytics request.

CSV header:

```text
section,snapshotId,projectId,projectName,from,to,generatedAt,timezone,bucket,q,filterProvider,filterModel,filterWorkflow,filterStatus,bucketStart,provider,model,traceCount,inputTokens,outputTokens,estimatedCostUsd,errorCount,errorRatePct,averageLatencyMs
```

Include one summary row, every series bucket and every model group. Repeat selection metadata on every row.

Preserve exact numeric strings, escape CSV fields and neutralize formula-leading user-controlled text, including leading whitespace/control variants.

PDF includes project identity, snapshot metadata, selection, summary and complete series/model tables. Support Unicode with bundled fonts and paginate without losing rows.

Use the note:

> Costs are recorded estimates, not invoices. Evaluation fixtures may use synthetic pricing.

Do not infer synthetic pricing from model names.

A valid empty snapshot remains exportable. Changed-selection loading/errors, sign-out and access loss disable export. Discard pending downloads after the originating session/project becomes obsolete.

### Additional error behavior

Continue using the existing error envelope and request IDs.

Evaluation contracts additionally use:

- `412`: stale trace version.
- `413`: request/file size exceeded.
- `415`: unsupported document media type.
- `422`: supported request cannot be processed under the documented feature rule.
- `428`: required trace version precondition missing.
- `429`: local quota exceeded, with `Retry-After`.
- `502`: provider failure.
- `504`: provider deadline exceeded.

Use explicit application codes. Do not assume the existing exception filter already supplies every new code.

Only an authentication failure for the captured user session invalidates that session. Permission errors, missing resources, conflicts, rate limits, provider failures and network failures do not sign the user out.


### Dashboard frontend handoff — TSE-76

`AppliedSelection` contains organization/project IDs, exact UTC `from`/`to` and normalized
`q`, `provider`, `model`, `workflow`, `status` filters. Dates are inclusive/exclusive as above.
Analytics requests use the existing authenticated HTTP client and omit list sorting/pagination.
Responses must match the requested project, period and filters before being displayed.
Money and aggregate token counts remain strings; only chart coordinates use numbers.
`ProjectDashboard.renderExtras` receives `{ selection, snapshot, status, selectionState, exportEnabled }`.
The selection remains stable during background refreshes. A matching empty snapshot is exportable.
Scope changes clear old figures; access loss clears the complete project Overview and its handoff.
There are no new backend routes, export generation or assistant calls in TSE-76.
