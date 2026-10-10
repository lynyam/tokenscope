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

  type Counter = {
	count: number;
	expiresAt: number;
  };

  const WINDOW_MS = 60_000;
  const MAX_COUNTERS = 10_000;

  @Injectable()
  export class RateLimitService implements OnModuleDestroy {
	private readonly counters = new Map<string, Counter>();
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

	onModuleDestroy(): void {
	  clearInterval(this.maintenance);
	  this.counters.clear();
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
	  for (const [key, counter] of this.counters) {
		if (counter.expiresAt <= now) {
		  this.counters.delete(key);
		}
	  }
	}
  }
