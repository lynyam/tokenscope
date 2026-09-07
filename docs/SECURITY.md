# M1 security — Authentication, authorization, and tenant isolation

## Purpose

This document defines the security rules that every M1 backend implementation
and review must enforce.

The central rule is:

> Frontend permission checks are user experience. Backend permission checks are
> security.

Hiding a button does not authorize or protect an operation. Every backend
request independently authenticates the caller and verifies membership, role,
and tenant scope.

## Security boundary

M1 protects:

- user credentials;
- authenticated user identity;
- organization data;
- organization membership and roles;
- projects and future project ownership;
- separation between organizations.

M1 does not yet contain API keys, traces, cost data, dashboards, uploaded
documents, or WebSocket channels. Those features begin in M2 and must inherit
the organization/project boundary defined here.

## Trust model

Treat all of the following as untrusted:

- request bodies, query strings, route parameters, and headers;
- organization and project IDs supplied by the frontend;
- role values displayed or cached by the frontend;
- JWTs before signature, issuer, audience, and expiration verification;
- database unique-constraint conflicts caused by concurrent requests.

Trust only:

- the user ID produced by successful backend JWT verification;
- role/membership data read from PostgreSQL for that user and organization;
- values accepted by DTO/parameter validation;
- database constraints and successfully committed transactions.

## Authentication

### Password handling

- Hash passwords with Argon2id using a maintained library.
- Configure hashing in one auth-owned provider, not separately in controllers.
- Enforce the API length constraints before hashing.
- Never trim, lowercase, normalize, log, persist, or return the plaintext
  password.
- Never return or log `passwordHash`.
- Verify passwords using the library's constant-time verification function.
- Return the same `401 INVALID_CREDENTIALS` response for an unknown email and
  an incorrect password.
- The seed used for an authenticated demo must contain a real Argon2id hash or
  the demo must create users through sign-up. Placeholder strings such as
  `seed-password-hash` are not valid login credentials.

### Email handling

Trim and lowercase emails before storage and lookup. The database unique
constraint remains the final protection against duplicate normalized emails.
Do not rely on a pre-insert existence check alone because concurrent requests
can race.

### JWT access tokens

M1 uses signed bearer access tokens:

```http
Authorization: Bearer <access-token>
```

Token requirements:

- sign with a secret loaded from environment configuration;
- fail startup when the secret is missing or too weak for the configured
  algorithm;
- verify signature, expiration, issuer, and audience;
- use a one-hour access-token lifetime for the M1 local/demo environment;
- include a stable user ID as `sub`;
- do not include organization roles or permissions;
- reject malformed, expired, or invalid tokens with `401`;
- never log the full token or Authorization header.

Roles are excluded from the JWT because they are organization-specific and can
change while the token remains valid.

The implementation must add and validate these environment variables:

```text
JWT_SECRET=<local secret; never committed>
JWT_ISSUER=tokenscope
JWT_AUDIENCE=tokenscope-web
JWT_ACCESS_TTL_SECONDS=3600
```

`JWT_SECRET` has no committed real value. The checked-in environment template
may contain only a clearly marked development placeholder.

### Sign-out limitation

M1 uses stateless access tokens and has no refresh-token/session store or
revocation list. Frontend sign-out deletes its token and clears user state.

The token remains cryptographically valid until expiration if it was copied
before sign-out. This limitation is explicit; M1 must not expose a fake server
logout endpoint that claims to revoke a token.

### Frontend token storage

The current M1 bearer-token approach requires frontend storage across refresh.
Store only the access token—never passwords, password hashes, or mock account
records—and clear it on sign-out or unrecoverable authentication failure.

Browser storage is exposed to successful XSS. Short token lifetime, strict
input/output handling, dependency review, and avoiding unsafe HTML reduce the
risk. An HTTP-only cookie plus refresh/session design can replace this approach
during production hardening.

## Authorization

Authentication answers “who is the caller?” Authorization answers “may this
caller act on this organization or project?”

Authorization is resolved from `Membership(userId, organizationId, role)`.
Project permissions are inherited from organization membership. M1 has no
project-specific member table or ACL.

### Authorization matrix

