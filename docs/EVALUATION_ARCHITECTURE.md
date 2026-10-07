# TokenScope evaluation architecture

## Purpose and implementation status

This document defines the agreed architecture for the evaluation scope coordinated by [TSE-63](https://linear.app/move2/issue/TSE-63).

It explains feature ownership, shared dependencies and decisions that multiple implementations must preserve.

Baseline inspected: `develop` at commit `854da94f66582553738591a13a235ec379624394`.

At that baseline:

- Real authentication, organizations, memberships and projects are implemented.
- The frontend uses the shared HTTP client and real backend APIs.
- Projects support soft archiving.
- Organization archiving and the evaluation resources described below are not yet implemented.
- The development environment uses Vite, NestJS and PostgreSQL through Docker Compose.

These statements describe the inspected code, not a new acceptance-test result.

Unless explicitly identified as baseline behavior, the evaluation architecture below is an agreed target awaiting implementation. Feature PRs must update implementation status and attach verification evidence.

The evaluation target is 16 points against a 14-point minimum. The two-point margin is not an additional security module. Mandatory subject requirements remain separate release conditions.

## Documentation ownership

| Document | Responsibility |
|---|---|
| `EVALUATION_ARCHITECTURE.md` | Current architecture, ownership and shared decisions |
| `API.md` | HTTP, realtime and streaming contracts |
| `DATA_MODEL.md` | Persistent models, constraints and lifecycle |
| `SECURITY.md` | Authentication, authorization, privacy and access boundaries |
| `LOCAL_DEVELOPMENT.md` | Commands, configuration and environment setup |
| `DEMO.md` | Reproducible verification and recorded evidence |
| `SPRINT_1_ARCHITECTURE.md` | Historical Sprint 1 architecture and existing foundation |
| `ONBOARDING.md` | Historical product plan, team context and learning material |
| Linear issues | Implementation steps, acceptance criteria, ownership and progress |

Repository documentation records agreed contracts. Code and migrations establish what is implemented. Tests and recorded demonstrations establish what has been verified.

When code, documentation and a ticket disagree, identify the conflict in the PR and resolve the affected contract explicitly. Do not silently implement an older example.

A planned contract does not mean an endpoint, command, table or helper already exists.

## Product scope

The evaluation application supports:

1. Real authentication and organization membership.
2. Organization and project management according to current roles.
3. Project API-key creation and revocation.
4. Public trace creation, reading, correction and deletion.
5. Trace search, filtering, sorting and pagination.
6. Analytics for an explicit project, period and filters.
7. Dashboard refresh after committed trace changes.
8. CSV and PDF export of the displayed analytics snapshot.
9. Private project-document upload, listing, preview, download and deletion.
10. A streamed assistant answer grounded in the selected dashboard scope.
11. Trusted HTTPS, public Privacy/Terms pages and browser verification.

The evaluation scope does not introduce RAG, embeddings, document chat, a prompt playground, conversation persistence, persisted analytics snapshots, project-specific roles or resource restoration.

Uploaded documents are an independent private-file feature. They are not assistant context.

## Existing foundation to reuse

### Backend

Reuse:

- `backend/src/configure-app.ts`
- `backend/src/database/prisma.service.ts`
- `backend/src/auth/guards/jwt-auth.guard.ts`
- `backend/src/auth/token.service.ts`
- `backend/src/memberships/organization-access.service.ts`
- `backend/src/projects/project-access.service.ts`
- Existing validation, request-ID and error infrastructure.

Controllers validate and delegate. Domain services own business rules and transaction boundaries. Access services implement shared tenant and role checks.

Use the existing generated Prisma client under `backend/src/generated/prisma`.

Do not introduce a second Prisma client lifecycle, authorization framework or generic repository layer.

### Frontend

Reuse:

- `frontend/src/api/http-client.ts`
- `frontend/src/api/auth-session.ts`
- `frontend/src/context/AuthContext.tsx`
- Existing API adapters, routes, controls and loading/error conventions.

Feature API adapters call the shared transport. Components do not independently read bearer-token storage or recreate HTTP error handling.

Existing session protection must remain intact: a late failure from an earlier session must not invalidate a newer login.

The existing `project-events.ts` synchronizes confirmed project writes within one browser runtime. It is not a WebSocket implementation and does not synchronize different clients.

## Feature ownership

| Tickets | Responsibility |
|---|---|
| TSE-63 | Integrated scope, dependencies and completion |
| TSE-64 | Additive schema, transaction-aware project access and shared fixtures |
| TSE-65 | Trusted HTTPS and evaluation startup using the existing Compose stack |
| TSE-66 | OWNER organization deletion through soft archive |
| TSE-67 / TSE-74 | API-key backend / management UI |
| TSE-68 | Trace ingestion, normalization, replay detection and historical cost calculation |
| TSE-69 / TSE-75 | Public trace CRUD and browser read/search API / Trace Explorer |
| TSE-70 | Explicit, repeatable evaluation seed |
| TSE-71 | Shared analytics calculations and consistent snapshots |
| TSE-72 | Necessary authenticated upload, binary and streaming transport |
| TSE-73 | Authorized realtime invalidations and access-revocation notifications |
| TSE-76 | Dashboard selection, charts and refresh scheduling |
| TSE-77 | Local CSV/PDF export of a captured dashboard snapshot |
| TSE-78 / TSE-79 | Private-document backend / document UI |
| TSE-80 / TSE-81 | Assistant backend / assistant UI |
| TSE-82 | Accurate public Privacy and Terms pages |
| TSE-83 | Evaluation documentation and reproducible demonstration |
| TSE-84 | Chrome, Firefox and Edge verification |
| TSE-85 | Final candidate validation and team rehearsal |

Each ticket extends the existing application. It does not create an alternative stack or duplicate another ticket’s shared implementation.

## Tenant and resource lifecycle

An organization is the tenant boundary. Projects belong to organizations; user access comes from current organization membership.

Roles remain organization-scoped:

- OWNER manages the organization and memberships.
- OWNER and ADMIN manage projects, API keys and private documents.
- OWNER, ADMIN and MEMBER may read accessible project data and use its dashboard and assistant.

Project API keys are a separate authentication mechanism for public trace operations. They do not authorize browser workspace APIs.

Organization deletion sets `Organization.archivedAt`. Project deletion preserves the existing project archive behavior.

Archiving a parent:

- Retains child rows and private files.
- Makes the parent and its resources inaccessible through normal APIs.
- Invalidates access through retained project API keys.
- Revokes affected realtime subscriptions.
- Stops affected assistant streams through fresh access checks.
- Preserves slug reservations.
- Does not expose a restore or archive-bypass option.

Do not add archive flags to every child merely to mirror its parent.

Individual trace deletion uses a tombstone and retains external-ID uniqueness. Individual document deletion removes metadata and schedules durable private-file cleanup.

## Trace ingestion and historical costs

Public clients authenticate with a project API key. The verified key determines the project.

TSE-68 owns one reusable implementation of:

- Payload validation and normalization.
- Canonical payload hashing.
- Applicable historical price selection.
- Exact Decimal cost calculation.
- Creation versus identical replay.

TSE-69 reuses those rules for correction.

An unchanged replay or no-op correction does not reprice a trace. A genuinely changed correction recalculates its stored costs using the applicable historical price.

Reads and analytics sum stored costs. Adding a new price does not rewrite historical traces.

Costs are estimates, not provider invoices. Synthetic evaluation prices must be identified as synthetic.

## Selection and analytics

The dashboard owns one applied selection:

- Organization and project.
- Explicit UTC `from` and `to`.
- Applied search and filters.

Relative labels such as “Last 7 days” are resolved into exact dates. Refreshing the same selection must not silently move its date boundaries.

Trace listing, analytics and assistant context share matching semantics:

- `from <= occurredAt < to`.
- Active organization and project.
- Correct tenant and project.
- Non-deleted traces.
- The same normalized filter meanings.

Pagination and sorting belong to trace lists. They must not limit analytics or assistant context.

TSE-71 calculates all matching data in a short Repeatable Read transaction. Summary, series, model groups, authorized project metadata and internal pricing information must use the same transaction when needed together.

Its transaction-aware entry point must authorize the caller itself. It does not accept an authorization-bypass flag.

A snapshot ID identifies a generated result. It is not a persisted database snapshot or resumable session.

## Dashboard, realtime, exports and assistant

These features have different responsibilities:

| Feature | Data responsibility |
|---|---|
| TSE-71 analytics | Calculate an authoritative HTTP snapshot |
| TSE-73 realtime | Announce that project trace data changed |
| TSE-76 dashboard | Fetch and display snapshots for the applied selection |
| TSE-77 export | Capture and serialize the displayed snapshot |
| TSE-80 assistant | Build a fresh fixed context for one submitted question |

### Realtime

A committed trace creation, actual correction or deletion can publish `traces.changed`.

The event contains no analytics values. The dashboard responds by requesting a fresh HTTP snapshot.

Replay, no-op updates and rolled-back writes do not publish changes.

Notifications are best effort. The dashboard repairs missed events after subscription/reconnection, on visible focus and through the agreed visible-page refresh interval.

Socket authorization checks current membership and active parents. Joining a room once does not authorize every later notification.

### Exports

At the user’s click, capture the confirmed dashboard snapshot and authorized project identity.

CSV and PDF generators use only that captured input. They do not refetch analytics or read changing React state while generating.

The exported report includes its exact scope and generation time. A same-selection background refresh may continue without changing an export already being generated.

Exports are generated locally in the browser. No backend export endpoint is required.

### Assistant

The browser sends a question, explicit dates and applied filters.

It does not send trace IDs, raw traces, calculated totals or trusted project metadata.

The backend:

1. Authenticates and authorizes the user.
2. Uses TSE-71 to read consistent analytics, project name/description and pricing information.
3. Builds and validates a bounded context.
4. Finishes the database transaction.
5. Calls the configured Gemini model.
6. Streams the answer using that fixed context.

The assistant context may be newer than the dashboard’s displayed snapshot. Its returned timestamp and scope make that distinction visible.

New trace data does not change an answer already in progress. A new question gets a new context.

Changing project, dates or filters stops and clears the previous answer. A same-selection dashboard refresh does not.

Authorization remains live even though answer data is fixed.

Use a small provider interface with one Gemini implementation. Keep credentials and model configuration on the backend. Verify model availability and account eligibility before the live demonstration; do not assume unlimited free usage.

No automatic provider retries, paid fallback, conversation storage or assistant-generated project traces are introduced.

## Private documents

File bytes live in private backend storage. PostgreSQL stores metadata and durable deletion jobs.

Authorization occurs before accepting an upload and is checked again before committing metadata.

A successful upload is complete only after the file and metadata are ready. Upload progress reaching 100% is not equivalent to HTTP `201`.

Individual deletion removes metadata and creates a cleanup job in one transaction. File removal occurs after commit.

Orphan cleanup must treat files referenced by archived parents as referenced. Archive is not permission to delete those bytes.

PDF preview uses a local renderer. TXT and Markdown are displayed as inert text. Documents are not sent to Gemini.

## Necessary shared helpers

Create or extend a helper only when a concrete consumer needs it.

| Shared implementation | Why it is needed |
|---|---|
| Transaction-aware access checks | Authorization and data reads must use the caller’s transaction |
| Trace normalization and cost calculation | Ingestion, corrections and fixtures must agree |
| Resolved trace-filter rules | Explorer, analytics and assistant must match the same records |
| Shared analytics service | Dashboard and assistant must not calculate different totals |
| Shared authenticated transport | Uploads, private files and SSE must preserve existing session/error behavior |
| Small provider interface | Keep Gemini SDK details outside assistant orchestration |
| Shared rate limiter | Enforce agreed quotas across applicable endpoints |

Do not add generic frameworks, speculative adapters or duplicate wrappers.

For organization DELETE with a confirmation body, reuse the existing request implementation. At the inspected baseline, `request()` is private; TSE-66 must make the minimal compatible change needed by its adapter.

## Deployment and configuration

TSE-65 extends the existing Compose project:

- Development: Vite and NestJS watch mode.
- Evaluation: built frontend served by Caddy and compiled NestJS.
- Same service names, configuration source and PostgreSQL volume.
- Browser requests remain same-origin.

TSE-73 adds Socket.IO proxy support. TSE-80 verifies SSE streaming and cancellation through the evaluation proxy. TSE-78 adds persistent private-file storage.

Backend configuration uses validated values with `skipProcessEnv: true`. Adding a variable only to Compose is insufficient: update the typed validation return value and its consumers.

No backend secret belongs in frontend environment variables or the browser bundle.

## Integration and verification rules

Publish stable contracts and fixtures early so consumers can develop without waiting for complete pages.

Coordinate TSE-64 and TSE-66 before generating migrations. Only one migration may add `Organization.archivedAt`.

Keep feature verification proportional to changed behavior:

- Unit tests for calculations, validation and state transitions.
- Backend HTTP tests for routes and response contracts.
- Real PostgreSQL tests for transactions, tenant isolation and constraints.
- Frontend component tests under `frontend/test/`.
- Real browser journeys under `frontend/test/e2e/` once browser infrastructure is introduced.
- Separate, deliberate live-provider verification.

Do not report mocked tests as database integration or browser tests as proof of live Gemini behavior.

Before merging, record the tested commit, actual commands, results and remaining limitations. Update the relevant contract documents in the same PR.
