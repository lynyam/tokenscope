EVAL_COMPOSE := docker compose -p tokenscope-eval -f compose.eval.yaml

eval-up:
	@test -f .env || cp .env.example .env
	@grep -q '^JWT_SECRET=.' .env || \
		(echo "JWT_SECRET missing in .env — generate one first (see .env.example)" && exit 1)
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