| Action | OWNER | ADMIN | MEMBER | Anonymous |
|---|---:|---:|---:|---:|
| Sign up / sign in | yes | yes | yes | yes |
| View own profile | yes | yes | yes | no |
| Create organization | yes | yes | yes | no |
| View organization | yes | yes | yes | no |
| Rename organization | yes | no | no | no |
| View members | yes | yes | yes | no |
| Add member | yes | no | no | no |
| Remove member | yes | no | no | no |
| Change member role | yes | no | no | no |
| Create project | yes | yes | no | no |
| View active project | yes | yes | yes | no |
| Update active project | yes | yes | no | no |
| Archive active project | yes | yes | no | no |

“Create organization” has no pre-existing organization role requirement; every
authenticated user may create one and becomes its first owner.

## Centralized access helpers

Membership and role rules must not be rewritten ad hoc in each controller.
Provide and test equivalent centralized services/helpers:

```ts
assertOrganizationMember(
  userId: string,
  organizationId: string,
): Promise<Membership>
```

```ts
assertOrganizationRole(
  userId: string,
  organizationId: string,
  allowedRoles: MembershipRole[],
): Promise<Membership>
```

```ts
assertProjectAccess(
  userId: string,
  organizationId: string,
  projectId: string,
  allowedRoles: MembershipRole[],
): Promise<Project>
```

Recommended ownership:

- organization membership/role helpers belong to the `memberships` module;
- project-resource scoping belongs to the `projects` module and reuses the
  membership rule;
- `common` contains framework-level types/decorators, not tenant policy.

Controllers pass the authenticated user ID and validated route IDs to services.
Controllers do not decide roles and do not call Prisma.

## Tenant isolation

### Organization rule

An organization is returned only when a membership exists for both:

- the authenticated `userId`; and
- the requested `organizationId`.

For list operations, start from the user's memberships. Never load all
organizations and filter them in application memory.

Conceptual Prisma scope:

```ts
await prisma.organization.findMany({
  where: {
    memberships: {
      some: { userId },
    },
  },
});
```

### Project rule

Every project query includes:

- `projectId` when addressing one project;
- the `organizationId` from the route;
- `archivedAt: null` for normal M1 operations;
- membership of the authenticated user in the owning organization;
- an allowed role for mutations.

Forbidden:

```ts
await prisma.project.findUnique({
  where: { id: projectId },
});
```

The query proves only that a project exists. It does not prove that the project
belongs to the organization in the URL or that the caller may access it.

Correct scope:

```ts
await prisma.project.findFirst({
  where: {
    id: projectId,
    organizationId,
    archivedAt: null,
    organization: {
      memberships: {
        some: {
          userId,
          role: { in: allowedRoles },
        },
      },
    },
  },
});
```

For role-sensitive operations, call `assertOrganizationRole` before this
query. That produces the documented `403` when a known member lacks the
required role. Keeping the membership predicate in the project query also
prevents access if that membership changes between checks.

Equivalent implementations are acceptable only when tests prove the same
conditions and status behavior. Never authorize with a frontend-provided role.

### Concealed resources

Use:

- `404` when an organization/project does not exist or is outside the
  caller's tenant boundary;
- `403` when the caller is a known member of that organization but lacks the
  role required for a mutation.

This prevents an outsider from using status codes to enumerate organizations or
projects while still giving legitimate members a useful permission error.

## Ownership invariants

### Initial owner

Creating an organization and its initial `OWNER` membership is one atomic
business operation. Use a nested Prisma write or transaction. Never commit an
ownerless organization.

### Last owner

Every organization must retain at least one owner.

Before removing a membership or changing `OWNER` to another role:

1. determine whether the target is an owner;
2. if so, count the organization's owners;
3. reject when the target is the last owner;
4. perform the check and mutation in the same transaction.

The transaction must protect against concurrent owner removals/demotions.
Use a serializable transaction (with bounded retry for serialization conflicts)
or an equivalent database-locking strategy.

Return `409 LAST_OWNER_REQUIRED` when the requested state conflicts with this
invariant.

## Project lifecycle

Projects are soft-archived, not deleted:

```text
active:   archivedAt = null
archived: archivedAt = timestamp
```

