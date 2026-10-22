import {
	DocumentCleanupService,
	JOB_BATCH_SIZE,
	JOB_INTERVAL_MS,
	ORPHAN_MIN_AGE_MS,
	retryDelayMs,
} from "../../src/documents/document-cleanup.service";

type Job = { storageKey: string; attempts: number; nextAttemptAt: Date };

function setup() {
	const state = {
		now: 1_000_000,
		jobs: [] as Job[],
		referenced: new Set<string>(),
		files: new Set<string>(),
	};

	const prisma = {
		projectDocument: {
			findUnique: jest.fn(async ({ where }: { where: { storageKey: string } }) =>
				state.referenced.has(where.storageKey) ? { id: "doc" } : null),
		},
		fileDeletionJob: {
			findMany: jest.fn(async ({ where }: { where: { nextAttemptAt: { lte: Date } } }) =>
				state.jobs.filter((j) => j.nextAttemptAt <= where.nextAttemptAt.lte)),
			findUnique: jest.fn(async ({ where }: { where: { storageKey: string } }) =>
				state.jobs.find((j) => j.storageKey === where.storageKey) ?? null),
			deleteMany: jest.fn(async ({ where }: { where: { storageKey: string } }) => {
				state.jobs = state.jobs.filter((j) => j.storageKey !== where.storageKey);
			}),
			update: jest.fn(async ({ where, data }: {
				where: { storageKey: string };
				data: { attempts: { increment: number }; nextAttemptAt: Date; lastErrorCode: string };
			}) => {
				const job = state.jobs.find((j) => j.storageKey === where.storageKey)!;
				job.attempts += data.attempts.increment;
				job.nextAttemptAt = data.nextAttemptAt;
				(job as Job & { lastErrorCode?: string }).lastErrorCode = data.lastErrorCode;
			}),
		},
	};

	const storage = {
		closeScans: jest.fn(async () => undefined),
		delete: jest.fn(async (key: string) => { state.files.delete(key); }),
		runExclusive: jest.fn(async <T>(operation: () => Promise<T>) => operation()),
		removeStaleTemporaryFiles: jest.fn(async () => 0),
		listKeysOlderThan: jest.fn(async (_cutoff: number) => [...state.files]),
	};

	const clock = { now: () => state.now };
	const service = new DocumentCleanupService(prisma as never, storage as never, clock as never);
	return { state, prisma, storage, service };
}

const job = (storageKey: string, attempts = 0, at = 0): Job => ({
	storageKey,
	attempts,
	nextAttemptAt: new Date(at),
});

describe("retry schedule", () => {
	it("retries after 10, 30 and 60 seconds, then every five minutes", () => {
		expect([0, 1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([
			10_000, 30_000, 60_000, 300_000, 300_000, 300_000,
		]);
	});
});

describe("DocumentCleanupService jobs", () => {
	it("deletes the bytes and then the job", async () => {
		const { state, storage, service } = setup();
		state.files.add("aa/key");
		state.jobs.push(job("aa/key"));

		await service.runOnce();

		expect(storage.delete).toHaveBeenCalledWith("aa/key");
		expect(state.jobs).toHaveLength(0);
	});

	it("treats a file that is already gone as success", async () => {
		const { state, service } = setup();
		state.jobs.push(job("aa/missing"));

		await service.runOnce();

		expect(state.jobs).toHaveLength(0);
	});

	it("keeps a failed job and follows the retry schedule", async () => {
		const { state, storage, service } = setup();
		state.jobs.push(job("aa/key"));
		storage.delete.mockRejectedValue(Object.assign(new Error("EIO /private/path/aa/key"), { code: "EIO" }));

		const delays: number[] = [];
		for (let i = 0; i < 5; i += 1) {
			await service.runOnce();
			delays.push(state.jobs[0].nextAttemptAt.getTime() - state.now);
			state.now = state.jobs[0].nextAttemptAt.getTime(); // wait until due
		}

		expect(delays).toEqual([10_000, 30_000, 60_000, 300_000, 300_000]);
		expect(state.jobs[0].attempts).toBe(5);
		expect((state.jobs[0] as Job & { lastErrorCode?: string }).lastErrorCode).toBe("EIO");
	});

	it("never stores a raw error message", async () => {
		const { state, storage, service } = setup();
		state.jobs.push(job("aa/key"));
		storage.delete.mockRejectedValue(new Error("/var/lib/secret/path failed"));

		await service.runOnce();

		const stored = (state.jobs[0] as Job & { lastErrorCode?: string }).lastErrorCode;
		expect(stored).toBe("STORAGE_ERROR");
	});

	it("does not retry before the job is due", async () => {
		const { state, storage, service } = setup();
		state.jobs.push(job("aa/key", 0, state.now + 5_000));

		await service.runOnce();

		expect(storage.delete).not.toHaveBeenCalled();
	});

	it("processes a bounded batch", async () => {
		const { prisma, service } = setup();

		await service.runOnce();

		expect(prisma.fileDeletionJob.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: JOB_BATCH_SIZE }),
		);
		expect(JOB_BATCH_SIZE).toBe(25);
	});

	it("never deletes bytes that a document row still references", async () => {
		const { state, storage, service } = setup();
		state.referenced.add("aa/key");
		state.jobs.push(job("aa/key"));

		await service.runOnce();

		expect(storage.delete).not.toHaveBeenCalled();
		expect(state.jobs).toHaveLength(1);
		expect(state.jobs[0].nextAttemptAt.getTime()).toBeGreaterThan(state.now);
	});

	it("does not start a second run while one is in progress", async () => {
		const { prisma, service } = setup();
		let release!: () => void;
		prisma.fileDeletionJob.findMany.mockImplementationOnce(
			() => new Promise((resolve) => { release = () => resolve([]); }),
		);

		const first = service.runOnce();
		const second = service.runOnce();
		expect(second).toBe(first);
		release();
		await first;

		await service.runOnce();
		expect(prisma.fileDeletionJob.findMany).toHaveBeenCalledTimes(2);
	});

	it("waits for a run in flight when the application shuts down", async () => {
		const { prisma, service } = setup();
		let release!: () => void;
		prisma.fileDeletionJob.findMany.mockImplementationOnce(
			() => new Promise((resolve) => { release = () => resolve([]); }),
		);
		void service.runOnce();

		let stopped = false;
		const shutdown = service.onModuleDestroy().then(() => { stopped = true; });
		await new Promise((resolve) => setImmediate(resolve));
		expect(stopped).toBe(false);

		release();
		await shutdown;
		expect(stopped).toBe(true);
	});

	it("survives a database error without throwing", async () => {
		const { prisma, service } = setup();
		prisma.fileDeletionJob.findMany.mockRejectedValueOnce(new Error("db down"));

		await expect(service.runOnce()).resolves.toBeUndefined();
	});
});

