# M1 HTTP API contract

## Purpose

This document is the canonical frontend/backend contract for M1. Backend
controllers, frontend API functions, tests, and demo commands must agree with
it.

M1 covers identity, organizations, memberships, and projects. API keys, traces,
cost calculation, and dashboards are M2.

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

- Request and response bodies use `application/json`.
- Successful responses return the documented resource directly; M1 does not
  wrap them in a generic `data` envelope.
- Dates are ISO-8601 UTC strings.
- IDs are UUID strings.
- Unknown request fields are rejected.
- List endpoints return `[]`, never `null`, when empty.
- Pagination is not required for M1.

### Authentication

Every endpoint except sign-up, sign-in, and health checks requires:

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
standard error format.

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
`OWNER`, `ADMIN`, or `MEMBER`.

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

Setting the same role is idempotent and returns `200 OK`.

### DELETE /organizations/:organizationId/members/:userId

Removes the membership, not the global user.

Required role: `OWNER`.

Response — `204 No Content`.

Errors:

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

| Status | Meaning |
|---:|---|
| `400` | Body, route parameter, or query validation failed |
| `401` | Authentication is absent, invalid, or expired |
| `403` | The user belongs to the organization but lacks the required role |
| `404` | The resource does not exist or is concealed from this caller |
| `409` | A unique/business invariant conflicts with the requested change |
| `500` | Unexpected server failure; internal details are not exposed |
| `503` | A required dependency such as PostgreSQL is unavailable |

The backend logs the full internal error with `requestId`; responses never
include stack traces, SQL, Prisma errors, tokens, hashes, or passwords.

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
