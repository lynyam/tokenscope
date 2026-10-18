import { Inject, Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import type { Response } from "express";

import { AnalyticsService } from "../analytics/analytics.service";
import { ApiException } from "../common/errors/api.exception";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { PrismaService } from "../database/prisma.service";
import { MembershipRole, Prisma } from "../generated/prisma/client";
import { ProjectAccessService } from "../projects/project-access.service";
import { AnswerRun, type StopReason } from "./answer-run";
import {
	ASSISTANT_ERRORS,
	PROVIDER_FAILURE_ERRORS,
	toApiException,
	type AssistantError,
} from "./assistant-errors";
import { ASSISTANT_PROVIDER, type AssistantProvider } from "./assistant.provider";
import type { AskAssistantCommand, AssistantContext, ProviderEvent } from "./assistant.types";
import { openStream, sendDelta, sendEvent } from "./sse-writer";

// TokenScope limits (ticket §8.C). Tests may lower the times.
export const ASSISTANT_LIMITS = {
	userRequestsPerMinute: 5,
	projectRequestsPerMinute: 30,
	firstTextMs: 15_000,
	totalMs: 60_000,
	recheckEveryMs: 5_000,
	maxContextBytes: 32 * 1024,
};

const READ_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER];

// Stop reason -> error sent to the client. null = client left, send nothing.
const STOP_ERRORS: Record<StopReason, AssistantError | null> = {
	client_left: null,
	timeout: ASSISTANT_ERRORS.timeout,
	token_expired: ASSISTANT_ERRORS.tokenExpired,
	access_lost: ASSISTANT_ERRORS.projectNotFound,
	recheck_failed: ASSISTANT_ERRORS.internal,
	shutdown: ASSISTANT_ERRORS.shuttingDown,
};

type ProviderEvents = AsyncIterator<ProviderEvent>;

@Injectable()
export class AssistantService implements OnModuleDestroy {
	private readonly logger = new Logger(AssistantService.name);
	private readonly activeUsers = new Set<string>(); // one answer per user
	private readonly runs = new Set<AnswerRun>(); // answers in progress

	constructor(
		private readonly prisma: PrismaService,
		private readonly analytics: AnalyticsService,
		private readonly projects: ProjectAccessService,
		private readonly rateLimit: RateLimitService,
		@Inject(ASSISTANT_PROVIDER) private readonly provider: AssistantProvider,
	) { }

	// ══════════════════════════════════════════════════════════════
	// PART 1 — main flow
	// ══════════════════════════════════════════════════════════════

	// Answers one question. Errors before the stream are thrown (JSON);
	// errors after the stream started become one SSE "error" event.
	async ask(command: AskAssistantCommand, res: Response): Promise<void> {
		// 1. Access first: a rejected request never uses a rate-limit slot.
		await this.checkAccess(command);

		// 2. Is Gemini configured?
		if (!this.provider.isConfigured()) {
			throw toApiException(ASSISTANT_ERRORS.unavailable);
		}

		// 3. Limits: one answer at a time per user, then the per-minute limits.
		this.reserveSlot(command, res);

		const run = new AnswerRun();
		this.runs.add(run);
		const onClose = () => {
			if (!res.writableFinished) run.stop("client_left");
		};
		res.on("close", onClose);

		let outcome = "unknown";
		try {
			outcome = await this.answer(command, run, res);
		} catch (error) {
			outcome = error instanceof ApiException ? error.code : "INTERNAL_SERVER_ERROR";
			if (!res.headersSent) throw error; // the global filter writes the JSON error
			await sendEvent(res, "error", this.errorEvent(ASSISTANT_ERRORS.internal, command));
		} finally {
			// The ONLY cleanup path, for every exit.
			run.finish();
			this.runs.delete(run);
			this.activeUsers.delete(command.userId);
			res.off("close", onClose);
			if (res.headersSent && !res.writableEnded) res.end();
			this.logAnswer(command, run, outcome);
		}
	}

