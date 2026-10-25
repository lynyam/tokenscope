.DEFAULT_GOAL := help

COMPOSE := docker compose
BACKEND := backend
FRONTEND := frontend
DATABASE := postgres

# Non-secret seed options. DEMO_PASSWORD belongs in ignored .env or exported env.
export SEED CONFIRM_DATABASE ANCHOR


#APPS

# Rebuild the development targets when switching back from evaluation mode.
up:
	APP_MODE=dev $(COMPOSE) up -d --build

start:
	$(COMPOSE) start

restart:
	$(COMPOSE) restart

pause:
	$(COMPOSE) pause

stop:
	$(COMPOSE) stop

kill:
	$(COMPOSE) kill

logs:
	$(COMPOSE) logs -f

ps:
	$(COMPOSE) ps

psa:
	$(COMPOSE) ps -a

shell:
	$(COMPOSE) exec $(BACKEND) sh

#DB / PRISMA
db-shell:
	$(COMPOSE) exec $(DATABASE) \
		sh -c 'psql -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"'
db-generate:
	$(COMPOSE) exec $(BACKEND) npx prisma generate

db-migrate:
	$(COMPOSE) exec $(BACKEND) npx prisma migrate dev

db-migration:
	@test -n "$(name)" || \
		(echo "Usage: make db-migration name=<migration_name>" && exit 1)
	$(COMPOSE) exec $(BACKEND) \
		npx prisma migrate dev --name "$(name)"

db-seed:
	$(COMPOSE) exec $(BACKEND) npx prisma db seed

db-status:
	$(COMPOSE) exec $(BACKEND) npx prisma migrate status

db-studio:
	$(COMPOSE) exec $(BACKEND) \
		npx prisma studio --browser none

db-setup: db-generate db-migrate db-seed
#frontend
frontendcheck:
	$(COMPOSE) exec $(FRONTEND) npm run check

frontendtest:
	$(COMPOSE) exec $(FRONTEND) npm run test

# Real-browser suite. It runs on the host (Playwright's browsers do not run in the Alpine frontend
# container) against a stack that is already up: `make up` (http://localhost:5173, the default)
# or `make eval-up` (E2E_BASE_URL=https://localhost:8443).
frontende2e-setup:
	cd frontend && npm ci --no-audit --no-fund && npx playwright install chromium

frontende2e:
	cd frontend && E2E_BASE_URL=$${E2E_BASE_URL:-http://localhost:5173} npm run test:e2e -- $(E2E_ARGS)

backendcheck:
	$(COMPOSE) exec $(BACKEND) npm run check

#CLEANUP

clean:
	$(COMPOSE) down --remove-orphans

fullclean:
	$(COMPOSE) down -v --remove-orphans --rmi local

#TEST
TEST_COMPOSE := docker compose -p tokenscope-test -f compose.test.yaml

test-db:
	$(TEST_COMPOSE) up \
		--abort-on-container-exit \
		--exit-code-from backend-test

test-db-clean:
	$(TEST_COMPOSE) down -v --remove-orphans

test-db-fresh: test-db-clean test-db

test-backend:
	@set -eu; \
	trap '$(TEST_COMPOSE) down --remove-orphans' 0; \
	$(TEST_COMPOSE) run --rm -T backend-test sh -c '\
		npm ci && \
		npm run check && \
		npm run check:tests && \
		npm run build && \
		npx prisma migrate deploy && \
		npm run test:unit && \
		npm run test:e2e && \
		npm run test:integration'

#EVAL
eval-up:
	@sh scripts/eval-up.sh

eval-seed:
	@sh scripts/eval-seed.sh

test-eval-startup:
	@sh scripts/test-eval-startup.sh

#HELP

help:
	@echo ""
	@echo "TokenScope"
	@echo ""
	@echo "Application:"
	@echo "  make up                            Build and start development mode"
	@echo "  make start                         Start services"
	@echo "  make restart                       Restart services"
	@echo "  make pause                         Pause services"
	@echo "  make stop                          Stop services"
	@echo "  make kill                          Force stop service containers"

	@echo "  make logs                          Follow service logs"
	@echo "  make ps                            Show service status"
	@echo "  make eval-up                       Build and start HTTPS evaluation mode"
	@echo "  make eval-up SEED=1 CONFIRM_DATABASE=name  Start and explicitly seed the local demo"
	@echo "  make eval-seed CONFIRM_DATABASE=name      Seed the running dev/eval backend"
	@echo "  make test-eval-startup              Check startup/seed orchestration without Docker"
	@echo "  make psa                            Show all service status"
	@echo "  make shell                         Open backend shell"
	@echo ""
	@echo "Database:"
	@echo "  make db-shell                      Open PostgreSQL shell"
	@echo "  make db-generate                   Generate Prisma Client"
	@echo "  make db-migrate                    Apply pending dev migrations"
	@echo "  make db-migration name=<name>      Create a new migration"
	@echo "  make db-seed                       Seed development database"
	@echo "  make db-status                     Show migration status"
	@echo "  make db-studio                     Start Prisma Studio"
	@echo "  make db-setup                      Generate + migrate + seed"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean                         Remove project containers/network"
	@echo "  make fullclean                     Also remove volumes/local images"
	@echo "  make test-backend                  Check, build, unit, E2E and isolated database tests"
	@echo "  make frontendtest                  Run frontend Vitest suite"
	@echo "  make frontende2e-setup             Install host dependencies and Chromium for browser tests"
	@echo "  make frontende2e                   Run Playwright browser tests (E2E_BASE_URL, E2E_ARGS)"
	@echo ""

.PHONY: \
	up eval-up eval-seed test-eval-startup start stop restart logs ps shell \
	db-shell db-generate db-migrate db-migration db-seed db-status db-studio db-setup \
	clean fullclean help test-db test-db-clean test-db-fresh test-backend frontendtest \
	frontende2e frontende2e-setup
