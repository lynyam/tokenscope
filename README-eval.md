*This project has been created as part of the 42 curriculum by ynyamets, lfirmin, dinados-, mcamaren, falatrac.*

# TokenScope

> Evaluation preparation copy. The existing `README.md` and unsuffixed documentation remain unchanged. Start here for the evaluation walkthrough; shared API, security, seed and evidence documents retain their existing names. Before final delivery, reconcile the required content into the root README and review it against the selected evaluation commit.

**Collaborative LLM cost observability for engineering teams.**

## Description
### Overview

TokenScope helps teams understand how their applications use language models and what that usage is likely to cost. External applications submit execution traces that include the provider and model identifiers, workflow, token counts, latency and outcome. TokenScope stores these traces within a project, applies historical catalogue prices to estimate cost, and makes the data available through authenticated workspace APIs and project analytics.

### Goals
+ Visibility: give teams a clear, centralized view of language model usage across their applications.
+ Cost awareness: estimate spending from historical catalogue prices so teams can track and anticipate costs.
+ Performance insight: surface latency and outcome data to help teams assess how models behave in their workflows.
+ Controlled collaboration: let organizations share usage data with the right people through role-based access.

### Key Features
+ Trace ingestion: external applications submit execution traces with provider/model identifiers, workflow, token counts, latency and outcome.
+ Historical cost estimation: catalogue prices are applied according to when each trace occurred.
+ Organizations and projects: users and projects are grouped into organizations, with membership roles controlling access.
+ Authenticated APIs: workspace APIs expose stored traces and analytics.
+ Analytics dashboard: usage and cost analytics, trace filtering and realtime updates.
+ Exports: usage data can be exported to CSV and PDF.
+ Project documents: private documents can be stored within each project.
+ Gemini assistant: a built-in assistant in the dashboard.

## Instructions

### Prerequisites

On the host: Git, Docker with its daemon running, Docker Compose v2 with `--wait` support, Make, curl and OpenSSL. Containers use Node.js 24, PostgreSQL 16 and Caddy 2; host Node.js is unnecessary for container startup. Earlier documentation reported Ubuntu 25.10, Docker 29.4.0, Docker Compose 5.1.2 and GNU Make 4.4.1; this is not a verified result for the final candidate. Record the actual commit, host and versions in the evaluation run record.

### Start the HTTPS evaluation application

From your chosen parent directory on the host, use a fresh checkout. Replace `EVALUATION_COMMIT` below with the full SHA selected from integrated `develop` for the rehearsal; use that same SHA in every guide and report:

```sh
git clone --branch develop https://github.com/lynyam/tokenscope.git
cd tokenscope
git checkout --detach EVALUATION_COMMIT
git rev-parse HEAD
make eval-up
```

`make eval-up` prepares `.env` from `.env.example` when absent, generates a missing JWT secret, builds the application, applies committed migrations and checks HTTPS readiness. Without `SEED=1`, it does not seed evaluation accounts or traces. Expected completion: `TokenScope is running: https://localhost:8443`.

Local `.env` values are private. Replace the template database password for your environment and keep `DATABASE_URL` consistent. Never commit generated credentials, project keys or a demo password.

Trust the exported local Caddy CA once. On macOS, from the repository root:

```sh
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain \
  .local/eval/caddy-root.crt
```