describe("DocumentCleanupService timers", () => {
	const original = process.env.NODE_ENV;
	afterEach(() => {
		process.env.NODE_ENV = original;
		jest.useRealTimers();
	});

	it("polls every 10 seconds and stops on shutdown", async () => {
		process.env.NODE_ENV = "production";
		jest.useFakeTimers();
		const { prisma, service } = setup();

		service.onApplicationBootstrap();
		await jest.advanceTimersByTimeAsync(0);
		const afterStart = prisma.fileDeletionJob.findMany.mock.calls.length;
		expect(afterStart).toBe(1);

		await jest.advanceTimersByTimeAsync(JOB_INTERVAL_MS * 3);
		expect(prisma.fileDeletionJob.findMany.mock.calls.length).toBe(afterStart + 3);

		await service.onModuleDestroy();
		await jest.advanceTimersByTimeAsync(JOB_INTERVAL_MS * 3);
		expect(prisma.fileDeletionJob.findMany.mock.calls.length).toBe(afterStart + 3);
	});

	it("starts no timers under test", async () => {
		process.env.NODE_ENV = "test";
		jest.useFakeTimers();
		const { prisma, service } = setup();

		service.onApplicationBootstrap();
		await jest.advanceTimersByTimeAsync(JOB_INTERVAL_MS * 2);

		expect(prisma.fileDeletionJob.findMany).not.toHaveBeenCalled();
	});
});

describe("DocumentCleanupService orphan sweep", () => {
	it("considers only files older than one hour", async () => {
		const { state, storage, service } = setup();

		await service.sweepOrphans();

		expect(storage.listKeysOlderThan).toHaveBeenCalledWith(state.now - ORPHAN_MIN_AGE_MS);
		expect(ORPHAN_MIN_AGE_MS).toBe(3_600_000);
	});

	it("removes unreferenced files and keeps referenced or pending ones", async () => {
		const { state, storage, service } = setup();
		state.files = new Set(["aa/orphan", "bb/kept", "cc/pending"]);
		state.referenced.add("bb/kept"); // e.g. a document under an archived parent
		state.jobs.push(job("cc/pending", 0, state.now + 60_000));

		expect(await service.sweepOrphans()).toBe(1);
		expect(storage.delete).toHaveBeenCalledTimes(1);
		expect(storage.delete).toHaveBeenCalledWith("aa/orphan");
	});

	it("checks and deletes inside the finalization critical section", async () => {
		const { state, storage, service } = setup();
		state.files = new Set(["aa/orphan"]);

		await service.sweepOrphans();

		expect(storage.runExclusive).toHaveBeenCalledTimes(1);
	});

	it("deletes nothing when the database cannot be consulted", async () => {
		const { state, prisma, storage, service } = setup();
		state.files = new Set(["aa/orphan"]);
		prisma.projectDocument.findUnique.mockRejectedValue(new Error("db down"));

		expect(await service.sweepOrphans()).toBe(0);
		expect(storage.delete).not.toHaveBeenCalled();
	});
});
