EVAL_COMPOSE := docker compose -p tokenscope-eval -f compose.eval.yaml

eval-up:
	@chmod +x scripts/prepare-env.sh
	@./scripts/prepare-env.sh
	$(EVAL_COMPOSE) up --build -d --wait --wait-timeout 180
	@chmod +x scripts/eval-readiness.sh
	@./scripts/eval-readiness.sh

eval-down:
	$(EVAL_COMPOSE) down

eval-restart:
	$(EVAL_COMPOSE) restart

eval-logs:
	$(EVAL_COMPOSE) logs -f

eval-clean:
	$(EVAL_COMPOSE) down -v --remove-orphans

.PHONY: eval-up eval-down eval-restart eval-logs eval-clean