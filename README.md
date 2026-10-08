# TokenScope

**Collaborative LLM Cost Observatory**

## One-sentence pitch

TokenScope is a collaborative platform that helps engineering teams understand where their LLM spending comes from by collecting usage traces, calculating estimated cost, visualizing live analytics, and generating grounded optimization recommendations.

## Core promise

> TokenScope turns raw LLM telemetry into understandable engineering decisions.

## Stack

* **Frontend:** React + TypeScript + Vite
* **Backend:** NestJS + TypeScript
* **Database:** PostgreSQL
* **Development environment:** Docker Compose + Make

## Quick start

### Requirements

* Git
* Docker
* Docker Compose
* Make

### Clone and start

```bash
git clone git@github.com:lynyam/tokenscope.git
cd tokenscope

cp .env.example .env
```
Generate a local JWT signing secret:

```bash
docker run --rm node:24-alpine \
  node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'
```
Copy the generated value into:
JWT_SECRET=<generated-value>
in your local .env. Never commit .env.

Start the application:
```bash
make up
make db-setup
```

The frontend is available at:

```text
http://localhost:5173
```
Backend endpoints are exposed to the browser through the Vite proxy under:
```bash
/api/v1
```
Health checks:

```bash
http://localhost:5173/api/v1/health
http://localhost:5173/api/v1/health/db
```
Verify the backend foundation

```bash
make test-backend
```

For detailed setup instructions, see [Local Development](docs/LOCAL_DEVELOPMENT.md).

## Documentation

* [Local Development](docs/LOCAL_DEVELOPMENT.md) — local setup, Docker, environment, and tests
* [M1 API Contract](docs/API.md) — HTTP routes, validation, request IDs, and errors
* [M1 Security](docs/SECURITY.md) — authentication, authorization, tenant isolation, and secret handling
* [Sprint 1 Architecture](docs/SPRINT_1_ARCHITECTURE.md) — M1 backend architecture and dependency rules
* [Data Model](docs/DATA_MODEL.md) — application data model and invariants
* [M1 Demo](docs/DEMO.md) — executable M1 verification and demo procedure
* [Onboarding](docs/ONBOARDING.md) — project context and contributor onboarding
* [Repository Workflow](docs/REPOSITORY_WORKFLOW.md) — branches, commits, pull requests, and reviews
* [Architecture Decision Records](docs/ADR/README.md) — documented architectural decisions
## Repository structure

```text
tokenscope/
├── backend/
├── frontend/
├── docs/
│   ├── ADR/
│   ├── SPRINT_1_ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── LOCAL_DEVELOPMENT.md
│   ├── ONBOARDING.md
│   └── REPOSITORY_WORKFLOW.md
├── compose.yaml
├── Makefile
├── .env.example
└── README.md
```