This changes the host trust store and requires administrator authorization. Restart the browser and open `https://localhost:8443` without bypassing a certificate warning. Other systems and browser-specific trust stores are covered in [Local Development](docs/LOCAL_DEVELOPMENT-eval.md#trust-the-local-certificate).

Verify database readiness from the host:

```sh
curl --fail --show-error --max-time 10 \
  --cacert .local/eval/caddy-root.crt \
  https://localhost:8443/api/v1/health/db
```

Expected: HTTP 200 with `{"status":"healthy"}`. Create an account through the signup page, or use the evaluation accounts configured with the evaluation dataset.

### Evaluation data, provider setup and tests

- **Evaluation data:** TSE-70 is implemented. Set your own 8–128-character `DEMO_PASSWORD` in the existing ignored `.env`, keep `EVALUATION_SEED_ENABLED=false`, and confirm the actual database name. From the host repository root, `make eval-up SEED=1 CONFIRM_DATABASE=tokenscope` starts HTTPS and prepares the data in one command; no `make up`, development seed or separate price import is required. On an already-running backend with current migrations, use `make eval-seed CONFIRM_DATABASE=tokenscope`. See [Evaluation seed](docs/EVALUATION_SEED.md) for prerequisites, conflict safeguards and success outcomes.
- **Analytics Demo:** use its 840 traces across four fictional providers and twelve models for the varied seven-day dashboard; keep Support Golden for exact six-trace assertions. The complete seed has 899 traces. Use the printed `analyticsDemo.dashboardPath` and `analyticsDemo.range` after the fixed data ages out of “Last 7 days.” Reruns do not move dates or reset changed data. Prices are synthetic; see [Analytics Demo](docs/ANALYTICS_DEMO.md).
- **Dashboard assistant:** configure Gemini credentials and the model on the backend. Provider credentials stay on the server. Set `GEMINI_API_KEY` and `LLM_MODEL` in the root `.env`, then run `make eval-up` again. Without them, the assistant returns `503 LLM_UNAVAILABLE` and the rest of the application still works. See [Configure the Gemini assistant](docs/LOCAL_DEVELOPMENT-eval.md#configure-the-gemini-assistant).
- **External demo — pending integration:** the standalone Chat/Translation application belongs to [PR #48 / TSE-86](https://github.com/lynyam/tokenscope/pull/48), not the reviewed develop snapshot. Do not require it for this startup or claim it is available until that PR is merged and verified on the selected candidate.
- **Tests:** see [Local Development](docs/LOCAL_DEVELOPMENT-eval.md) for commands and [the evaluation guide](docs/DEMO-eval.md) for demonstration steps and expected results.
- **Shutdown:** run `make stop` from the repository root to stop the application while keeping its data. `make start` resumes it. `make clean` removes containers and the network while retaining volumes. `make fullclean` also deletes volumes, including the database and local certificate authority.

## Resources

- [React documentation](https://react.dev/learn) — component and state concepts.
- [NestJS documentation](https://docs.nestjs.com/) — backend modules and request handling.
- [Prisma documentation](https://www.prisma.io/docs) — schema, client and migrations.
- [PostgreSQL documentation](https://www.postgresql.org/docs/) — relational database reference.
- [Docker Compose documentation](https://docs.docker.com/compose/) — container application configuration.
- [Gemini API documentation](https://ai.google.dev/gemini-api/docs) — provider requests, response handling and configuration.


### AI Usage

The team used AI as an assistant, not as a replacement for understanding. It helped us:

- understand tickets and learn unfamiliar concepts (NestJS, Prisma, JWT, streaming, Docker);
- interpret error messages and debug;
- draft code, tests and documentation, including the external Chat/Translation demo and this README.

[CodeRabbit](https://www.coderabbit.ai/) automatically reviewed our pull requests, which sped up our reviews by catching issues before a teammate's review.

Team rule: nobody merges code they cannot explain. Every AI suggestion is reviewed, tested and discussed in the pull request.


## Team Information

The team combines development work with product, coordination and architecture responsibilities.

| Team member | 42 login | Role and responsibility |
|---|---|---|
| Yawovi Leon Nyametso | `ynyamets` | Technical Lead/Architect, Project Manager and Developer. Designs each next sprint (API contracts, data model, ADRs), plans the work, reviews and merges pull requests. |
| Léo Firmin | `lfirmin` | Developer. Owns the shared UI and responsive layout, the analytics dashboard, exports and the assistant frontend. |
| Dina Maria Dos Santos Monteiro | `dinados-` | Developer and main code reviewer. Owns organizations and projects, HTTPS evaluation startup, documents and the Trace Explorer. |
| Monica Francesca Camarena Pucuhuanca | `mcamaren` | Developer. Owns authentication (pages, APIs, JWT guard) and the assistant backend. |
| Fatin Alatrach | `falatrac` | Developer and Product Owner. Helps clarify the product's value and keep its documentation aligned with user needs and delivered features. |

**Summary:** Product Owner: Fatin. Project Manager and Technical Lead: Leon. Developers: all members.

## Project Management

Work is organized through [Linear](https://linear.app)  tickets identified by `TSE-…`, Git branches and GitHub pull requests. WhatsApp is used for team communication. The repository workflow starts ticket branches from `develop`, requests review, and reserves `main` for stable milestone releases. See [Repository Workflow](docs/REPOSITORY_WORKFLOW.md).

Feature documentation, setup instructions and the evaluation guide provide a shared reference for the team.

- **Meetings:** weekly demo on Friday where each owner shows their progress, plus ad hoc pairing when someone is blocked.
- **Priorities and assignments:** work is split into sprints. The Technical Lead prepares the next sprint (contracts, acceptance criteria), then each ticket gets one owner.
- **Reviews:** every pull request is reviewed by at least one teammate (and CodeRabbit) before Leon merges it into `develop`.

## Technical Stack

Exact dependency versions are recorded in the frontend and backend `package-lock.json` files.

| Layer | Technologies | Purpose |
|---|---|---|
| Frontend | React 19, TypeScript, Vite 8, React Router | Component-based screens, typed API integration and browser navigation. |
| Styling | Tailwind CSS 4, shared UI components | Consistent responsive layouts, typography and interactive controls. |
| Backend | NestJS 11, TypeScript, Node.js 24 | Modules, controllers, validation and shared authentication/authorization. |
| Persistence | PostgreSQL 16, Prisma 7 | Relational organizations/memberships/projects, foreign keys, transactions and migrations. |
| Authentication | JWT, Argon2 password hashing | Signed user access tokens and password verification; project API keys form a separate mechanism. |
| Realtime | Socket.IO, Vite/Caddy proxying | Authorized project-change notifications after committed writes. |
| Deployment | Docker Compose, Make, Caddy 2 | One application stack with development and trusted-HTTPS evaluation modes. |
| Tests | Jest, Vitest, Testing Library, Playwright | Backend, frontend and browser tests. |
| Provider integration | Gemini | Context-aware dashboard answers. The independent Chat/Translation demo is pending PR #48 integration. |

The application has a modular backend and a separate browser frontend. PostgreSQL supports the relationships between users, organizations and projects, as well as transactional trace writes. Prisma provides typed database access and migrations. Main reasons:

- **React + Vite:** clear ecosystem, component model and fast iteration.
- **Tailwind CSS:** fast, responsive and reusable styling.
- **NestJS:** modular architecture with built-in validation and WebSocket support.
- **PostgreSQL:** strong relations, analytics queries and reliable transactions.
- **Prisma:** typed schema and migrations.
- **Docker Compose:** one reproducible command to start the whole stack.
- **TypeScript everywhere:** one language and shared types for the whole team.

## Database Schema

The [Prisma schema](backend/prisma/schema.prisma) defines the models, and [migrations](backend/prisma/migrations) track database changes. [Data Model](docs/DATA_MODEL.md) explains the relationships and constraints in more detail.

| Entity | Important fields and types | Relationships / purpose |
|---|---|---|
| `User` | `id: String`, unique `email`, `passwordHash`, `displayName` | Has memberships; can create keys and upload documents. |
| `Organization` | `id`, unique `slug`, `name`, nullable `archivedAt: DateTime` | Contains memberships and projects. |
| `Membership` | `userId`, `organizationId`, `role: OWNER/ADMIN/MEMBER` | Links a user to an organization; pair is unique. |
| `Project` | `organizationId`, `name`, `slug`, optional description/archive timestamp | Belongs to one organization; slug is unique within it. |
| `ApiKey` | `projectId`, unique `keyHash`, display prefix, creation/revocation dates | Stores a digest rather than the plaintext project credential. |
| `ModelPrice` | provider/model, `effectiveFrom`, rates `Decimal(18,6)`, synthetic flag | Historical price versions; provider/model/effective date is unique. |
| `Trace` | project/external ID, integer tokens/latency, status, dates, JSON metadata, costs `Decimal(24,12)` | References a price version and stores copied historical rates. Deleted rows retain the external-ID reservation. |
| `ProjectDocument` | project/uploader IDs, storage key, MIME type, byte size, SHA-256 | Stores metadata for private project files and links each upload to its project and uploader. |
| `FileDeletionJob` | storage key, attempts, next-attempt date, error code | Tracks file cleanup after document metadata has been deleted. |
| `EvaluationSeedReceipt` | seed version, fingerprints, golden anchor, nullable analytics-window end | Verifies repeatability and the supported seed upgrade without storing plaintext passwords or restoring deleted data. |

Organization/project archive removes ordinary access while retaining related records. There is no application restore feature in this MVP. User accounts and unrelated organizations remain usable.

## Architecture

```mermaid
flowchart LR
    B[Browser / React] -->|HTTPS and user JWT| P[Caddy / application API]
    X[External application] -->|HTTPS and project API key| P
    P --> N[NestJS: validation and authorization]
    N -->|Prisma| D[(PostgreSQL)]
    N -->|Committed change notification| B
    B -->|Refetch authoritative analytics| P
    N -->|Assistant requests and streaming responses| G[Gemini]
    N -->|Authorized document access| S[Private file storage]
```

The diagram shows the HTTPS evaluation setup. Development uses Vite's proxy.

- **Browser to API:** shared HTTP helpers carry the user session. NestJS checks the user's current membership and permissions for each resource.
- **External client to API:** a project API key scopes trace operations to its active project. Workspace routes use user authentication instead.
- **Trace to dashboard:** the backend computes analytics and announces committed changes. The browser then fetches updated totals through the API, keeping charts and summaries consistent.
- **Exports:** CSV and PDF files are generated in the browser from the displayed data snapshot, preserving the selected dates and filters.
- **Assistant:** the browser sends a question with the selected dates and filters. The backend builds an authorized snapshot of the project's analytics and streams a Gemini answer. Each new request uses its own snapshot; uploaded documents are excluded from the context.
- **Private documents:** authenticated project routes check access before returning files. Archiving a parent organization or project retains its data. Deleting an individual document removes its metadata and schedules file cleanup.

Detailed boundaries: [Evaluation Architecture](docs/EVALUATION_ARCHITECTURE-eval.md), [API](docs/API.md), [Security](docs/SECURITY.md).

## Features List

| Feature | What it provides | Contributors |
|---|---|---|
| Public landing page | Responsive product introduction, audience and workflow explanations, real demo screenshots and authentication links. | Fatin (landing page); Léo (shared UI and responsive layout). |
| Authentication and workspaces | Signup/signin, organizations, projects and membership-based access. | Monica (authentication); Dina (organizations and projects); Leon (memberships, data model, authorization); Léo (UI). |
| Organization archive | Owner confirmation, retained records and access-loss handling. | Dina. |
| HTTPS deployment | A single Docker Compose stack served through Caddy with a trusted local certificate. | Dina (HTTPS evaluation startup); Leon (local Docker environment). |
| Project API keys and trace API | Project-scoped credentials, key revocation, trace creation, retrieval, replacement and deletion, plus historical cost estimates. | Leon (keys, trace API, pricing); Dina (API-key UI). |
| Trace Explorer | Combined filters, sorting, pagination and trace details. | Dina (explorer UI); Leon (shared search backend). |
| Analytics dashboard | Usage, estimated costs, latency and errors, with date/filter selection, realtime refresh and CSV/PDF exports. | Leon (analytics backend, realtime); Léo (dashboard UI, exports). |
| Private documents | Validated PDF, TXT and Markdown uploads, progress feedback, preview, download and deletion. | Dina (documents backend and UI); Leon (upload transport). |
| Dashboard assistant | Streamed Gemini answers based on authorized project analytics, with Stop, error handling and rate limits. | Monica (backend); Léo (frontend); Leon (streaming UI integration). |
| Privacy Policy and Terms of Service | Public English legal pages accessible without signing in, linked through the public navigation. | Fatin. |
| External Chat and Translation demo — pending | Proposed in PR #48; not part of this integrated candidate yet. Requires its own setup and verification after merge. | Fatin. |

See [Individual Contributions](#individual-contributions) for each teammate's responsibilities, tools and challenges.


## Modules

Our selected modules target **16 planned points**, above the subject's minimum of 14. These are not awarded or verified points; each claim needs candidate-specific evidence. They support TokenScope's core workflow: collecting traces, understanding spending and collaborating within a shared workspace. The [evaluation guide](docs/DEMO-eval.md#mandatory-requirements) also covers the mandatory project requirements.

| Module | Type / planned points | How it fits TokenScope |
|---|---|---|
| Framework for both frontend and backend | Major / 2 | React and NestJS structure the browser application and API. |
| ORM | Minor / 1 | Prisma provides typed database access, migrations and PostgreSQL persistence. |
| Organization system | Major / 2 | Organizations, memberships and roles give teams a shared workspace with controlled access. |
| Public API | Major / 2 | Project keys, quotas and five trace operations allow external applications to submit and manage their usage data. |
| Realtime features | Major / 2 | Authorized Socket.IO notifications keep project views up to date after data changes. |
| Advanced analytics dashboard | Major / 2 | Interactive charts, date and filter selection, realtime refresh and exports help teams investigate usage and spending. |
| Complete LLM system interface | Major / 2 | The Gemini assistant explains project analytics through streamed responses, with error handling and rate limits. |
| File upload and management | Minor / 1 | Private PDF, TXT and Markdown files can be uploaded, previewed, retrieved and deleted within a project. |
| Advanced search | Minor / 1 | Combined trace filters, sorting and pagination help users find relevant executions. |
| Additional browsers | Minor / 1 | Firefox and Edge complement Chrome. The evaluation guide contains the browser-results template; Chrome, Firefox and Edge results must be recorded for the candidate before claiming compatibility. |
| **Planned total** | **16** | **Six major and four minor modules; final acceptance remains to be demonstrated.** |

Module contributors:

- **Frameworks:** whole team; Leon set up the repository and NestJS foundation.
- **ORM:** Leon.
- **Organization system:** Dina, Leon.
- **Public API:** Leon; Dina (API-key UI).
- **Realtime features:** Leon; Dina (Trace Explorer integration).
- **Advanced analytics dashboard:** Leon (backend); Léo (UI and exports).
- **Complete LLM system interface:** Monica (backend); Léo (frontend).
- **File upload and management:** Dina; Leon (upload transport).
- **Advanced search:** Dina (UI); Leon (backend).
- **Additional browsers:** Léo (responsive UI); Firefox and Edge test runs are still pending in the evaluation guide.


## Individual Contributions

| Contributor | Tickets | Contributions | Challenges and learning | Tools |
|---|---|---|---|---|
| Yawovi Leon Nyametso | TSE-10, 13, 15, 31, 35, 37, 40, 42, 45, 49, 61, 62, 64, 67, 68, 69, 71, 72, 73 | Architecture, backend authorization, traces, pricing, analytics and realtime integration. | Keeping authorization, historical prices and analytics consistent across modules, while preparing each sprint ahead of the team. | NestJS, Prisma, PostgreSQL, Socket.IO, Jest, Docker Compose, ADRs. |
| Léo Firmin | TSE-48, 50, 51, 52, 54, 76, 77, 81, 88, 89 | Shared UI, dashboard, exports and assistant frontend. | Merging long UI branches with a fast-moving `develop`; learned to rebase often and to share UI components. | React, Tailwind CSS, shadcn/ui, Vitest, Testing Library. |
| Dina Maria Dos Santos Monteiro | TSE-32, 34, 36, 39, 41, 47, 60, 65, 66, 74, 75, 78, 79, 87 | Organizations and projects, HTTPS setup, organization archive, API-key UI, Trace Explorer and documents. | Trusted local HTTPS with Caddy and safe private file uploads; learned Docker volumes and upload validation. | React, NestJS, Prisma, Caddy, Docker Compose, Vitest, Jest. |
| Monica Francesca Camarena Pucuhuanca | TSE-33, 38, 59, 80, 92 | Authentication (pages, APIs, JWT guard) and assistant backend. | Learned JWT authentication and streaming Gemini answers to the browser; handled users who lose access to an organization. | React, NestJS, JWT, Argon2, Gemini API, Jest. |
| Fatin Alatrach | TSE-55, TSE-82, TSE-86, TSE-83 | Built the landing and legal pages and project documentation; authored the external Chat/Translation demo in pending PR #48. | Joined after the idea and architecture were established. Learned the codebase and earlier decisions with the team's support, then contributed through focused tickets. | React, Tailwind CSS, Node.js, Gemini API, Vitest/Jest, Markdown, Git/GitHub. |


## Product Scope and Limitations

TokenScope provides estimated LLM costs rather than billing totals. Its assistant answers questions using project analytics; uploaded documents and previous conversations are not included. Archived organizations and projects retain their data, but cannot be restored through the application.

## Documentation Map

| Document | Purpose |
|---|---|
| [Local Development](docs/LOCAL_DEVELOPMENT-eval.md) | Setup, commands, configuration and shutdown. |
| [Evaluation guide](docs/DEMO-eval.md) | Setup for the demonstration, feature walkthroughs, expected results and test reports. |
| [Evaluation Architecture](docs/EVALUATION_ARCHITECTURE-eval.md) | Evaluation architecture explanation and feature responsibilities. |
| [Evaluation seed](docs/EVALUATION_SEED.md) / [Analytics Demo](docs/ANALYTICS_DEMO.md) | Existing authoritative seed commands, synthetic catalogue, periods and verified fixture expectations. |
| [Evaluation evidence](docs/EVALUATION.md) | Preserved feature evidence, including the TSE-88 report and its limitations; not a blanket final-candidate PASS. |
| [API](docs/API.md) / [Public API](docs/PUBLIC_API.md) | HTTP, realtime and streaming contracts; implemented public trace API. |
| [Data Model](docs/DATA_MODEL.md) / [Security](docs/SECURITY.md) | Persistent invariants, authorization and lifecycle boundaries. |
| [Sprint 1 Architecture](docs/SPRINT_1_ARCHITECTURE.md) / [Onboarding](docs/ONBOARDING.md) | Sprint 1 architecture, original product plan and team onboarding. |
| [Repository Workflow](docs/REPOSITORY_WORKFLOW.md) / [ADRs](docs/ADR/README.md) | Collaboration rules and architectural decisions. |