Normal list/detail/update/archive queries exclude archived records. An archive
operation sets the timestamp. M1 has no restore operation.

An archived project keeps its `(organizationId, slug)` reservation. This
avoids reusing historical project identity before M2 attaches API keys, traces,
and cost data.

## Validation and mass-assignment protection

Enable a global NestJS `ValidationPipe` with equivalent behavior:

```ts
new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
})
```

Use DTO classes rather than TypeScript interfaces for runtime validation. At a
minimum:

- validate UUID route parameters;
- validate email, string lengths, optional/null fields, and role enums;
- reject empty update bodies;
- derive `userId`, `organizationId`, `slug`, `createdAt`, and
  `archivedAt` server-side;
- never spread an unvalidated request body directly into a Prisma `data`
  object.

## Safe output

Use explicit response mappers/selection. Do not serialize Prisma entities
blindly.

Never expose:

- `passwordHash`;
- plaintext password;
- JWT signing secret;
- full access token in logs;
- environment variables;
- raw SQL/Prisma errors;
- server stack traces.

`MembershipWithUser.user` contains only `id`, `email`, and
`displayName`.

## Error and log handling

The API error format is defined in [`API.md`](./API.md#error-contract).

- Attach a request ID to the response and structured logs.
- Map known validation, authentication, authorization, not-found, conflict, and
  dependency failures deliberately.
- Map database uniqueness conflicts to `409`; do not expose `P2002`.
- Treat unexpected errors as `500 INTERNAL_SERVER_ERROR`.
- Log enough context to diagnose the failure: request ID, route, method,
  authenticated user ID when known, and safe resource IDs.
- Redact Authorization, password, password hash, and secret fields.

## Required security tests

The following are M1 completion requirements:

| Area | Required proof |
|---|---|
| Password storage | Sign-up stores an Argon2id hash different from the password |
| Safe user output | No auth/user/membership response contains `passwordHash` |
| Authentication | Missing, malformed, expired, and incorrectly signed tokens return `401` |
| Credential privacy | Unknown email and wrong password have the same status/code/message |
| Organization isolation | User A cannot read User B's organization |
| Organization listing | Users receive only organizations where they have memberships |
| Atomic ownership | Organization creation also creates exactly one initial owner |
| Membership authorization | ADMIN and MEMBER cannot manage members |
| Last-owner protection | Last owner cannot be removed or demoted |
| Concurrent ownership | Competing owner removals cannot leave zero owners |
| Project read isolation | User cannot read a project from another organization |
| Route mismatch | Project under the wrong `organizationId` returns `404` |
| Project mutation roles | MEMBER cannot create, update, or archive projects |
| Archive behavior | Archived project disappears from normal list/detail/update |
| Slug constraints | Conflicting organization/project slugs return `409` |
| Mass assignment | Unknown/protected request properties return `400` |

At least the tenant-isolation, role, last-owner, and safe-output cases must be
integration or end-to-end tests against PostgreSQL—not only mocked unit tests.

## Backend PR security checklist

Before approving an M1 backend pull request:

1. Is authentication applied to every non-public endpoint?
2. Is request input represented by a runtime-validated DTO?
3. Does the controller delegate rather than call Prisma?
4. Is organization membership checked?
5. Is the required role checked from the database?
6. Is every project lookup scoped by organization and archive state?
7. Can changing a URL ID cross a tenant boundary?
8. Is `passwordHash` excluded from every response and log?
9. Are database conflicts mapped without leaking internal errors?
10. Does any multi-record invariant require an atomic transaction?
11. Are both the allowed and forbidden paths tested?
12. Do API, security, and data-model docs still match the implementation?

## M1 limitations and M2 handoff

Accepted M1 limitations:

- no server-side access-token revocation;
- no refresh tokens or session management;
- no password reset or email verification;
- no login rate limiter unless added as a separate accepted requirement;
- no project API keys;
- no trace-ingestion authentication;
- no project-specific permissions.

M2 must add separate project API-key authentication without reusing user JWTs
for public trace ingestion. API key plaintext must be shown once, stored only as
a hash, scoped to a project, and revocable. Those rules belong in the M2
extension of this document.
