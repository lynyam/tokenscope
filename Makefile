start:
	docker compose up -d

stop:
	docker compose stop

logs:
	docker compose logs -f

shell:
	docker compose exec backend sh

db-shell:
	docker compose exec postgres \
		psql -U $${POSTGRES_USER} -d $${POSTGRES_DB}

clean:
	docker compose down --remove-orphans

fullclean:
	docker compose down -v --remove-orphans

iclean:
	docker image rm $$(docker image ls -q)

ficlean:
	docker image rm -f $$(docker image ls -q)
cclean:
	docker rm $$(docker ps -aq)

fcclean:
	docker rm -f $$(docker ps -aq)

vclean:
	docker volume rm $$(docker volume ls -q)

fvclean:
	docker volume rm -f $$(docker volume ls -q)

o opt option options:
	@echo "\
- iclean: clean image\\n\
- ficlean: forced clean image\\n\
- cclean: clean container\\n\
- fcclean: forced clean container\\n\
- vclean: clean named volume\\n\
- fvclean: forced clean named volume\\n\
- fullclean: clean images container named volume"

.PHONY: start stop logs shell db-shell clean options o opt option iclean ficlean cclean fcclean vclean fvclean fullclean
