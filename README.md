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

make start
```

The frontend is available at:

```text
http://localhost:5173
```

For detailed setup instructions, see [Local Development](docs/LOCAL_DEVELOPMENT.md).

## Documentation

* [Local Development](docs/LOCAL_DEVELOPMENT.md) — run and operate the local development environment
* [Onboarding](docs/ONBOARDING.md) — project context and onboarding for new contributors
* [Repository Workflow](docs/REPOSITORY_WORKFLOW.md) — branches, commits, Pull Requests, reviews, and merge rules
* [Architecture](docs/ARCHITECTURE.md) — system architecture and technical structure
* [Data Model](docs/DATA_MODEL.md) — application data model
* [Architecture Decision Records](docs/ADR/README.md) — documented architectural decisions

## Repository structure

```text
tokenscope/
├── backend/
├── frontend/
├── docs/
│   ├── ADR/
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── LOCAL_DEVELOPMENT.md
│   ├── ONBOARDING.md
│   └── REPOSITORY_WORKFLOW.md
├── compose.yaml
├── Makefile
├── .env.example
└── README.md
```

