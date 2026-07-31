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

fullclean: ficlean fcclean fvclean

o opt option options:
	@echo "\
- iclean: clean image\\n\
- ficlean: forced clean image\\n\
- cclean: clean container\\n\
- fcclean: forced clean container\\n\
- vclean: clean named volume\\n\
- fvclean: forced clean named volume\\n\
- fullclean: clean images container named volume"

.PHONY: options o opt option iclean ficlean cclean fcclean vclean fvclean fullclean
