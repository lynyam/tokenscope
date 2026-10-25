import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { DocumentStorageService } from "./document-storage.service";

@Injectable()
export class DocumentClock {
	now(): number {
		return Date.now();
	}
}

export const JOB_INTERVAL_MS = 10_000;
export const SWEEP_INTERVAL_MS = 60_000;
export const JOB_BATCH_SIZE = 25;
// A file younger than this may belong to an upload that has not committed yet.
export const ORPHAN_MIN_AGE_MS = 60 * 60_000;
// Delay before the next attempt, indexed by the attempts already made.
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000];
const LONG_RETRY_DELAY_MS = 5 * 60_000;

export function retryDelayMs(attemptsAlreadyMade: number): number {
	return RETRY_DELAYS_MS[attemptsAlreadyMade] ?? LONG_RETRY_DELAY_MS;
}

@Injectable()
export class DocumentCleanupService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(DocumentCleanupService.name);
	private timers: ReturnType<typeof setInterval>[] = [];
	private stopping = false;
	private jobRun: Promise<void> | null = null;
	private sweepRun: Promise<number> | null = null;

	constructor(
		private readonly prisma: PrismaService,
		private readonly storage: DocumentStorageService,
		private readonly clock: DocumentClock,
	) {}

	onApplicationBootstrap(): void {
		// Tests drive runOnce() and sweepOrphans() themselves.
		if (process.env.NODE_ENV === "test") return;

		this.timers = [
			setInterval(() => void this.runOnce(), JOB_INTERVAL_MS),
			setInterval(() => void this.sweepOrphans(), SWEEP_INTERVAL_MS),
		];
		for (const timer of this.timers) timer.unref();

		// Recover pending work after a restart.
		void this.runOnce();
		void this.sweepOrphans();
	}

	async onModuleDestroy(): Promise<void> {
		this.stopping = true;
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
		// Let a run that is already in flight finish before shutdown continues.
		await Promise.allSettled([this.jobRun, this.sweepRun]);
		await this.storage.closeScans();
	}

	/**
	 * Deletes the bytes, then the job. A referenced key is never deleted. On
	 * failure the job is rescheduled and the error is rethrown.
	 */
	async processKey(storageKey: string): Promise<void> {
		const referenced = await this.prisma.projectDocument.findUnique({
			where: { storageKey },
			select: { id: true },
		});
		if (referenced) {
			this.logger.warn(
				JSON.stringify({ event: "document_cleanup_skipped_referenced" }),
			);
			await this.recordFailure(storageKey, { code: "STILL_REFERENCED" });
			return;
		}

		try {
			await this.storage.delete(storageKey);
		} catch (error) {
			await this.recordFailure(storageKey, error);
			throw error;
		}
		await this.prisma.fileDeletionJob.deleteMany({ where: { storageKey } });
	}

	/** Retries due deletion jobs. Overlapping calls share the run in progress. */
	runOnce(): Promise<void> {
		if (this.stopping) return Promise.resolve();
		this.jobRun ??= this.processDueJobs().finally(() => {
			this.jobRun = null;
		});
		return this.jobRun;
	}

	/**
	 * Deletes stored files that no row references. "Referenced" means ANY
	 * ProjectDocument row, including rows under archived projects and
	 * organizations, or a pending deletion job. If the database cannot be
	 * consulted nothing is deleted.
	 */
	sweepOrphans(): Promise<number> {
		if (this.stopping) return Promise.resolve(0);
		this.sweepRun ??= this.sweep().finally(() => {
			this.sweepRun = null;
		});
		return this.sweepRun;
	}

	private async processDueJobs(): Promise<void> {
		try {
			const jobs = await this.prisma.fileDeletionJob.findMany({
				where: { nextAttemptAt: { lte: new Date(this.clock.now()) } },
				orderBy: { nextAttemptAt: "asc" },
				take: JOB_BATCH_SIZE,
				select: { storageKey: true },
			});
			for (const job of jobs) {
				await this.processKey(job.storageKey).catch(() => undefined);
			}
		} catch (error) {
			this.logger.error(
				JSON.stringify({ event: "document_cleanup_failed", code: "CLEANUP_FAILED" }),
			);
		}
	}

	private async sweep(): Promise<number> {
		const cutoff = this.clock.now() - ORPHAN_MIN_AGE_MS;
		let removed = 0;

		try {
			await this.storage.removeStaleTemporaryFiles(cutoff);

			for (const storageKey of await this.storage.listKeysOlderThan(cutoff)) {
				// Check and delete inside the critical section shared with upload
				// finalization, so a file cannot vanish between its move and its commit.
				const deleted = await this.storage.runExclusive(async () => {
					const [document, job] = await Promise.all([
						this.prisma.projectDocument.findUnique({
							where: { storageKey },
							select: { id: true },
						}),
						this.prisma.fileDeletionJob.findUnique({
							where: { storageKey },
							select: { id: true },
						}),
					]);
					if (document || job) return false;

					await this.storage.delete(storageKey);
					return true;
				});
				if (deleted) removed += 1;
			}
		} catch (error) {
			this.logger.error(
				JSON.stringify({ event: "document_sweep_failed", code: "SWEEP_FAILED" }),
			);
		}
		return removed;
	}

	private async recordFailure(
		storageKey: string,
		error: unknown,
	): Promise<void> {
		const job = await this.prisma.fileDeletionJob.findUnique({
			where: { storageKey },
			select: { attempts: true },
		});
		if (!job) return;

		const code = (error as NodeJS.ErrnoException).code;
		await this.prisma.fileDeletionJob.update({
			where: { storageKey },
			data: {
				attempts: { increment: 1 },
				nextAttemptAt: new Date(this.clock.now() + retryDelayMs(job.attempts)),
				// A short code only: raw errors can contain private paths.
				lastErrorCode:
					typeof code === "string" && /^[A-Z_]{1,32}$/.test(code)
						? code
						: "STORAGE_ERROR",
			},
		});
	}
}
