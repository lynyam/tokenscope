import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
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
import { ApiException } from "../../src/common/errors/api.exception";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { resetTestDatabase } from "../support/reset-test-database";

describe("Private documents with PostgreSQL", () => {
	let app: INestApplication;
	let db: PrismaService;
	let tokens: TokenService;
	let storage: DocumentStorageService;
	let cleanup: DocumentCleanupService;
	let root: string;
	let now = 0;
	let clockOffset = 0; // moves the cleanup worker's clock forward

	const ids = {
		owner: randomUUID(),
		admin: randomUUID(),
		member: randomUUID(),
		outsider: randomUUID(),
		orgA: randomUUID(),
		orgB: randomUUID(),
		projectA: randomUUID(),
		projectA2: randomUUID(),
		projectB: randomUUID(),
	};
	const base = (project = ids.projectA, org = ids.orgA) =>
		`/api/v1/organizations/${org}/projects/${project}/documents`;
	const bearer = (userId = ids.owner) =>
		"Bearer " + tokens.signAccessToken(userId).accessToken;

	const upload = (name: string, content: string | Buffer, userId = ids.owner, project = ids.projectA, org = ids.orgA) =>
		request(app.getHttpServer())
			.post(base(project, org))
			.set("Authorization", bearer(userId))
			.attach("file", Buffer.from(content), name);
	const get = (path: string, userId = ids.owner) =>
		request(app.getHttpServer()).get(path).set("Authorization", bearer(userId));
	const remove = (path: string, userId = ids.owner) =>
		request(app.getHttpServer()).delete(path).set("Authorization", bearer(userId));

	const fileCount = async () =>
		(await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).length;

	async function bootApp(): Promise<INestApplication> {
		const context = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(DOCUMENT_STORAGE_ROOT).useValue(root)
			.overrideProvider(DocumentClock).useValue({ now: () => Date.now() + clockOffset })
			.overrideProvider(RateLimitClock).useValue({ now: () => now })
			.compile();

		const instance = context.createNestApplication({ logger: false });
		configureApp(instance);
		await instance.init();
		return instance;
	}

	function bindApp(instance: INestApplication) {
		app = instance;
		db = app.get(PrismaService);
		tokens = app.get(TokenService);
		storage = app.get(DocumentStorageService);
		cleanup = app.get(DocumentCleanupService);
	}

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "tokenscope-docs-int-"));
		bindApp(await bootApp());
	});

	beforeEach(async () => {
		clockOffset = 0;
		now += 60_001;
		await resetTestDatabase(db);
		for (const entry of await readdir(root)) {
			await rm(join(root, entry), { recursive: true, force: true });
		}

		await db.user.createMany({
			data: (["owner", "admin", "member", "outsider"] as const).map((name) => ({
				id: ids[name],
				email: `${name}@documents.test`,
				displayName: name,
				passwordHash: "fixture-only",
			})),
		});
		await db.organization.createMany({
			data: [
				{ id: ids.orgA, name: "A", slug: "documents-a" },
				{ id: ids.orgB, name: "B", slug: "documents-b" },
			],
		});
		await db.membership.createMany({
			data: [
				{ userId: ids.owner, organizationId: ids.orgA, role: "OWNER" },
				{ userId: ids.admin, organizationId: ids.orgA, role: "ADMIN" },
				{ userId: ids.member, organizationId: ids.orgA, role: "MEMBER" },
				{ userId: ids.outsider, organizationId: ids.orgB, role: "OWNER" },
			],
		});
		await db.project.createMany({
			data: [
				{ id: ids.projectA, organizationId: ids.orgA, name: "A", slug: "doc-a" },
				{ id: ids.projectA2, organizationId: ids.orgA, name: "A2", slug: "doc-a2" },
				{ id: ids.projectB, organizationId: ids.orgB, name: "B", slug: "doc-b" },
			],
		});
	});

	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		await app?.close();
		await rm(root, { recursive: true, force: true });
	});

	describe("roles and tenancy", () => {
		it.each(["owner", "admin"] as const)("lets %s upload and delete", async (actor) => {
			const created = await upload("a.txt", "hello", ids[actor]).expect(201);
			const row = await db.projectDocument.findUniqueOrThrow({ where: { id: created.body.id } });
			expect(row).toMatchObject({ projectId: ids.projectA, uploadedByUserId: ids[actor], sizeBytes: 5, mediaType: "text/plain" });
			expect(row.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");

			await remove(`${base()}/${created.body.id}`, ids[actor]).expect(204);
		});

		it("lets a member read but not upload or delete", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			const path = `${base()}/${created.body.id}`;

			await upload("b.txt", "x", ids.member).expect(403);
			await remove(path, ids.member).expect(403);
			await get(base(), ids.member).expect(200);
			const content = await get(`${path}/content`, ids.member).expect(200);
			expect(content.text).toBe("hello");
			expect(await db.projectDocument.count()).toBe(1);
		});

		it("hides other tenants and mismatched projects behind 404", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			const id = created.body.id;

			await upload("x.txt", "x", ids.outsider).expect(404);
			await get(base(), ids.outsider).expect(404);
			await get(`${base()}/${id}/content`, ids.outsider).expect(404);
			await remove(`${base()}/${id}`, ids.outsider).expect(404);

			// Right organization, wrong project: the document id must not leak.
			const wrong = await get(`${base(ids.projectA2)}/${id}/content`).expect(404);
			expect(wrong.body.code).toBe("DOCUMENT_NOT_FOUND");
			await remove(`${base(ids.projectA2)}/${id}`).expect(404);
			expect(await db.projectDocument.count()).toBe(1);
		});

		it("does not read the body when the caller has no access", async () => {
			await upload("x.txt", "x", ids.outsider).expect(404);
			await upload("x.txt", "x", ids.member).expect(403);
			expect(await fileCount()).toBe(0);
		});
	});

	describe("listing", () => {
		it("orders by createdAt desc then id asc, and paginates consistently", async () => {
			const sameInstant = new Date("2026-10-01T00:00:00.000Z");
			const rows = Array.from({ length: 4 }, (_v, i) => ({
				id: `00000000-0000-4000-8000-00000000000${i}`,
				projectId: ids.projectA,
				uploadedByUserId: ids.owner,
				originalName: `d${i}.txt`,
				storageKey: `${i}${i}/${randomUUID()}`,
				mediaType: "text/plain",
				sizeBytes: 1,
				sha256: "0".repeat(64),
				createdAt: i < 2 ? sameInstant : new Date("2026-10-02T00:00:00.000Z"),
			}));
			await db.projectDocument.createMany({ data: rows });

			const first = await get(`${base()}?page=1&pageSize=3`).expect(200);
			expect(first.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["d2.txt", "d3.txt", "d0.txt"]);
			expect(first.body).toMatchObject({ total: 4, totalPages: 2 });

			const second = await get(`${base()}?page=2&pageSize=3`).expect(200);
			expect(second.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["d1.txt"]);
			expect(Object.keys(first.body.items[0]).sort()).toEqual(
				["createdAt", "id", "mediaType", "originalName", "projectId", "sizeBytes"],
			);
		});

		it("only lists the requested project", async () => {
			await upload("a.txt", "a").expect(201);
			now += 60_001;
			await upload("b.txt", "b", ids.owner, ids.projectA2).expect(201);

			const list = await get(base()).expect(200);
			expect(list.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["a.txt"]);
		});
	});

	describe("deletion lifecycle", () => {
		it("removes row, job and bytes, and a repeat is 404", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			const path = `${base()}/${created.body.id}`;
			expect(await fileCount()).toBe(1);

			await remove(path).expect(204);
			expect(await db.projectDocument.count()).toBe(0);
			expect(await db.fileDeletionJob.count()).toBe(0);
			expect(await fileCount()).toBe(0);

			const again = await remove(path).expect(404);
			expect(again.body.code).toBe("DOCUMENT_NOT_FOUND");
		});

		it("keeps a retryable job when byte deletion fails, then finishes it", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			jest.spyOn(storage, "delete").mockRejectedValueOnce(Object.assign(new Error("io"), { code: "EIO" }));

			await remove(`${base()}/${created.body.id}`).expect(204);
			expect(await db.projectDocument.count()).toBe(0);
			const [job] = await db.fileDeletionJob.findMany();
			expect(job).toMatchObject({ attempts: 1, lastErrorCode: "EIO" });
			expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
			expect(await fileCount()).toBe(1);

			// Not due yet: nothing happens.
			clockOffset = 0;
			await cleanup.runOnce();
			expect(await db.fileDeletionJob.count()).toBe(1);

			clockOffset = 3_600_000;
			await cleanup.runOnce();
			expect(await db.fileDeletionJob.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});

		it("lets exactly one of two concurrent deletes succeed", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			const path = `${base()}/${created.body.id}`;

			const statuses = (await Promise.all([remove(path), remove(path)]))
				.map((r) => r.status)
				.sort();
			expect(statuses).toEqual([204, 404]);
			expect(await db.fileDeletionJob.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});
	});

	describe("archived parents", () => {
		it("denies access but keeps rows and bytes, and the sweep never removes them", async () => {
			const created = await upload("a.txt", "hello").expect(201);
			const path = `${base()}/${created.body.id}`;
			await db.project.update({ where: { id: ids.projectA }, data: { archivedAt: new Date() } });

			await get(base()).expect(404);
			await get(`${path}/content`).expect(404);
			await remove(path).expect(404);
			await upload("b.txt", "x").expect(404);

			expect(await db.projectDocument.count()).toBe(1);
			expect(await fileCount()).toBe(1);
			expect((clockOffset = 10 * 3_600_000, await cleanup.sweepOrphans())).toBe(0);
			expect(await fileCount()).toBe(1);

			// Archived organization, project not archived.
			await db.project.update({ where: { id: ids.projectA }, data: { archivedAt: null } });
			await db.organization.update({ where: { id: ids.orgA }, data: { archivedAt: new Date() } });
			await get(`${path}/content`).expect(404);
			expect((clockOffset = 10 * 3_600_000, await cleanup.sweepOrphans())).toBe(0);
		});
	});

	describe("orphan sweep", () => {
		it("removes only unreferenced files older than the grace period", async () => {
			await upload("kept.txt", "hello").expect(201);

			const orphan = storage.newKey();
			await storage.write(orphan, Buffer.from("o"));
			const pending = storage.newKey();
			await storage.write(pending, Buffer.from("p"));
			await db.fileDeletionJob.create({ data: { storageKey: pending, nextAttemptAt: new Date(Date.now() + 3_600_000) } });

			const old = new Date(Date.now() - 2 * 3_600_000);
			await utimes(join(root, orphan), old, old);

			// The just-written upload is young and the orphan is old.
			expect(await cleanup.sweepOrphans()).toBe(1);
			expect(await fileCount()).toBe(2);
		});
	});

	describe("database constraints match the API rules", () => {
		const row = (overrides: Record<string, unknown> = {}) => ({
			projectId: ids.projectA,
			uploadedByUserId: ids.owner,
			originalName: "ok.txt",
			storageKey: `ab/${randomUUID()}`,
			mediaType: "text/plain",
			sizeBytes: 1,
			sha256: "a".repeat(64),
			...overrides,
		});

		it("accepts the documented boundaries", async () => {
			await db.projectDocument.create({ data: row({ sizeBytes: 10_485_760 }) });
			await db.projectDocument.create({ data: row({ originalName: "é".repeat(127) + "a" }) }); // 255 bytes
		});

		it.each([
			["size 0", { sizeBytes: 0 }],
			["size over 10 MiB", { sizeBytes: 10_485_761 }],
			["unsupported media type", { mediaType: "application/zip" }],
			["empty name", { originalName: "" }],
			["name over 255 bytes", { originalName: "é".repeat(128) }],
			["bad checksum", { sha256: "xyz" }],
		])("rejects %s", async (_label, overrides) => {
			await expect(db.projectDocument.create({ data: row(overrides) })).rejects.toThrow();
		});
	});

	describe("access changes while a file is being uploaded", () => {
		const duringFinalTransaction = (change: () => Promise<unknown>) => {
			const access = app.get(ProjectAccessService);
			const original = access.assertProjectAccess.bind(access);
			let changed = false;

			jest.spyOn(access, "assertProjectAccess").mockImplementation(
				async (...args: Parameters<typeof original>) => {
					// The first call is the early check; the one with a transaction
					// client is the final re-check inside the metadata transaction.
					if (args.length === 5 && !changed) {
						changed = true;
						await change();
					}
					return original(...args);
				},
			);
		};

		it("creates no document when membership is lost during the upload", async () => {
			duringFinalTransaction(() => db.membership.deleteMany({ where: { userId: ids.admin } }));

			const response = await upload("a.txt", "hello", ids.admin).expect(404);

			expect(response.body.code).toBe("PROJECT_NOT_FOUND");
			expect(await db.projectDocument.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});

		it("creates no document when the project is archived during the upload", async () => {
			duringFinalTransaction(() =>
				db.project.update({ where: { id: ids.projectA }, data: { archivedAt: new Date() } }));

			const response = await upload("a.txt", "hello").expect(404);

			expect(response.body.code).toBe("PROJECT_NOT_FOUND");
			expect(await db.projectDocument.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});

		it("creates no document when the organization is archived during the upload", async () => {
			duringFinalTransaction(() =>
				db.organization.update({ where: { id: ids.orgA }, data: { archivedAt: new Date() } }));

			await upload("a.txt", "hello").expect(404);

			expect(await db.projectDocument.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});

		it("cleans its file when the metadata transaction fails", async () => {
			const access = app.get(ProjectAccessService);
			const original = access.assertProjectAccess.bind(access);
			jest.spyOn(access, "assertProjectAccess").mockImplementation(
				async (...args: Parameters<typeof original>) => {
					if (args.length === 5) throw new Error("simulated database failure");
					return original(...args);
				},
			);

			await upload("a.txt", "hello").expect(500);

			expect(await db.projectDocument.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});
	});

	describe("interruptions", () => {
		it("keeps a committed document when the response is lost", async () => {
			const realTransaction = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
			jest.spyOn(db, "$transaction").mockImplementationOnce(
				(async (...args: unknown[]) => {
					await realTransaction(...args); // the commit happens...
					throw new Error("connection lost after commit"); // ...but the caller never learns
				}) as never,
			);

			await upload("kept.txt", "hello").expect(500);

			expect(await db.projectDocument.count()).toBe(1);
			expect(await fileCount()).toBe(1);

			// The sweep must not remove it either.
			clockOffset = 10 * 3_600_000;
			expect(await cleanup.sweepOrphans()).toBe(0);
			const listed = await get(base()).expect(200);
			expect(listed.body.items.map((i: { originalName: string }) => i.originalName)).toEqual(["kept.txt"]);
		});

		it("leaves no document or file behind when the client disconnects mid-upload", async () => {
			await app.listen(0);
			const { port } = app.getHttpServer().address() as { port: number };
			const boundary = "----cut";
			const head =
				`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cut.txt"\r\n` +
				"Content-Type: text/plain\r\n\r\n" + "x".repeat(2000);

			await new Promise<void>((resolve, reject) => {
				const socket = connect(port, "127.0.0.1", () => {
					socket.write(
						`POST ${base()} HTTP/1.1\r\nHost: localhost\r\nAuthorization: ${bearer()}\r\n` +
						`Content-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 100000\r\n\r\n${head}`,
						() => setTimeout(() => { socket.destroy(); resolve(); }, 100),
					);
				});
				socket.on("error", reject);
			});

			// Wait (bounded) for the server to notice the broken connection.
			for (let attempt = 0; attempt < 50 && (await fileCount()) > 0; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			expect(await fileCount()).toBe(0);
			expect(await db.projectDocument.count()).toBe(0);
		});
	});

	describe("restart", () => {
		it("keeps metadata and readable bytes across a backend restart", async () => {
			const created = await upload("persist.txt", "still here").expect(201);

			await app.close();
			bindApp(await bootApp());

			const listed = await get(base()).expect(200);
			expect(listed.body.total).toBe(1);
			const content = await get(`${base()}/${created.body.id}/content`).expect(200);
			expect(content.text).toBe("still here");
		});

		it("finishes a failed physical deletion after a restart", async () => {
			const created = await upload("gone.txt", "bye").expect(201);
			jest.spyOn(storage, "delete").mockRejectedValueOnce(Object.assign(new Error("io"), { code: "EIO" }));
			await remove(`${base()}/${created.body.id}`).expect(204);
			expect(await db.fileDeletionJob.count()).toBe(1);
			expect(await fileCount()).toBe(1);

			await app.close();
			bindApp(await bootApp());

			clockOffset = 3_600_000;
			await cleanup.runOnce();
			expect(await db.fileDeletionJob.count()).toBe(0);
			expect(await fileCount()).toBe(0);
		});
	});

	describe("orphan sweep safety", () => {
		it("cannot delete a file between its final move and its metadata commit", async () => {
			const key = storage.newKey();
			await storage.write(key, Buffer.from("racing"));
			const old = new Date(Date.now() - 2 * 3_600_000);
			await utimes(join(root, key), old, old);

			let sweep!: Promise<number>;
			await storage.runExclusive(async () => {
				// The sweep starts while "finalization" is in progress...
				sweep = cleanup.sweepOrphans();
				await new Promise((resolve) => setTimeout(resolve, 100));
				// ...and only then does the metadata commit.
				await db.projectDocument.create({
					data: {
						projectId: ids.projectA, uploadedByUserId: ids.owner, originalName: "race.txt",
						storageKey: key, mediaType: "text/plain", sizeBytes: 6, sha256: "b".repeat(64),
					},
				});
			});

			expect(await sweep).toBe(0);
			expect(await fileCount()).toBe(1);
		});

		it("deletes nothing when the database cannot be consulted", async () => {
			const key = storage.newKey();
			await storage.write(key, Buffer.from("orphan?"));
			const old = new Date(Date.now() - 2 * 3_600_000);
			await utimes(join(root, key), old, old);
			jest.spyOn(db.projectDocument, "findUnique").mockRejectedValue(new Error("database down"));

			expect(await cleanup.sweepOrphans()).toBe(0);
			expect(await fileCount()).toBe(1);
		});
	});
});
