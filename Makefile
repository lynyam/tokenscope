.DEFAULT_GOAL := help

COMPOSE := docker compose
BACKEND := backend
FRONTEND := frontend
DATABASE := postgres


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


# EXTERNAL DEMO — local HTTP development setup
# EXTERNAL DEMO — local HTTP development setup
DEMO_DIR := $(CURDIR)/examples/external-demo
DEMO_IMAGE := docker.io/library/node:24-alpine
DEMO_RUNTIME ?= docker
DEMO_USER_FLAGS ?= --user "$$(id -u):$$(id -g)"
DEMO_VOLUME_SUFFIX ?=
DEMO_CA_FILE ?=
DEMO_BACKEND_CONTAINER ?= tokenscope_backend_1
DEMO_BACKEND_DIR ?= /app

demo-install:
	$(DEMO_RUNTIME) run --rm \
		$(DEMO_USER_FLAGS) \
		-e npm_config_cache=/tmp/npm-cache \
		-v "$(DEMO_DIR):/app:rw$(DEMO_VOLUME_SUFFIX)" \
		-w /app \
		$(DEMO_IMAGE) npm ci

demo-up:
	@test -f "$(DEMO_DIR)/.env" || \
		(echo "Configure examples/external-demo/.env first." && exit 1)
	@set -eu; \
	set --; \
	if [ -n "$(DEMO_CA_FILE)" ]; then \
		test -s "$(DEMO_CA_FILE)" || \
			{ echo "Certificate file not found: $(DEMO_CA_FILE)"; exit 1; }; \
		set -- \
			-e NODE_EXTRA_CA_CERTS=/certs/caddy-root.crt \
			-v "$(abspath $(DEMO_CA_FILE)):/certs/caddy-root.crt:ro$(DEMO_VOLUME_SUFFIX)"; \
	fi; \
	$(DEMO_RUNTIME) run --rm --init --network host \
		$(DEMO_USER_FLAGS) \
		"$$@" \
		-v "$(DEMO_DIR):/app:ro$(DEMO_VOLUME_SUFFIX)" \
		-w /app \
		$(DEMO_IMAGE) npm start

demo-up-42:
	$(MAKE) demo-up DEMO_RUNTIME=podman \
		DEMO_USER_FLAGS=--userns=keep-id DEMO_VOLUME_SUFFIX=,Z

demo-install-42:
	$(MAKE) demo-install DEMO_RUNTIME=podman \
		DEMO_USER_FLAGS=--userns=keep-id DEMO_VOLUME_SUFFIX=,z

demo-pricing-42:
	podman cp "$(DEMO_DIR)/config/model-prices.json" \
		"$(DEMO_BACKEND_CONTAINER):/tmp/external-demo-prices.json"
	podman exec -w "$(DEMO_BACKEND_DIR)" "$(DEMO_BACKEND_CONTAINER)" \
		npm run pricing:load -- --file /tmp/external-demo-prices.json

demo-setup-42:
	bash scripts/demo-config.sh
	$(MAKE) demo-install-42
	$(MAKE) demo-pricing-42

demo-setup-eval-42:
	$(MAKE) demo-setup-42 DEMO_BACKEND_DIR=/opt/tokenscope/backend

demo-up-eval-42:
	$(MAKE) demo-up-42 DEMO_CA_FILE="$(CURDIR)/.local/eval/caddy-root.crt"


.PHONY: demo-install demo-install-42 demo-up demo-up-42 demo-pricing-42 demo-setup-42 demo-setup-eval-42 demo-up-eval-42
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
	@echo ""

.PHONY: \
	up eval-up start stop restart logs ps shell \
	db-shell db-generate db-migrate db-migration db-seed db-status db-studio db-setup \
	clean fullclean help test-db test-db-clean test-db-fresh test-backend frontendtest
