// One scheduler decides WHEN the dashboard refetches its analytics.
// Framework-free on purpose: it can be tested with fake timers.
//
// Rules:
// - Notifications are coalesced (about 250 ms), but a continuous stream of events
//   cannot postpone the refresh forever (maxWaitMs).
// - At most one request runs at a time.
// - A trigger that arrives during a request marks the selection "dirty"; when the
//   request ends, at most ONE follow-up runs.
// - A 429 sets a cooldown that every later trigger respects.
// - After a failure nothing is retried automatically (no spinning): the next
//   trigger (periodic tick, focus, Refresh/Retry button) tries again.
// - One scheduler belongs to one selection. Dispose it when the selection,
//   the project or the page changes.

export type RefreshKind = "coalesced" | "immediate";

export type RefreshSchedulerOptions = {
  run: (signal: AbortSignal) => Promise<void>;
  coalesceMs?: number;
  maxWaitMs?: number;
  // Cooldown in ms after a failed run, or undefined for "no cooldown".
  getCooldownMs?: (error: unknown) => number | undefined;
};

const MAX_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_429_COOLDOWN_MS = 5000;

function defaultCooldownMs(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { retryAfterSeconds, statusCode } = error as {
    retryAfterSeconds?: unknown;
    statusCode?: unknown;
  };
  if (typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)) {
    return Math.min(Math.max(retryAfterSeconds, 1) * 1000, MAX_COOLDOWN_MS);
  }
  return statusCode === 429 ? DEFAULT_429_COOLDOWN_MS : undefined;
}

export class RefreshScheduler {
  private readonly runRequest: (signal: AbortSignal) => Promise<void>;
  private readonly coalesceMs: number;
  private readonly maxWaitMs: number;
  private readonly getCooldownMs: (error: unknown) => number | undefined;

  private controller: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private dirty = false;
  private disposed = false;
  private immediatePending = false;
  private firstPendingAt: number | null = null;
  private cooldownUntil = 0;

  constructor(options: RefreshSchedulerOptions) {
    this.runRequest = options.run;
    this.coalesceMs = options.coalesceMs ?? 250;
    this.maxWaitMs = options.maxWaitMs ?? 1000;
    this.getCooldownMs = options.getCooldownMs ?? defaultCooldownMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  // Something may have changed: refresh soon.
  // "coalesced" for notifications, "immediate" for initial load / Refresh button.
  request(kind: RefreshKind = "coalesced"): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.running) return; // the follow-up is decided when the request ends
    this.schedule(kind);
  }

  dispose(): void {
    this.disposed = true;
    this.dirty = false;
    this.clearTimer();
    this.controller?.abort();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(kind: RefreshKind): void {
    const now = Date.now();

    // An immediate refresh already waiting must not be pushed back by events.
    if (this.timer !== null && this.immediatePending) return;

    if (kind === "immediate") this.immediatePending = true;
    if (this.firstPendingAt === null) this.firstPendingAt = now;

    const wanted =
      kind === "immediate"
        ? now
        : Math.min(now + this.coalesceMs, this.firstPendingAt + this.maxWaitMs);
    const target = Math.max(wanted, this.cooldownUntil);

    this.clearTimer();
    this.timer = setTimeout(() => this.fire(), Math.max(0, target - now));
  }

  private fire(): void {
    this.timer = null;
    this.firstPendingAt = null;
    this.immediatePending = false;
    if (this.disposed || this.running || !this.dirty) return;
    void this.start();
  }

  private async start(): Promise<void> {
    this.dirty = false;
    this.running = true;
    const controller = new AbortController();
    this.controller = controller;
    let failed = false;

    try {
      await this.runRequest(controller.signal);
    } catch (error) {
      if (this.disposed || controller.signal.aborted) return;
      failed = true;
      const cooldown = this.getCooldownMs(error);
      if (cooldown !== undefined) this.cooldownUntil = Date.now() + cooldown;
    } finally {
      this.running = false;
      this.controller = null;
    }

    if (this.disposed) return;
    if (failed) {
      this.dirty = false; // no automatic retry after a failure
      return;
    }
    if (this.dirty) this.schedule("immediate"); // the one queued follow-up
  }
}
