.DEFAULT_GOAL := help

COMPOSE := docker compose
BACKEND := backend
DATABASE := postgres


#APPS

up:
	$(COMPOSE) up -d

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
		npx prisma studio --browser none --hostname 0.0.0.0

db-setup: db-generate db-migrate db-seed

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
#HELP

help:
	@echo ""
	@echo "TokenScope"
	@echo ""
	@echo "Application:"
	@echo "  make up                            create and Start services"
	@echo "  make start                         Start services"
	@echo "  make restart                       Restart services"
	@echo "  make pause                         Pause services"
	@echo "  make stop                          Stop services"
	@echo "  make kill                          Force stop service containers"

	@echo "  make logs                          Follow service logs"
	@echo "  make ps                            Show service status"
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
	@echo ""

.PHONY: \
	start stop restart logs ps shell \
	db-shell db-generate db-migrate db-migration db-seed db-status db-studio db-setup \
	clean fullclean help test-db test-db-clean test-db-fresh
