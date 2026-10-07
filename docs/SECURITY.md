# TokenScope security: authentication, authorization and tenant isolation

## Purpose

This document defines the security rules for TokenScope.

The existing sections describe the Sprint 1 foundation. The evaluation extension specifies additional required behavior that is not yet implemented at baseline `854da94`.

Feature implementation and review must preserve the existing guarantees while adding the applicable evaluation requirements.

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
Store only the access token; never passwords, password hashes, or mock account
records; and clear it on sign-out or unrecoverable authentication failure.

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
  client?: Prisma.TransactionClient,
): Promise<Membership>
```

```ts
assertOrganizationRole(
  userId: string,
  organizationId: string,
  allowedRoles: readonly MembershipRole[],
  client?: Prisma.TransactionClient,
): Promise<Membership>
```

```ts
assertProjectAccess(
  userId: string,
  organizationId: string,
  projectId: string,
  allowedRoles: readonly MembershipRole[],
): Promise<Project>
```

Recommended ownership:

- organization membership/role helpers belong to the `memberships` module;
- project-resource scoping belongs to the `projects` module and reuses the
  membership rule;
- `common` contains framework-level types/decorators, not tenant policy.

Controllers pass the authenticated user ID and validated route IDs to services.
Controllers do not decide roles and do not call Prisma.

### Implemented helper contract

`MembershipsModule` exports `OrganizationAccessService`, which implements
`assertOrganizationMember` and `assertOrganizationRole`.
`ProjectsModule` imports `MembershipsModule` and exports `ProjectAccessService`,
which implements `assertProjectAccess`. Both use the shared `PrismaService`.

Domain services pass the acting user ID from verified authentication and
validated organization/project route IDs. The target user of a membership
mutation is distinct from its acting user. Allowed roles are selected by
backend policy, never by request input or JWT role claims.

The organization helpers default to the shared Prisma service. A domain service
inside a transaction must pass its `tx` client; role checks then use that
transaction's snapshot and can observe its own uncommitted writes. Each retry
must call the helpers again inside the new transaction. Roles are never cached
or taken from JWT claims.

A helper returns a selected record or throws; its result does not replace a
domain response mapper.

Organization checks return `404 ORGANIZATION_NOT_FOUND` for absent membership,
then `403 INSUFFICIENT_ORGANIZATION_ROLE` for a known member lacking permission.
Project access performs the organization role check first. It converts only
`ORGANIZATION_NOT_FOUND` into `PROJECT_NOT_FOUND`; it preserves role errors.
Thus a known member lacking mutation privileges receives `403` before the
project lookup, even when the project ID would also fail that lookup.

The project query includes project ID, route organization ID, active state,
and membership of the same acting user with an allowed role. It returns
`404 PROJECT_NOT_FOUND` when no row matches, including when it observes a
membership removal or disallowed role change committed between the two checks.
Unexpected database failures propagate to the shared filter as safe `500`
responses; they must not be disguised as missing resources.

Helpers perform reads. Subsequent mutations must preserve tenant, active-state,
and acting-user role predicates in the write or an equivalent concurrency-safe
transaction. A successful helper call does not authorize an unrestricted later
write. TSE-40 separately owns transactional last-owner protection.

TSE-42 delivers exported helpers, tests, and this calling contract. TSE-39,
TSE-40, and TSE-41 must adopt the helpers and verify real endpoint behavior:

| Operation | Required authorization |
|---|---|
| Organization creation | Authenticated user; atomic initial OWNER creation |
| Organization list | Query through the acting user's memberships |
| Organization detail / membership list | `assertOrganizationMember` |
| Organization rename / membership mutations | `assertOrganizationRole` with OWNER |
| Project list | Membership check plus organization, active-state and user scope |
| Project creation | `assertOrganizationRole` with OWNER and ADMIN |
| Project detail | `assertProjectAccess` with OWNER, ADMIN and MEMBER |
| Project update / archive | `assertProjectAccess` with OWNER and ADMIN |

DTOs accept only the fields documented for the operation. A rename cannot
supply the acting user, organization, slug, archive timestamp, or role policy.
A membership DTO's role is the requested target role, not the caller's authority.
Construct Prisma write data explicitly from validated fields.

Verification uses `make test-backend`:

- `test/database/tenant-authorization.integration.spec.ts` proves the helpers'
  tenant, role, archive, fresh-membership, and selected-output behavior against
  guarded, isolated PostgreSQL.
- `test/authorization/tenant-authorization.e2e-spec.ts` uses the real helpers,
  `configureApp`, and substituted Prisma results to prove HTTP error contracts,
  request IDs, safe failures, and rejection of protected rename fields.
- HTTP probe controllers and their fixed actor exist only in tests. JWT
  verification is covered by authentication tests and the real membership
  endpoint suites below.
- `test/memberships/membership-contract.unit.spec.ts` verifies DTO constraints,
  default roles, email normalization, and safe response mapping.
- `test/memberships/membership-retry.unit.spec.ts` verifies both serialization
  error forms, full-operation retries, the attempt limit, and errors not retried.
- `test/memberships/memberships.e2e-spec.ts` uses the real `AppModule`, JWT guard,
  validation, and exception filter with substituted membership service results
  to verify HTTP routing, trusted actor IDs, request IDs, and error responses.
- `test/database/memberships.integration.spec.ts` verifies real membership
  services and HTTP endpoints against PostgreSQL, including scoped roles,
  safe output, idempotence, user preservation, and overlapping owner mutations.
  It also reuses existing JWTs after promotion, demotion, and removal to prove
  that current database permissions govern subsequent requests.

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

`MembershipsService` executes each add, role change, or removal in a
`Serializable` transaction. Within each attempt:

1. authorize the actor as OWNER before resolving the target;
2. for a role change/removal, load the target using `(organizationId, userId)`;
3. for a role change, return the existing safe response without changing
   `updatedAt` when the requested role is unchanged;
4. before demoting or removing an OWNER, count owners in that organization and
   reject with `409 LAST_OWNER_REQUIRED` when the count is below two;
5. perform the write using the same transaction client.

Self-demotion and self-removal follow the same rule. Removing a membership
preserves the global user and their memberships in other organizations.

The transaction wrapper allows at most three total attempts. It recognizes
Prisma `P2034` and a direct `DriverAdapterError` whose
`cause.kind` is `TransactionWriteConflict`, including failures at commit.
Each retry repeats authorization, target lookup, owner counting, and mutation
with a new transaction snapshot. Retrying only the write is insufficient.

Domain errors such as `LAST_OWNER_REQUIRED` and unrelated database errors are
not retried. Exhausted retries and unexpected errors propagate to the shared
filter as safe `500 INTERNAL_SERVER_ERROR` responses; a serialization conflict
is not itself proof that the target is the last owner.

PostgreSQL integration tests deliberately overlap two owner transactions and
cover removal/removal, demotion/demotion, and mixed removal/demotion. They prove
that one operation succeeds, the other returns `LAST_OWNER_REQUIRED` after
retry, and one owner remains.

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

Controllers use decorated DTO classes imported as runtime values.
DTO properties require validation decorators to be accepted.

The global pipe creates DTO instances with implicit property-type
conversion disabled. Validation errors expose only field names and
safe messages; submitted values and validated objects are omitted.
Custom validation messages must not interpolate sensitive values.

UUID route parameters use the shared @UuidParam decorator.
Malformed UUIDs return 400 VALIDATION_ERROR before the controller runs.
Resource existence and authorization are checked separately.

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

Request completion logs contain the effective request ID, HTTP method,
matched route template, final HTTP status, and duration in milliseconds.

Resource IDs are selected from explicitly allowed route parameters and
included only when they are well-formed UUIDs. These IDs are diagnostic
context and do not establish authorization.

Unmatched routes are logged as `<unmatched>`. Request bodies, raw URLs,
query strings, authorization headers, and arbitrary route values are
omitted.

The exception filter additionally emits a `request_failed` event with
the HTTP status and stable application error code. Raw exception
objects, SQL, Prisma error details, and stack traces are omitted.

Seed execution logs selected identifiers on success and fixed messages
on failure. It never logs complete database records or password hashes.

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

## Evaluation security extension — agreed, not yet implemented

### Current authorization and active parents

Every new project resource requires the correct tenant/project scope and active organization/project.

Browser routes derive identity from the verified JWT and current membership. Public trace routes derive project identity from a verified project API key.

Frontend roles, route parameters, client totals and project metadata are not authority.

Preserve existing error ordering and resource concealment. An accessible member lacking a required role receives the documented `403`; an outsider receives a scoped `404`.

### Transaction-aware project access

TSE-64 extends the existing project helper with an optional transaction client:

```ts
assertProjectAccess(
  userId: string,
  organizationId: string,
  projectId: string,
  allowedRoles: readonly MembershipRole[],
  client?: Prisma.TransactionClient,
): Promise<Project>
```

This is a target signature, not the signature implemented at baseline `854da94`.

All nested access checks and queries use the supplied client. The helper does not open or retry transactions.

Domain services own transaction boundaries and must preserve authorization predicates in actual reads and writes.

Retry only recognized transaction conflicts, at most three total attempts, with fresh authorization on every attempt. Exhaustion uses `409 CONCURRENT_MODIFICATION`.

Do not hold transactions open during provider calls, uploads or socket delivery.

A consistent read can precede a concurrent revocation. Repeating a query within that same snapshot does not provide a fresh revocation check.

### API-key separation

Public trace endpoints require `X-API-Key`. A user JWT alone cannot authorize them.

Browser workspace, document, analytics, assistant and key-management routes require JWT authentication. A project key cannot authorize them.

Generate API keys with 32 cryptographically random bytes. Store only their SHA-256 digest and display prefix.

Plaintext disclosure occurs once after successful creation. Never include secrets in URLs, logs, browser persistence, fixtures or screenshots.

Missing, invalid, revoked and archived-parent keys use the same `401 INVALID_API_KEY` response.

The key belongs to its project. Creator removal/demotion does not revoke it automatically; explicit revocation and parent archive invalidate it.

### Shared frontend session behavior

Preserve `auth-session.ts` and its captured-session protection.

A response from an obsolete session must not clear a newer login.

New JSON, multipart, binary and SSE transports must reuse the same authentication/error conventions. Do not create independent token stores.

Provider authentication failures must never become TokenScope user `401` responses.

Abort, permission, not-found, conflict, rate-limit and network failures do not invalidate the user session.

### Resource limits

| Boundary | Agreed limit |
|---|---|
| Public trace routes before key authentication | 60 requests/minute per trusted client IP |
| Public trace routes after key authentication | 120 requests/minute per verified key |
| Browser trace-list/analytics budget | Shared 60 requests/minute per user/project |
| Authorized document uploads | 5/minute per user |
| Realtime connections | 5 simultaneous sockets per user |
| Realtime subscribe attempts | 10 per 10 seconds per socket |
| Assistant concurrency | 1 active request per user |
| Assistant accepted requests | 5/minute per user and 30/minute per project |

Public trace quotas apply across public trace routes. Database retries do not consume another HTTP quota.

Use bounded bookkeeping. Do not introduce Redis for the single-backend evaluation deployment.

Do not trust arbitrary forwarded IP headers. Configure the known proxy boundary and preserve it in tests.

### Realtime access

Verify JWT signature and expiry using the existing token service.

Validate exact allowed browser Origins for polling and WebSocket transport.

Check access when subscribing and again before notifications. Protect asynchronous subscription changes with a generation check.

After committed membership removal or parent archive, revoke affected subscriptions. Demotion to MEMBER retains read access.

At verified token expiry, stop delivery and disconnect.

If current access cannot be verified, do not send project notifications.

### Assistant privacy and cancellation

Send Gemini only the question and allowlisted project/analytics context.

Exclude JWTs, API keys, user emails, raw prompts, arbitrary trace metadata and uploaded documents.

Treat project text and the question as untrusted content. They cannot override instructions or authorize tools.

No tools, document retrieval, conversation persistence or automatic provider retries are introduced.

Use one provider attempt, a maximum of 600 output tokens, a 15-second first-visible-text deadline and a 60-second total provider deadline.

Recheck current access before provider dispatch and through fresh reads during streaming, at the agreed five-second interval. Also enforce verified JWT expiry.

Cancellation, expiry, access loss, timeout and disconnect must release provider work, timers and concurrency slots. Do not promise that client cancellation guarantees the remote provider stops all computation.

Keep provider credentials backend-only. Verify the actual account/model configuration and disclose applicable provider processing accurately. Do not promise zero retention or unlimited free use without evidence.

### Private files

Authorize before accepting upload bytes and again before committing metadata.

Validate extension, media type and content. Enforce actual file-size limits.

Use server-generated storage keys and a private persistent directory. Never use original filenames as paths or expose the directory through static hosting.

Individual deletion schedules durable cleanup after database commit. Parent archive retains bytes.

Orphan cleanup must fail closed when reference checks fail and must preserve files referenced by archived records.

Render Markdown/TXT as inert text. Use a local PDF renderer without enabling document scripts or runtime remote dependencies.

### Evidence

Real PostgreSQL tests must cover tenant isolation, current roles, archived parents, transaction behavior and persistent constraints.

Realtime tests must use real connections. Browser tests must exercise the integrated UI. Provider stubs must remain separate from deliberate live-provider evidence.

Logs and test artifacts must exclude credentials, file contents, questions, complete contexts and answers.