	// Builds the facts, re-checks access, then relays the provider answer.
	private async answer(command: AskAssistantCommand, run: AnswerRun, res: Response): Promise<string> {
		// 4. Fixed context, read in one short transaction (closed before Gemini).
		const context = await this.buildContext(command);

		// 5. Last checks before spending provider quota.
		if (run.stopReason) return this.fail(this.stopError(run), res, command);
		if (command.tokenExpiresAt <= Date.now()) throw toApiException(ASSISTANT_ERRORS.tokenExpired);
		await this.checkAccess(command);

		// 6. Start the clocks and ask the provider (one single request).
		this.startTimers(command, run);
		const events = this.provider.stream(command.question, context, run.signal)[Symbol.asyncIterator]();

		try {
			return await this.relay(command, context, run, res, events);
		} finally {
			// Close the provider generator; we ignore anything it sends later.
			events.return?.()?.catch(() => undefined);
		}
	}

	// Reads provider events and writes SSE events, always racing against "stop".
	private async relay(
		command: AskAssistantCommand,
		context: AssistantContext,
		run: AnswerRun,
		res: Response,
		events: ProviderEvents,
	): Promise<string> {
		// 7. The first event decides: a JSON error (the request failed), or a stream.
		const first = await run.waitOrStop(nextEvent(events));
		if (first === "stopped") return this.fail(this.stopError(run), res, command);
		if (first.done) return this.fail(ASSISTANT_ERRORS.providerError, res, command);
		if (first.value.type === "failure") return this.fail(PROVIDER_FAILURE_ERRORS[first.value.kind], res, command);

		// 8. The provider accepted the request: open the stream and send "start".
		openStream(res, command.requestId);
		await sendEvent(res, "start", {
			requestId: command.requestId,
			provider: this.provider.name,
			model: this.provider.model,
			context,
		});

		// 9. Relay the rest until done / failure / stop.
		let event: ProviderEvent = first.value;
		while (true) {
			if (event.type === "delta") {
				run.sawText = true;
				const sent = await run.waitOrStop(sendDelta(res, event.text));
				if (sent === "stopped") return this.fail(this.stopError(run), res, command);
			} else if (event.type === "done") {
				if (!run.sawText) return this.fail(ASSISTANT_ERRORS.providerError, res, command); // empty answer
				await sendEvent(res, "done", {
					requestId: command.requestId,
					finishReason: event.finishReason,
					usage: event.usage,
				});
				return "done";
			} else if (event.type === "failure") {
				return this.fail(PROVIDER_FAILURE_ERRORS[event.kind], res, command);
			}
			// ("open" needs nothing more: the stream is already open.)

			const next = await run.waitOrStop(nextEvent(events));
			if (next === "stopped") return this.fail(this.stopError(run), res, command);
			if (next.done) return this.fail(ASSISTANT_ERRORS.providerError, res, command); // ended without "done"
			event = next.value;
		}
	}

	// Stops every answer in progress when the app shuts down.
	onModuleDestroy(): void {
		for (const run of this.runs) {
			run.stop("shutdown");
		}
	}

	// ══════════════════════════════════════════════════════════════
	// PART 2 — checks and context
	// ══════════════════════════════════════════════════════════════

	// Throws 404 PROJECT_NOT_FOUND unless the user can still read the project.
	private async checkAccess(command: AskAssistantCommand): Promise<void> {
		await this.projects.assertProjectAccess(
			command.userId,
			command.organizationId,
			command.projectId,
			READ_ROLES,
		);
	}

	// Reserves the user's single slot after checking the per-minute limits.
	private reserveSlot(command: AskAssistantCommand, res: Response): void {
		if (this.activeUsers.has(command.userId)) {
			throw toApiException(ASSISTANT_ERRORS.alreadyRunning);
		}

		let decision = this.rateLimit.consume("assistant-user", command.userId, ASSISTANT_LIMITS.userRequestsPerMinute);
		if (decision.allowed) {
			decision = this.rateLimit.consume("assistant-project", command.projectId, ASSISTANT_LIMITS.projectRequestsPerMinute);
		}
		if (!decision.allowed) {
			res.setHeader("Retry-After", String(decision.retryAfterSeconds));
			throw toApiException(ASSISTANT_ERRORS.rateLimited);
		}

		this.activeUsers.add(command.userId);
	}

