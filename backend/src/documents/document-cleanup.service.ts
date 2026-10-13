import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { DocumentStorageService } from "./document-storage.service";

const JOB_INTERVAL_MS = 30_000;
const SWEEP_INTERVAL_MS = 60 * 60_000;
// A file younger than this may belong to an upload that has not committed yet.
const ORPHAN_MIN_AGE_MS = 60 * 60_000;
const JOB_BATCH = 50;
const MAX_BACKOFF_MS = 60 * 60_000;

@Injectable()
export class DocumentCleanupService
	implements OnApplicationBootstrap, OnModuleDestroy
{
	private readonly logger = new Logger(DocumentCleanupService.name);
	private timers: ReturnType<typeof setInterval>[] = [];
	private running = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly storage: DocumentStorageService,
	) {}

	onApplicationBootstrap(): void {
		// Tests call runOnce()/sweepOrphans() themselves.
		if (process.env.NODE_ENV === "test") return;

		this.timers = [
			setInterval(() => void this.runOnce(), JOB_INTERVAL_MS),
			setInterval(() => void this.sweepOrphans(), SWEEP_INTERVAL_MS),
		];
		for (const timer of this.timers) timer.unref();
		void this.runOnce();
		void this.sweepOrphans();
	}

	onModuleDestroy(): void {
		for (const timer of this.timers) clearInterval(timer);
		this.timers = [];
	}

	/** Deletes the bytes, then the job. On failure the job is rescheduled. */
	async processKey(storageKey: string): Promise<void> {
		try {
			await this.storage.delete(storageKey);
		} catch (error) {
			await this.recordFailure(storageKey, error);
			throw error;
		}
		await this.prisma.fileDeletionJob.deleteMany({ where: { storageKey } });
	}

	/** Retries every due deletion job. Safe to call concurrently (skips if busy). */
	async runOnce(now = new Date()): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			const jobs = await this.prisma.fileDeletionJob.findMany({
				where: { nextAttemptAt: { lte: now } },
				orderBy: { nextAttemptAt: "asc" },
				take: JOB_BATCH,
				select: { storageKey: true },
			});
			for (const job of jobs) {
				await this.processKey(job.storageKey).catch(() => undefined);
			}
		} catch (error) {
			this.logger.error(
				JSON.stringify({ event: "document_cleanup_failed", error: String(error) }),
			);
		} finally {
			this.running = false;
		}
	}

	/**
	 * Deletes stored files that no row references. "Referenced" means ANY
	 * ProjectDocument row, including those of archived projects and
	 * organizations, whose bytes must be kept, or a pending deletion job.
	 */
	async sweepOrphans(now = Date.now()): Promise<number> {
		let removed = 0;
		try {
			const keys = await this.storage.listKeysOlderThan(now - ORPHAN_MIN_AGE_MS);
			for (const storageKey of keys) {
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
				if (document || job) continue;

				await this.storage.delete(storageKey);
				removed += 1;
			}
		} catch (error) {
			this.logger.error(
				JSON.stringify({ event: "document_sweep_failed", error: String(error) }),
			);
		}
		return removed;
	}

	private async recordFailure(storageKey: string, error: unknown): Promise<void> {
		const job = await this.prisma.fileDeletionJob.findUnique({
			where: { storageKey },
			select: { attempts: true },
		});
		if (!job) return;

		const delay = Math.min(30_000 * 2 ** job.attempts, MAX_BACKOFF_MS);
		const code = (error as NodeJS.ErrnoException).code;
		await this.prisma.fileDeletionJob.update({
			where: { storageKey },
			data: {
				attempts: { increment: 1 },
				nextAttemptAt: new Date(Date.now() + delay),
				lastErrorCode: typeof code === "string" ? code.slice(0, 64) : "STORAGE_ERROR",
			},
		});
	}
}
