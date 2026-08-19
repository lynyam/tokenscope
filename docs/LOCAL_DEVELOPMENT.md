# Local Development

This document explains how to run TokenScope locally and how the development environment is structured.

## Requirements

Install:

* Docker
* Docker Compose
* Make
* Git

Node.js does not need to be installed on the host because frontend and backend run inside Docker containers.

---

## First setup

Clone the repository:

```bash
git clone git@github.com:lynyam/tokenscope.git
cd tokenscope
```

Create the local environment file:

```bash
cp .env.example .env
```

Start the application:

```bash
make up
```
```bash
make db-setup
```
The frontend is available at:

```text
http://localhost:5173
```

---

## Local architecture

The development environment contains three services:

```text
Browser
   |
   v
localhost:5173
   |
   v
Frontend
Vite + React
   |
   | /api/*
   v
Backend
NestJS
   |
   v
PostgreSQL
```

Docker Compose creates the internal network used by the services.

Inside this network:

```text
frontend → backend:3000
backend  → postgres:5432
```

The backend and PostgreSQL services are not directly published to the host.

The browser communicates with the backend through the Vite development proxy.

---

## Development containers

### Frontend

The frontend uses:

```text
node:24-alpine
```

The local `frontend/` directory is bind-mounted into:

```text
/app
```

Dependencies are stored in a dedicated Docker volume mounted at:

```text
/app/node_modules
```

At container startup:

```text
npm ci
npm run dev
```

Vite watches the source files and updates the development application when frontend code changes.

---

### Backend

The backend also uses:

```text
node:24-alpine
```

The local `backend/` directory is bind-mounted into:

```text
/app
```

Dependencies are stored in a dedicated Docker volume mounted at:

```text
/app/node_modules
```

At container startup:

```text
npm ci
npm run dev
```

The backend development command runs NestJS in watch mode.

When backend source code changes, Nest recompiles and restarts the application automatically.

---

### PostgreSQL

PostgreSQL uses:

```text
postgres:16-alpine
```

Database data is stored in a named Docker volume so that local data survives normal container restarts.

PostgreSQL also exposes a health check.

The backend waits for PostgreSQL to become healthy before starting.

---

## Environment variables

`.env.example` contains the environment variables required to run the project locally.

It is committed to Git and must not contain secrets.

Each developer creates their own local file:

```bash
cp .env.example .env
```

`.env` is ignored by Git.

Current variables include:

```text
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_DB
FRONTEND_PORT
BACKEND_PORT
```

Docker Compose automatically loads the root `.env` file when resolving variables used in `compose.yaml`.

---

## Common commands

### Start

```bash
make up
```

create containers and Starts the local stack in the background.

---

### Stop

```bash
make stop
```

Stops the containers without deleting them or their volumes.

---

### Logs

```bash
make logs
```

Follows logs from the Docker Compose services.

---

### Backend shell

```bash
make shell
```

Opens a shell inside the backend container.

---

### DB/Prisma

```bash
make db-setup
```

Generate prisma cient code source + migrate data model (sql) + seed

---

### PostgreSQL shell

```bash
make db-shell
```

Opens a PostgreSQL shell connected to the local TokenScope database.

---

### Clean

```bash
make clean
```

Removes the Compose containers and network.

Named volumes are preserved.

Local PostgreSQL data therefore remains available.

---

### Full clean

```bash
make fullclean
```

Removes containers, networks, and named volumes.

**Warning:** this deletes the local PostgreSQL database and the frontend/backend `node_modules` volumes.

Use it only when a complete local reset is required.

---

## Verify the environment

After:

```bash
make start
```

verify that the services are running:

```bash
docker compose ps
```

Then open:

```text
http://localhost:5173
```

Verify that:

1. The frontend loads.
2. The health-check action can call `/api/health/db`.
3. The backend responds successfully.
4. The backend can communicate with PostgreSQL.

For problems, inspect:

```bash
make logs
```

---

## Type checking and builds

### Frontend

From `frontend/`:

```bash
npm run check
npm run build
```

`check` runs TypeScript validation without producing JavaScript output.

`build` creates the frontend production assets with Vite.

---

### Backend

From `backend/`:

```bash
npm run check
npm run build
```

`check` validates TypeScript without generating output.

`build` compiles the backend TypeScript source into JavaScript.

---

## Development workflow

Once the local environment works, follow:

```text
docs/REPOSITORY_WORKFLOW.md
```

for branch naming, commits, Pull Requests, reviews, and merge rules.

For general project context and team onboarding, see:

```text
docs/ONBOARDING.md
```

For system architecture, see:

```text
docs/ARCHITECTURE.md
```