	// Reads project info + analytics in ONE Repeatable Read transaction.
	private async buildContext(command: AskAssistantCommand): Promise<AssistantContext> {
		const scope = {
			actorId: command.userId,
			organizationId: command.organizationId,
			projectId: command.projectId,
		};

		const result = await this.prisma.$transaction(
			tx => this.analytics.readSnapshotInTransaction(tx, scope, command.query),
			{
				isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
				maxWait: 5000,
				timeout: 10_000,
			},
		);

		const snapshot = result.snapshot;
		const context: AssistantContext = {
			snapshotId: snapshot.snapshotId,
			generatedAt: snapshot.generatedAt,
			window: snapshot.window,
			filters: snapshot.filters,
			summary: snapshot.summary,
			series: snapshot.series,
			byModel: snapshot.byModel,
			project: result.project,
			pricing: result.pricing,
		};

		if (context.summary.traceCount === 0) {
			throw toApiException(ASSISTANT_ERRORS.noData);
		}
		if (Buffer.byteLength(JSON.stringify(context), "utf8") > ASSISTANT_LIMITS.maxContextBytes) {
			throw toApiException(ASSISTANT_ERRORS.contextTooLarge);
		}
		return context;
	}

	// ══════════════════════════════════════════════════════════════
	// PART 3 — timers and helpers
	// ══════════════════════════════════════════════════════════════

	// Deadlines, JWT expiry and the periodic access re-check.
	private startTimers(command: AskAssistantCommand, run: AnswerRun): void {
		run.later(ASSISTANT_LIMITS.firstTextMs, () => {
			if (!run.sawText) run.stop("timeout");
		});
		run.later(ASSISTANT_LIMITS.totalMs, () => run.stop("timeout"));

		const msUntilExpiry = command.tokenExpiresAt - Date.now();
		if (msUntilExpiry < ASSISTANT_LIMITS.totalMs) {
			run.later(Math.max(0, msUntilExpiry), () => run.stop("token_expired"));
		}

		this.scheduleRecheck(command, run);
	}

	// Re-checks access every few seconds. The next check starts only after this one ends.
	private scheduleRecheck(command: AskAssistantCommand, run: AnswerRun): void {
		run.later(ASSISTANT_LIMITS.recheckEveryMs, () => {
			this.checkAccess(command).then(
				() => this.scheduleRecheck(command, run),
				error => {
					const lost = error instanceof ApiException && error.getStatus() === 404;
					run.stop(lost ? "access_lost" : "recheck_failed");
				},
			);
		});
	}

	// One place decides: JSON error before the stream, one "error" event after.
	private async fail(error: AssistantError | null, res: Response, command: AskAssistantCommand): Promise<string> {
		if (error === null) {
			return "client_left"; // nobody is listening
		}
		if (!res.headersSent) {
			throw toApiException(error);
		}
		await sendEvent(res, "error", this.errorEvent(error, command));
		return error.code;
	}

	private stopError(run: AnswerRun): AssistantError | null {
		return run.stopReason ? STOP_ERRORS[run.stopReason] : ASSISTANT_ERRORS.providerError;
	}

	private errorEvent(error: AssistantError, command: AskAssistantCommand) {
		return {
			requestId: command.requestId,
			code: error.code,
			message: error.message,
			retryable: error.retryable,
		};
	}

	// One log line per answer: ids, outcome and timing only. Never the content.
	private logAnswer(command: AskAssistantCommand, run: AnswerRun, outcome: string): void {
		this.logger.log(JSON.stringify({
			event: "assistant_answer",
			requestId: command.requestId,
			outcome,
			durationMs: Date.now() - run.startedAt,
		}));
	}
}

// Reads the next provider event. A crash in the provider becomes a safe provider error.
async function nextEvent(events: ProviderEvents): Promise<IteratorResult<ProviderEvent>> {
	try {
		return await events.next();
	} catch {
		return { done: false, value: { type: "failure", kind: "provider_error" } };
	}
}
