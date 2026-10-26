import {
	Injectable,
	OnModuleDestroy,
  } from "@nestjs/common";
  import { performance } from "node:perf_hooks";

  @Injectable()
  export class RateLimitClock {
	now(): number {
	  // Elapsed-time quotas should not change when the system clock changes.
	  return performance.now();
	}
  }

  export type RateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

  export type RollingBudget = {
    namespace: string;
    identity: string;
    limit: number;
  };

  type Counter = {
	count: number;
	expiresAt: number;
  };

  const WINDOW_MS = 60_000;
  const MAX_COUNTERS = 10_000;

  @Injectable()
  export class RateLimitService implements OnModuleDestroy {
	private readonly counters = new Map<string, Counter>();
	private readonly rolling = new Map<string, number[]>();
	private readonly maintenance: ReturnType<typeof setInterval>;

	constructor(private readonly clock: RateLimitClock) {
	  this.maintenance = setInterval(
		() => this.removeExpired(this.clock.now()),
		30_000,
	  );
	  this.maintenance.unref();
	}

	consume(
	  namespace: string,
	  identity: string,
	  limit: number,
	): RateLimitDecision {
	  const now = this.clock.now();
	  const counterKey = `${namespace}:${identity}`;
	  let counter = this.counters.get(counterKey);

	  if (counter && counter.expiresAt <= now) {
		this.counters.delete(counterKey);
		counter = undefined;
	  }

	  if (!counter) {
		if (this.counters.size >= MAX_COUNTERS) {
		  this.removeExpired(now);
		}

		if (this.counters.size >= MAX_COUNTERS) {
		  // Never evict an active counter: eviction would reset its quota.
		  let earliestExpiry = Infinity;

		  for (const entry of this.counters.values()) {
			earliestExpiry = Math.min(
			  earliestExpiry,
			  entry.expiresAt,
			);
		  }

		  return this.denied(earliestExpiry - now);
		}

		counter = {
		  count: 0,
		  expiresAt: now + WINDOW_MS,
		};
		this.counters.set(counterKey, counter);
	  }

	  if (counter.count >= limit) {
		return this.denied(counter.expiresAt - now);
	  }

	  counter.count += 1;
	  return { allowed: true };
	}

	// The assistant requires a rolling minute. Keep consume() unchanged for
	// existing HTTP quotas and admit all assistant budgets atomically.
	consumeRolling(budgets: readonly RollingBudget[]): RateLimitDecision {
	  const now = this.clock.now();
	  const entries = budgets.map(budget => {
		const key = `${budget.namespace}:${budget.identity}`;
		const times = (this.rolling.get(key) ?? []).filter(time => time > now - WINDOW_MS);
		return { ...budget, key, times };
	  });
	  let retryMs = 0;
	  for (const entry of entries) {
		if (entry.times.length >= entry.limit) {
		  retryMs = Math.max(retryMs, entry.times[0] + WINDOW_MS - now);
		}
	  }
	  if (retryMs > 0) return this.denied(retryMs);

	  const missing = () => entries.filter(entry => !this.rolling.has(entry.key)).length;
	  if (this.rolling.size + missing() > MAX_COUNTERS) this.removeExpired(now);
	  if (this.rolling.size + missing() > MAX_COUNTERS) {
		let earliestExpiry = Infinity;
		for (const times of this.rolling.values()) {
		  earliestExpiry = Math.min(earliestExpiry, times[times.length - 1] + WINDOW_MS);
		}
		return this.denied(earliestExpiry - now);
	  }
	  for (const entry of entries) {
		entry.times.push(now);
		this.rolling.set(entry.key, entry.times);
	  }
	  return { allowed: true };
	}

	onModuleDestroy(): void {
	  clearInterval(this.maintenance);
	  this.counters.clear();
	  this.rolling.clear();
	}

	private denied(remainingMs: number): RateLimitDecision {
	  return {
		allowed: false,
		retryAfterSeconds: Math.max(
		  1,
		  Math.ceil(remainingMs / 1000),
		),
	  };
	}

	private removeExpired(now: number): void {
	  for (const [key, times] of this.rolling) {
		const current = times.filter(time => time > now - WINDOW_MS);
		if (current.length) this.rolling.set(key, current);
		else this.rolling.delete(key);
	  }
	  for (const [key, counter] of this.counters) {
		if (counter.expiresAt <= now) {
		  this.counters.delete(key);
		}
	  }
	}
  }
