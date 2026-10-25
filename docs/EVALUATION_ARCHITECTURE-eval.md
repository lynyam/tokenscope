# TokenScope evaluation architecture

> Evaluation preparation copy. Preserve the existing `EVALUATION_ARCHITECTURE.md` and all other develop documents. This explanation links the evaluation copies while reusing the current API, data-model, security, seed and evidence references.

## Purpose

This document explains the architecture for the evaluation scope coordinated by [TSE-63](https://linear.app/move2/issue/TSE-63).

It describes the main request flows, feature responsibilities and shared decisions. Setup instructions are in [LOCAL_DEVELOPMENT-eval.md](./LOCAL_DEVELOPMENT-eval.md); demonstration steps, tested commits, environments and results are in [DEMO-eval.md](./DEMO-eval.md#evaluation-run-record).

## Architecture at a glance

TokenScope has a React frontend, a NestJS application API and a PostgreSQL database accessed through Prisma. The evaluation deployment serves the built frontend and proxies API traffic through Caddy over HTTPS. Private document bytes are stored separately from the database.

| Request flow | Responsibilities |
|---|---|
| Browser → application API | React uses shared authenticated HTTP helpers. NestJS validates requests and checks the user's current organization membership and project access. |
| API → PostgreSQL | Domain services apply business rules and use Prisma. Related authorization checks and data reads share a transaction where consistency is required. |
| External client → public API | A project API key identifies the project for trace operations. The API validates trace data and calculates estimated costs from the applicable historical catalogue price. |
| Trace write → dashboard refresh | A committed change produces a realtime notification. The browser then fetches authoritative analytics through HTTP; notifications carry no dashboard totals. |
| Dashboard → assistant | The browser sends a question, exact dates and filters. The backend reads authorized analytics and project metadata, closes the transaction, and sends a fixed context to Gemini for a streamed answer. |
| Browser → private document | Authenticated project routes check access before returning private bytes. PostgreSQL stores document metadata and cleanup jobs; file storage holds the content. |

The dashboard displays analytics, exports capture the displayed snapshot, and the assistant reads a fresh context for each question. These operations share selection rules but have different responsibilities.

### Shared persistence foundation — TSE-64

The shared persistence foundation includes:

- Organization.archivedAt.
- ApiKey, ModelPrice, Trace, ProjectDocument and FileDeletionJob.
- Database uniqueness, foreign keys, indexes and CHECK constraints.
- Transaction-aware project access.
- Active-parent filtering in existing workspace access paths.
- Canonical fixtures under fixtures/evaluation/.
- EvaluationSeedReceipt for the verified 1.3 dataset, golden anchor and frozen analytics-window end.

TSE-66 reuses the organization archive field and shared access checks. It owns the archive endpoint, confirmation flow and UI.

Feature modules use these models through their own validated and authorized endpoints.

Downstream consumers use the existing generated Prisma client under backend/src/generated/prisma/client.

The evaluation plan targets 16 points against the subject’s 14-point minimum. The module breakdown and mandatory requirements are documented in [README-eval.md](../README-eval.md) and [DEMO-eval.md](./DEMO-eval.md). Points are planned, not awarded; retain existing reports and their limitations in [EVALUATION.md](EVALUATION.md).

## Documentation ownership

| Document | Responsibility |
|---|---|
| `EVALUATION_ARCHITECTURE-eval.md` | Current architecture, ownership and shared decisions |
| `API.md` | HTTP, realtime and streaming contracts |
| `DATA_MODEL.md` | Persistent models, constraints and lifecycle |
| `SECURITY.md` | Authentication, authorization, privacy and access boundaries |
| `LOCAL_DEVELOPMENT-eval.md` | Commands, configuration and environment setup |
| `DEMO-eval.md` | Ordered walkthrough and candidate-specific rehearsal record |
| `EVALUATION.md` | Existing feature evidence, retained with its original SHA, environment and limitations |
| `EVALUATION_SEED.md` / `ANALYTICS_DEMO.md` | Authoritative seed operation, synthetic datasets and exact periods |
| `SPRINT_1_ARCHITECTURE.md` | Historical Sprint 1 architecture and existing foundation |
| `ONBOARDING.md` | Historical product plan, team context and learning material |
| Linear issues | Implementation steps, acceptance criteria, ownership and progress |

Keep API, data-model and security contracts aligned when changing a shared flow. Record new rehearsal results in `DEMO-eval.md`, linking existing `EVALUATION.md` reports without rewriting their outcomes; do not duplicate them here.

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

### Shared frontend transport — TSE-72

Frontend domain adapters use `frontend/src/api/http-client.ts`.

The shared transport provides:

| Export | Purpose |
|---|---|
| `apiGet`, `apiPost`, `apiPatch` | Existing JSON requests |
| `apiDelete` | Existing bodyless DELETE with a required 204 response |
| `request` | JSON requests requiring the explicit method/body/empty-response contract, including organization archive |
| `requestBlob` | Authenticated GET returning private bytes |
| `uploadMultipart` | Multipart POST with measured upload progress and cancellation |
| `apiPostStream` | Authenticated JSON POST returning an unread SSE body |

Paths are relative to `/api/v1`, for example
`/organizations/:organizationId/projects/:projectId/documents`.

External URLs, protocol-relative URLs and paths escaping the API prefix
are rejected. Fetch requests use same-origin mode, reject redirects and
disable response caching. XHR uploads validate their final response URL;
this detects a changed destination after the response and does not
prevent redirects. API routes must return API responses directly.

All transports capture the existing token/revision session snapshot once.
A protected initial HTTP 401 invalidates only that captured session.
Non-authentication failures and cancellation preserve authentication.

`ApiError` retains statusCode, code, message, details and requestId.
Its optional retryAfterSeconds field exposes a valid Retry-After header
for deliberate retry UI. It does not enable automatic retries.

Cancellation is exposed as AbortError. There are no automatic request retries.

`uploadMultipart` sends FormData unchanged and lets the browser generate
the multipart Content-Type boundary. Progress uses browser-reported
loaded/total bytes. An absent total means indeterminate progress.
Reaching 100% does not mean the backend has saved the document.

`apiPostStream` returns:

- body: the original unread ReadableStream.
- requestId: the response correlation identifier, when present.
- isSessionCurrent(): compares the captured session with the current session.
- invalidateSession(): invalidates only the captured matching session.

The caller retains its AbortController throughout stream consumption.
TSE-81 owns UTF-8 decoding, SSE parsing, event validation, terminal states
and cancellation of abandoned streams. A validated ACCESS_TOKEN_EXPIRED
event uses the captured stream's invalidateSession function.
Provider failures do not invalidate the application session.

TSE-79 owns document adapters, response-shape validation, progress UI,
preview/download behavior and object-URL cleanup.

TSE-66 uses request<void>("DELETE", path, { confirmSlug }, options, true).
Existing bodyless DELETE callers keep their current signatures.

Frontend screens/adapters remain responsible for discarding results after
navigation, a selection change or a superseded session.

Transport tests use controlled Fetch responses and XHR events. Browser upload, proxy streaming and cancellation are covered by separate integration demonstrations recorded in [DEMO-eval.md](./DEMO-eval.md).

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
| TSE-86 | Independent Chat/Translation demo and shared trace-submission wrapper |

Each ticket extends the existing application. It does not create an alternative stack or duplicate another ticket’s shared implementation.

## Tenant and resource lifecycle

An organization is the tenant boundary. Projects belong to organizations; user access comes from current organization membership.

Roles remain organization-scoped:

- OWNER manages the organization and memberships.
- OWNER and ADMIN manage projects, API keys and private documents.
- OWNER, ADMIN and MEMBER may read accessible project data and use its dashboard and assistant.

Project API keys are a separate authentication mechanism for public trace operations. They do not authorize browser workspace APIs. User JWTs identify signed-in users; access decisions still use current membership. API-key plaintext is displayed once when created. Frontend controls reflect permissions, while the backend enforces them.

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

Costs are estimates, not provider invoices. Synthetic evaluation prices are labelled separately from prices sourced from provider catalogues. Recording a provider/model in a trace does not itself call that provider.

The dashboard assistant calls Gemini to answer analytics questions. The independent Chat/Translation demo is pending [PR #48 / TSE-86](https://github.com/lynyam/tokenscope/pull/48) integration, not a feature available in this reviewed develop snapshot. Its proposed `callWithTrace` wrapper and separate project keys must be documented and verified after integration; they are not required for the dashboard assistant or evaluation seed.

## Repeatable evaluation data — TSE-70

`make eval-up SEED=1 CONFIRM_DATABASE=tokenscope` explicitly prepares the dataset after trusted-HTTPS readiness. An operator-supplied `DEMO_PASSWORD` lives in the ignored `.env`; normal startup without `SEED=1` does not seed. No development-mode prerequisite or separate price import is needed.

The loader reuses password hashing, trace normalization and historical cost rules. Its 1.3 dataset contains 899 traces: 59 original verification/isolation records plus the 840-trace Analytics Demo across four fictional providers and twelve models. Prices are synthetic; seeding does not call Gemini or create API keys or uploads.

One database transaction and a receipt protect repeatability. Unchanged reruns write nothing; the supported unchanged 1.2-to-1.3 upgrade adds the analytics dataset. Changed/deleted fixtures or collisions cause refusal rather than repair. The receipt preserves the analytics window, so reruns do not refresh historical dates. The golden `ANCHOR` and the analytics seven-day window are separate.

See [EVALUATION_SEED.md](EVALUATION_SEED.md) and [ANALYTICS_DEMO.md](ANALYTICS_DEMO.md) for authoritative commands, migration/upgrade requirements, printed dashboard paths and exact totals. Use separate disposable organizations for mutating demonstrations, and keep [existing evaluation evidence](EVALUATION.md) intact.

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

### Shared filtering implementation — TSE-69

TSE-69 implements the reusable filter foundation in:

- backend/src/traces/trace-filters.ts
- backend/src/traces/dto/trace-query.dto.ts
- backend/src/traces/trace-scope.ts

trace-filters.ts owns shared date resolution, filter normalization and matching
conditions. trace-query.dto.ts adds trace-list pagination and sorting.
trace-scope.ts builds API-key and browser access conditions for trace queries.

Public and browser trace lists reuse these matching rules.
Trace detail uses access scope and trace identity without the list's default
date window.

TSE-71 reuses the shared filter parser and adds parameterized SQL matching
adapters alongside the Prisma adapters. Integration tests compare trace
listing and analytics for the same selection. Analytics aggregates every
matching trace independently of pagination.

Browser trace list, trace detail and analytics share the browser-project-reads quota for each authenticated user/project pair.

TSE-69 reads place authorization, count and rows in one short Repeatable Read
transaction. Each HTTP request obtains a new database snapshot; separate
pagination requests remain live.

TSE-69 delivers trace reads, shared filtering and public trace CRUD.
TSE-71 adds analytics calculations. Dashboard UI, Trace Explorer UI,
exports, assistant integration and WebSocket delivery remain separately
owned features.

### Analytics integration — TSE-71
The implementation is registered through AnalyticsModule, which exports
AnalyticsService.

getSnapshot(scope, query) owns a short Repeatable Read transaction.
readSnapshotInTransaction(tx, scope, query) uses a caller-owned Repeatable
Read transaction and returns snapshot, authorized project metadata and
historical synthetic-pricing information.

The internal method always authorizes access itself. Its transaction must
finish before any assistant provider request. The analytics module has no
dependency on the assistant or realtime modules.
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
| TSE-80 assistant backend | Build a fresh fixed context for one submitted question and stream the provider response |
| TSE-81 assistant frontend | Decode the stream and manage displayed answers, Stop and recoverable errors |

### Realtime — C07

A committed trace creation, actual correction or deletion can publish `traces.changed`.

The event contains no analytics values. The dashboard responds by requesting a fresh HTTP snapshot.

Replay, no-op updates and rolled-back writes do not publish changes.

Notifications are best effort. The dashboard repairs missed events after subscription/reconnection, on visible focus and through the agreed visible-page refresh interval.

Socket authorization checks current membership and active parents. Joining a room once does not authorize every later notification.

TSE-73 implements `/realtime` on `/socket.io`, using the existing HTTP server and
single-process Socket.IO adapter. RealtimeModule consumes TraceChangesService and
AccessChangesService; domain mutation modules import only AccessChangesModule.
This prevents circular imports. No migration, Redis, persistent event queue or replay is added.
The fixed 150 ms window bounds notification/authentication work during bursts.
Origin handling, verified JWT expiry, limits and failure behavior are specified in API.md
and SECURITY.md. TSE-76 owns the displayed dashboard and its recovery HTTP requests.


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

Stop ends TokenScope’s consumption and display of the answer. It does not guarantee that Gemini has stopped processing the request internally. The assistant does not save conversation history, search uploaded documents or perform actions on the user’s behalf.

A small provider interface isolates the Gemini integration. Credentials and model configuration stay on the backend. The live demonstration record identifies the model and account tier used.

No automatic provider retries, paid fallback, conversation storage or assistant-generated project traces are introduced.

## Private documents

File bytes live in private backend storage. PostgreSQL stores metadata and durable deletion jobs.

Authorization occurs before accepting an upload and is checked again before committing metadata.

A successful upload is complete only after the file and metadata are ready. Upload progress reaching 100% is not equivalent to HTTP `201`.

Individual deletion removes metadata and creates a cleanup job in one transaction. File removal occurs after commit, with failed cleanup retried. Normal access ends when the metadata is deleted.

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

Organization archive uses the exported shared `request<void>("DELETE", path, { confirmSlug }, { signal }, true)` from its domain adapter. The last argument requires the documented empty `204` response. No additional DELETE transport wrapper is needed; the shared client keeps ownership of authentication, cancellation and error normalization.

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

Shared contracts and fixtures keep feature modules consistent. The shared foundation owns the `Organization.archivedAt` migration; organization archive reuses that field.

Keep feature verification proportional to changed behavior:

- Unit tests for calculations, validation and state transitions.
- Backend HTTP tests for routes and response contracts.
- Real PostgreSQL tests for transactions, tenant isolation and constraints.
- Frontend component tests under `frontend/test/`.
- Real browser journeys under `frontend/test/e2e/`.
- Separate, deliberate live-provider verification.

Record automated tests, browser checks and live Gemini checks separately in [DEMO-eval.md](./DEMO-eval.md#evaluation-run-record), with the tested commit, environment, commands and PASS, FAIL, BLOCKED or NOT RUN result. The browser matrix records Chrome, Firefox and Edge results. Update the relevant contract documents when behavior changes.
