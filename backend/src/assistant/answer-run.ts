// Why an answer was stopped early.
export type StopReason =
	| "client_left"
	| "timeout"
	| "token_expired"
	| "access_lost"
	| "recheck_failed"
	| "shutdown";

// Holds the "stop button" and the timers of ONE answer.
export class AnswerRun {
	readonly startedAt = Date.now();
	stopReason: StopReason | null = null;
	sawText = false;

	private readonly controller = new AbortController();
	private readonly timers: NodeJS.Timeout[] = [];
	private finished = false;

	// Signal given to the provider. Aborts when the answer stops.
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	// Stops the answer. Only the first reason is kept.
	stop(reason: StopReason): void {
		if (this.stopReason !== null || this.finished) return;
		this.stopReason = reason;
		this.controller.abort();
	}

	// Runs `action` after `ms` milliseconds, unless the run is finished.
	later(ms: number, action: () => void): void {
		if (this.finished) return;
		this.timers.push(setTimeout(action, ms));
	}

	// Waits for `promise`, or returns "stopped" as soon as the answer stops.
	waitOrStop<T>(promise: Promise<T>): Promise<T | "stopped"> {
		// Avoid "unhandled rejection" if the promise fails after we stopped waiting.
		promise.catch(() => undefined);

		if (this.signal.aborted) {
			return Promise.resolve("stopped");
		}

		return new Promise((resolve, reject) => {
			const onStop = () => resolve("stopped");
			this.signal.addEventListener("abort", onStop, { once: true });

			promise.then(
				value => {
					this.signal.removeEventListener("abort", onStop);
					resolve(value);
				},
				error => {
					this.signal.removeEventListener("abort", onStop);
					reject(error);
				},
			);
		});
	}

	// Cleanup for EVERY exit: clear timers and abort the provider request.
	finish(): void {
		if (this.finished) return;
		this.finished = true;
		for (const timer of this.timers) {
			clearTimeout(timer);
		}
		this.controller.abort(); // safe even after a normal end
	}

	get isFinished(): boolean {
		return this.finished;
	}
}
