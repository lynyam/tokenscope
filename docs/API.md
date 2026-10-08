
# TokenScope API contracts

## Purpose

This document owns TokenScope’s external contracts.

The identity, organization, membership and project sections describe the Sprint 1 baseline present at `854da94`.

The section “Evaluation extensions — agreed, not yet implemented” defines additional contracts awaiting implementation. Its presence does not mean the corresponding routes exist.

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

Organization deletion is not part of M1.

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

## Evaluation extensions — agreed, not yet implemented

Status at baseline `854da94`: the following extensions are planned.

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

Count and rows use one consistent authorized read. Detail lookup does not apply the list’s default seven-day window.

### Analytics — TSE-71

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
