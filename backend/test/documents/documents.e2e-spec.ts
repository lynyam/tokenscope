import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import {
	DocumentCleanupService,
	DocumentClock,
} from "../../src/documents/document-cleanup.service";
import {
	DOCUMENT_STORAGE_ROOT,
	DocumentStorageService,
} from "../../src/documents/document-storage.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";

type Row = {
	id: string;
	projectId: string;
	uploadedByUserId: string;
	originalName: string;
	storageKey: string;
	mediaType: string;
	sizeBytes: number;
	sha256: string;
	createdAt: Date;
};
type Job = {
	id: string;
	storageKey: string;
	attempts: number;
	nextAttemptAt: Date;
	lastErrorCode: string | null;
};

const fixture = (name: string) =>
	readFileSync(join(__dirname, "../fixtures/documents", name));

describe("Private documents HTTP contract", () => {
	let app: INestApplication;
	let root: string;
	let bearer: string;
	let storage: DocumentStorageService;
	let cleanup: DocumentCleanupService;
	let now = 0;
	let clockOffset = 0; // moves the cleanup worker's clock forward
	let clock = 0;

	const organizationId = randomUUID();
	const projectId = randomUUID();
	const base = `/api/v1/organizations/${organizationId}/projects/${projectId}/documents`;

	let rows: Row[];
	let jobs: Job[];
	const access = { assertProjectAccess: jest.fn() };

	const self: { db?: unknown } = {};
	const db = {
		projectDocument: {
			create: jest.fn(async ({ data }: { data: Omit<Row, "id" | "createdAt"> }) => {
				const row = { ...data, id: randomUUID(), createdAt: new Date(1_700_000_000_000 + clock++ * 1000) };
				rows.push(row);
				return row;
			}),
			count: jest.fn(async ({ where }: { where: { projectId: string } }) =>
				rows.filter((r) => r.projectId === where.projectId).length),
			findMany: jest.fn(async ({ where, skip, take }: { where: { projectId: string }; skip: number; take: number }) =>
				rows
					.filter((r) => r.projectId === where.projectId)
					.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id))
					.slice(skip, skip + take)),
			findFirst: jest.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
				rows.find((r) => r.id === where.id && r.projectId === where.projectId) ?? null),
			findUnique: jest.fn(async ({ where }: { where: { storageKey: string } }) =>
				rows.find((r) => r.storageKey === where.storageKey) ?? null),
			delete: jest.fn(async ({ where }: { where: { id: string } }) => {
				rows = rows.filter((r) => r.id !== where.id);
			}),
		},
		fileDeletionJob: {
			create: jest.fn(async ({ data }: { data: { storageKey: string; nextAttemptAt: Date } }) => {
				jobs.push({ id: randomUUID(), attempts: 0, lastErrorCode: null, ...data });
			}),
			deleteMany: jest.fn(async ({ where }: { where: { storageKey: string } }) => {
				jobs = jobs.filter((j) => j.storageKey !== where.storageKey);
			}),
			findMany: jest.fn(async ({ where }: { where: { nextAttemptAt: { lte: Date } } }) =>
				jobs.filter((j) => j.nextAttemptAt <= where.nextAttemptAt.lte)),
			findUnique: jest.fn(async ({ where }: { where: { storageKey: string } }) =>
				jobs.find((j) => j.storageKey === where.storageKey) ?? null),
			update: jest.fn(async ({ where, data }: { where: { storageKey: string }; data: { attempts: { increment: number }; nextAttemptAt: Date; lastErrorCode: string } }) => {
				const job = jobs.find((j) => j.storageKey === where.storageKey)!;
				job.attempts += data.attempts.increment;
				job.nextAttemptAt = data.nextAttemptAt;
				job.lastErrorCode = data.lastErrorCode;
			}),
		},
		$transaction: jest.fn(async (operation: (tx: unknown) => unknown): Promise<unknown> => operation(self.db)),
	};

	self.db = db;

	const files = async () =>
		(await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile());

	const upload = (name: string, content: Buffer | string, type?: string) =>
		request(app.getHttpServer())
			.post(base)
			.set("Authorization", bearer)
			.attach("file", Buffer.from(content), { filename: name, ...(type ? { contentType: type } : {}) });

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "tokenscope-docs-e2e-"));

		const context = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PrismaService).useValue(db)
			.overrideProvider(ProjectAccessService).useValue(access)
			.overrideProvider(DOCUMENT_STORAGE_ROOT).useValue(root)
			.overrideProvider(DocumentClock).useValue({ now: () => Date.now() + clockOffset })
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
			.compile();

		app = context.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();

		storage = app.get(DocumentStorageService);
		cleanup = app.get(DocumentCleanupService);
		bearer = "Bearer " + app.get(TokenService).signAccessToken(randomUUID()).accessToken;
	});

	beforeEach(async () => {
		clockOffset = 0;
		now += 60_001; // fresh rate-limit window
		rows = [];
		jobs = [];
		clock = 0;
		access.assertProjectAccess.mockReset().mockResolvedValue({});
		jest.clearAllMocks();
		access.assertProjectAccess.mockResolvedValue({});
		for (const entry of await readdir(root)) {
			await rm(join(root, entry), { recursive: true, force: true });
		}
	});

	afterAll(async () => {
		await app?.close();
		await rm(root, { recursive: true, force: true });
	});

	describe("upload", () => {
		it("stores a text file and returns only the public summary", async () => {
			const response = await upload("notes.txt", "hello").expect(201).expect("Cache-Control", "no-store");

			expect(Object.keys(response.body).sort()).toEqual(
				["createdAt", "id", "mediaType", "originalName", "projectId", "sizeBytes"],
			);
			expect(response.body).toMatchObject({
				projectId,
				originalName: "notes.txt",
				mediaType: "text/plain",
				sizeBytes: 5,
			});
			expect(await files()).toHaveLength(1);
			expect(rows[0].sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(JSON.stringify(response.body)).not.toContain(rows[0].storageKey);
		});

		it("keeps accents and non-Latin names intact", async () => {
			const response = await upload("é日本.MD", "# hi").expect(201);
			expect(response.body.originalName).toBe("é日本.MD");
			expect(response.body.mediaType).toBe("text/markdown");
		});

		it("accepts a valid PDF", async () => {
			const response = await upload("a.pdf", fixture("valid.pdf")).expect(201);
			expect(response.body.mediaType).toBe("application/pdf");
		});

		it("accepts exactly 10 MiB and rejects one more byte with 413", async () => {
			await upload("max.txt", Buffer.alloc(10_485_760, 97)).expect(201);
			const response = await upload("big.txt", Buffer.alloc(10_485_761, 97)).expect(413);
			expect(response.body.code).toBe("PAYLOAD_TOO_LARGE");
			expect(await files()).toHaveLength(1);
		});

		it.each([
			["unsupported extension", "a.docx", "hello", 415, "UNSUPPORTED_MEDIA_TYPE"],
			["invalid UTF-8", "a.txt", Buffer.from([0xff, 0xfe]), 422, "INVALID_DOCUMENT_CONTENT"],
			["empty file", "a.txt", "", 400, "VALIDATION_ERROR"],
			["encrypted PDF", "a.pdf", fixture("enc_user.pdf"), 422, "INVALID_DOCUMENT_CONTENT"],
			["fake PDF", "a.pdf", "not a pdf", 422, "INVALID_DOCUMENT_CONTENT"],
		])("rejects %s without storing anything", async (_l, name, content, status, code) => {
			const response = await upload(name, content).expect(status);
			expect(response.body.code).toBe(code);
			expect(await files()).toHaveLength(0);
			expect(db.projectDocument.create).not.toHaveBeenCalled();
		});

		it.each(["../x.txt", "a/b.txt", "a\\b.txt"])("rejects the raw file name %j", async (name) => {
			const body =
				`--b\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
				`Content-Type: text/plain\r\n\r\nx\r\n--b--\r\n`;
			const response = await request(app.getHttpServer())
				.post(base)
				.set("Authorization", bearer)
				.set("Content-Type", "multipart/form-data; boundary=b")
				.send(Buffer.from(body))
				.expect(400);
			expect(response.body.code).toBe("VALIDATION_ERROR");
			expect(await files()).toHaveLength(0);
		});

		it("rejects bad multipart shapes with 400", async () => {
			const url = request(app.getHttpServer()).post(base).set("Authorization", bearer);
			const post = () => request(app.getHttpServer()).post(base).set("Authorization", bearer);
			void url;

			await post().send({ a: 1 }).expect(400);
			await post().expect(400);
			await post().attach("other", Buffer.from("x"), "a.txt").expect(400);
			await post().field("note", "x").attach("file", Buffer.from("x"), "a.txt").expect(400);
			await post().attach("file", Buffer.from("x"), "a.txt").attach("file", Buffer.from("y"), "b.txt").expect(400);
			expect(await files()).toHaveLength(0);
		});

		it("checks access before reading the body and does not consume quota on denial", async () => {
			access.assertProjectAccess.mockRejectedValue(
				new ApiException(403, "INSUFFICIENT_ORGANIZATION_ROLE", "Forbidden."),
			);
			for (let i = 0; i < 7; i += 1) {
				const r = await upload("a.txt", "x").expect(403);
				expect(r.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
			}
			access.assertProjectAccess.mockResolvedValue({});
			await upload("a.txt", "x").expect(201);
			expect(await files()).toHaveLength(1);
		});

		it("limits authorized uploads to 5 per minute with Retry-After", async () => {
			for (let i = 0; i < 5; i += 1) await upload("a.txt", "x").expect(201);
			const response = await upload("a.txt", "x").expect(429);
			expect(response.body.code).toBe("RATE_LIMITED");
			expect(Number(response.headers["retry-after"])).toBeGreaterThanOrEqual(1);
			expect(await files()).toHaveLength(5);
		});

		it("deletes the bytes when access is lost during the final transaction", async () => {
			access.assertProjectAccess
				.mockResolvedValueOnce({})
				.mockRejectedValueOnce(new ApiException(404, "PROJECT_NOT_FOUND", "Project not found."));

			const response = await upload("a.txt", "x").expect(404);
			expect(response.body.code).toBe("PROJECT_NOT_FOUND");
			expect(await files()).toHaveLength(0);
			expect(rows).toHaveLength(0);
		});

		it("keeps the bytes when the commit outcome is unknown", async () => {
			db.$transaction.mockRejectedValueOnce(new Error("connection lost"));
			await upload("a.txt", "x").expect(500);
			// The sweep decides later, using the database as the source of truth.
			expect(await files()).toHaveLength(1);
		});

		it("answers 503 STORAGE_UNAVAILABLE when the disk write fails", async () => {
			jest.spyOn(storage, "adopt").mockRejectedValueOnce(new Error("disk full"));
			const response = await upload("a.txt", "x").expect(503);
			expect(response.body.code).toBe("STORAGE_UNAVAILABLE");
			expect(rows).toHaveLength(0);
		});
	});

	describe("list", () => {
		const seed = async (count: number) => {
			for (let i = 0; i < count; i += 1) {
				await storage.write(storage.newKey(), Buffer.from("x"));
				await db.projectDocument.create({
					data: {
						projectId, uploadedByUserId: randomUUID(), originalName: `d${i}.txt`,
						storageKey: storage.newKey(), mediaType: "text/plain", sizeBytes: 1, sha256: "0".repeat(64),
					},
				});
			}
		};
		const list = (query = "") =>
			request(app.getHttpServer()).get(`${base}${query}`).set("Authorization", bearer);

		it("returns an empty page with totalPages 0", async () => {
			const response = await list().expect(200).expect("Cache-Control", "no-store");
			expect(response.body).toEqual({ items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 });
		});

		it("orders newest first and paginates", async () => {
			await seed(5);
			const first = await list("?page=1&pageSize=2").expect(200);
			expect(first.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["d4.txt", "d3.txt"]);
			expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

			const last = await list("?page=3&pageSize=2").expect(200);
			expect(last.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["d0.txt"]);
		});

		it("returns empty items with real totals beyond the last page", async () => {
			await seed(3);
			const response = await list("?page=9&pageSize=2").expect(200);
			expect(response.body).toMatchObject({ items: [], page: 9, total: 3, totalPages: 2 });
		});

		it.each(["?page=0", "?page=-1", "?page=1.5", "?page=abc", "?page=1&page=2", "?pageSize=101", "?pageSize=0", "?sort=name"])(
			"rejects %s with 400",
			async (query) => {
				const response = await list(query).expect(400);
				expect(response.body.code).toBe("VALIDATION_ERROR");
			},
		);

		it("lets a plain member read", async () => {
			await list().expect(200);
			expect(access.assertProjectAccess).toHaveBeenCalledWith(
				expect.any(String), organizationId, projectId,
				expect.arrayContaining(["OWNER", "ADMIN", "MEMBER"]), expect.anything(),
			);
		});
	});

	describe("content", () => {
		const content = "hello world";
		let id: string;

		beforeEach(async () => {
			id = (await upload("Rapport é.txt", content).expect(201)).body.id;
			now += 60_001;
		});

		const get = (query = "", documentId = id) =>
			request(app.getHttpServer()).get(`${base}/${documentId}/content${query}`).set("Authorization", bearer);

		it("streams the bytes with safe headers, inline by default", async () => {
			const response = await get().expect(200);
			expect(response.text).toBe(content);
			expect(response.headers["content-type"]).toMatch(/^text\/plain/);
			expect(response.headers["content-length"]).toBe(String(content.length));
			expect(response.headers["cache-control"]).toBe("no-store");
			expect(response.headers["x-content-type-options"]).toBe("nosniff");
			expect(response.headers["content-disposition"]).toMatch(/^inline;/);
		});

		it("uses attachment with download=true and encodes the name safely", async () => {
			const response = await get("?download=true").expect(200);
			const disposition = response.headers["content-disposition"];
			expect(disposition).toMatch(/^attachment;/);
			expect(disposition).toContain("filename*=UTF-8''Rapport%20%C3%A9.txt");
			expect(disposition).not.toMatch(/[\r\n]/);
		});

		it.each(["?download=yes", "?download=1", "?download=true&download=false"])("rejects %s", async (query) => {
			await get(query).expect(400);
		});

		it("answers 404 DOCUMENT_NOT_FOUND for an unknown or foreign document", async () => {
			const response = await get("", randomUUID()).expect(404);
			expect(response.body.code).toBe("DOCUMENT_NOT_FOUND");
			rows[0].projectId = randomUUID();
			await get().expect(404);
		});

		it("answers 503 when the bytes are missing", async () => {
			await storage.delete(rows[0].storageKey);
			const response = await get().expect(503);
			expect(response.body.code).toBe("STORAGE_UNAVAILABLE");
		});
	});

	describe("delete", () => {
		const remove = (id: string) =>
			request(app.getHttpServer()).delete(`${base}/${id}`).set("Authorization", bearer);

		it("returns 204, removes metadata and bytes, and repeats as 404", async () => {
			const id = (await upload("a.txt", "x").expect(201)).body.id;

			await remove(id).expect(204).expect("Cache-Control", "no-store");
			expect(rows).toHaveLength(0);
			expect(jobs).toHaveLength(0);
			expect(await files()).toHaveLength(0);

			const again = await remove(id).expect(404);
			expect(again.body.code).toBe("DOCUMENT_NOT_FOUND");
		});

		it("requires OWNER or ADMIN", async () => {
			const id = (await upload("a.txt", "x").expect(201)).body.id;
			await remove(id);
			expect(access.assertProjectAccess).toHaveBeenLastCalledWith(
				expect.any(String), organizationId, projectId, ["OWNER", "ADMIN"], expect.anything(),
			);
		});

		it("still answers 204 when byte deletion fails, and the worker finishes the job", async () => {
			const id = (await upload("a.txt", "x").expect(201)).body.id;
			jest.spyOn(storage, "delete").mockRejectedValueOnce(Object.assign(new Error("io"), { code: "EIO" }));

			await remove(id).expect(204);
			expect(rows).toHaveLength(0);
			expect(jobs).toHaveLength(1);
			expect(jobs[0]).toMatchObject({ attempts: 1, lastErrorCode: "EIO" });
			expect(await files()).toHaveLength(1);

			clockOffset = 3_600_000;
			await cleanup.runOnce();
			expect(jobs).toHaveLength(0);
			expect(await files()).toHaveLength(0);
		});
	});

	describe("orphan sweep", () => {
		it("removes unreferenced old files and keeps referenced or pending ones", async () => {
			const a = await upload("a.txt", "x").expect(201); // referenced
			const orphan = storage.newKey();
			await storage.write(orphan, Buffer.from("o"));
			const pending = storage.newKey();
			await storage.write(pending, Buffer.from("p"));
			jobs.push({ id: randomUUID(), storageKey: pending, attempts: 0, nextAttemptAt: new Date(), lastErrorCode: null });

			// Too young: nothing is removed.
			clockOffset = 0;
			expect(await cleanup.sweepOrphans()).toBe(0);

			expect((clockOffset = 2 * 3_600_000, await cleanup.sweepOrphans())).toBe(1);
			const left = (await files()).length;
			expect(left).toBe(2);
			expect(a.body.id).toBeDefined();
		});
	});
});
