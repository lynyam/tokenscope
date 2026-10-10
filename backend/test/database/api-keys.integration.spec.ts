import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { ApiKeysModule } from "../../src/api-keys/api-keys.module";
import { ApiKeysService } from "../../src/api-keys/api-keys.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { hashApiKey } from "../../src/api-keys/api-key-secret";
import { PrismaService } from "../../src/database/prisma.service";
import { Prisma } from "../../src/generated/prisma/client";
import { TokenService } from "../../src/auth/token.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { configureApp } from "../../src/configure-app";
import { resetTestDatabase } from "../support/reset-test-database";
import { ApiKeyProbeController } from "../support/api-key-probe.controller";

describe("API keys with PostgreSQL", () => {
	let app: INestApplication;
	let db: PrismaService;
	let tokens: TokenService;
	let auth: ApiKeyAuthService;
	let keys: ApiKeysService;
	let access: ProjectAccessService;
	let now = 0;

	const ids = {
		owner: randomUUID(),
		admin: randomUUID(),
		member: randomUUID(),
		outsider: randomUUID(),
		orgA: randomUUID(),
		orgB: randomUUID(),
		projectA: randomUUID(),
		projectB: randomUUID(),
	};

	const base =
		`/api/v1/organizations/${ids.orgA}` +
		`/projects/${ids.projectA}/api-keys`;

	const otherBase =
		`/api/v1/organizations/${ids.orgB}` +
		`/projects/${ids.projectB}/api-keys`;

	const probe = "/api/v1/__test/api-key";

	const bearer = (userId = ids.owner) =>
		"Bearer " + tokens.signAccessToken(userId).accessToken;

	const create = (userId = ids.owner, path = base) =>
		request(app.getHttpServer())
			.post(path)
			.set("Authorization", bearer(userId))
			.send({ name: "Writer" });

	const use = (key: string) =>
		request(app.getHttpServer())
			.get(probe)
			.set("X-API-Key", key);

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule, ApiKeysModule],
			controllers: [ApiKeyProbeController],
		})
			.overrideProvider(RateLimitClock)
			.useValue({ now: () => now })
			.compile();

		app = context.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();

		db = app.get(PrismaService);
		tokens = app.get(TokenService);
		auth = app.get(ApiKeyAuthService);
		keys = app.get(ApiKeysService);
		access = app.get(ProjectAccessService);
	});

	beforeEach(async () => {
		now += 60_001;
		await resetTestDatabase(db);

		await db.user.createMany({
			data: (["owner", "admin", "member", "outsider"] as const)
				.map(name => ({
					id: ids[name],
					email: `${name}@api-keys.test`,
					displayName: name,
					passwordHash: "fixture-only",
				})),
		});

		await db.organization.createMany({
			data: [
				{ id: ids.orgA, name: "A", slug: "api-key-a" },
				{ id: ids.orgB, name: "B", slug: "api-key-b" },
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
				{
					id: ids.projectA,
					organizationId: ids.orgA,
					name: "A",
					slug: "project-a",
				},
				{
					id: ids.projectB,
					organizationId: ids.orgB,
					name: "B",
					slug: "project-b",
				},
			],
		});
	});

	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => { await app?.close(); });

	it.each(["owner", "admin"] as const)(
		"allows %s to create, list, use and revoke",
		async actor => {
			const created = await create(ids[actor]).expect(201);
			const saved = await db.apiKey.findUniqueOrThrow({
				where: { id: created.body.id },
			});

			expect(saved.keyHash).toBe(hashApiKey(created.body.key));
			expect(saved.keyPrefix).toBe(created.body.key.slice(0, 12));
			expect(saved.createdByUserId).toBe(ids[actor]);
			expect(JSON.stringify(saved)).not.toContain(created.body.key);

			const listed = await request(app.getHttpServer())
				.get(base).set("Authorization", bearer(ids[actor]))
				.expect(200);

			expect(listed.body).toHaveLength(1);
			expect(listed.body[0]).not.toHaveProperty("key");
			expect(listed.body[0]).not.toHaveProperty("keyHash");

			await use(created.body.key)
				.expect(200)
				.expect({
					keyId: created.body.id,
					projectId: ids.projectA,
				});

			await request(app.getHttpServer())
				.delete(`${base}/${created.body.id}`)
				.set("Authorization", bearer(ids[actor]))
				.expect(204);

			await use(created.body.key).expect(401);
		},
	);

	it.each([
		["member", 403, "INSUFFICIENT_ORGANIZATION_ROLE"],
		["outsider", 404, "PROJECT_NOT_FOUND"],
	] as const)(
		"rejects %s on all management operations",
		async (actor, status, code) => {
			const created = await create().expect(201);

			for (const method of ["get", "post", "delete"] as const) {
				const path = method === "delete"
					? `${base}/${created.body.id}`
					: base;

				const call = request(app.getHttpServer())[method](path)
					.set("Authorization", bearer(ids[actor]));

				if (method === "post") call.send({ name: "Forbidden" });

				const response = await call.expect(status);
				expect(response.body.code).toBe(code);
			}
		},
	);

	it("conceals an organization/project mismatch", async () => {
		const response = await create(
			ids.owner,
			base.replace(ids.projectA, ids.projectB),
		).expect(404);

		expect(response.body.code).toBe("PROJECT_NOT_FOUND");
	});

	it("returns an empty list", async () => {
		await request(app.getHttpServer())
			.get(base).set("Authorization", bearer())
			.expect(200).expect([]);
	});

	it("allows duplicate names and provides stable active/revoked ordering", async () => {
		const first = (await create().expect(201)).body;
		const second = (await create().expect(201)).body;
		const third = (await create().expect(201)).body;

		const tie = new Date("2026-10-01T00:00:00Z");

		await db.apiKey.updateMany({
			where: { id: { in: [first.id, second.id] } },
			data: { createdAt: tie },
		});
		await db.apiKey.update({
			where: { id: third.id },
			data: { createdAt: new Date("2026-10-02T00:00:00Z") },
		});

		await request(app.getHttpServer())
			.delete(`${base}/${first.id}`)
			.set("Authorization", bearer()).expect(204);

		const list = await request(app.getHttpServer())
			.get(base).set("Authorization", bearer()).expect(200);

		expect(list.body.map((item: { id: string }) => item.id))
			.toEqual([third.id, ...[first.id, second.id].sort()]);
		expect(list.body.find((item: { id: string }) => item.id === first.id)
			.revokedAt).not.toBeNull();
	});

	it("denies cross-project revocation", async () => {
		const other = await create(ids.outsider, otherBase).expect(201);

		const response = await request(app.getHttpServer())
			.delete(`${base}/${other.body.id}`)
			.set("Authorization", bearer()).expect(404);

		expect(response.body.code).toBe("API_KEY_NOT_FOUND");
		await use(other.body.key).expect(200);
	});

	it("preserves the timestamp on repeated revoke and leaves other credentials usable", async () => {
		const first = (await create().expect(201)).body;
		const second = (await create().expect(201)).body;

		const revoke = () => request(app.getHttpServer())
			.delete(`${base}/${first.id}`)
			.set("Authorization", bearer()).expect(204);

		await revoke();

		const before = await db.apiKey.findUniqueOrThrow({
			where: { id: first.id },
		});

		await revoke();

		const after = await db.apiKey.findUniqueOrThrow({
			where: { id: first.id },
		});

		expect(after.revokedAt).toEqual(before.revokedAt);
		await use(first.key).expect(401);
		await use(second.key).expect(200);

		await request(app.getHttpServer())
			.get("/api/v1/auth/me")
			.set("Authorization", bearer()).expect(200);
	});

	it.each(["project", "organization"] as const)(
		"retains keys but denies use after %s archive",
		async parent => {
			const created = (await create().expect(201)).body;

			if (parent === "project") {
				await db.project.update({
					where: { id: ids.projectA },
					data: { archivedAt: new Date() },
				});
			} else {
				await db.organization.update({
					where: { id: ids.orgA },
					data: { archivedAt: new Date() },
				});
			}

			expect(await db.apiKey.count()).toBe(1);
			await use(created.key).expect(401);

			const list = await request(app.getHttpServer())
				.get(base).set("Authorization", bearer()).expect(404);

			expect(list.body.code).toBe("PROJECT_NOT_FOUND");
		},
	);

	it("keeps the project credential valid after creator removal", async () => {
		const created = (await create().expect(201)).body;

		await db.membership.delete({
			where: {
				organizationId_userId: {
					organizationId: ids.orgA,
					userId: ids.owner,
				},
			},
		});

		await use(created.key).expect(200);

		await request(app.getHttpServer())
			.get(base).set("Authorization", bearer()).expect(404);

		await request(app.getHttpServer())
			.delete(`${base}/${created.id}`)
			.set("Authorization", bearer(ids.admin)).expect(204);
	});

	it("rechecks a previously authenticated principal after revoke", async () => {
		const created = (await create().expect(201)).body;
		const principal = await auth.authenticate(created.key);

		await request(app.getHttpServer())
			.delete(`${base}/${created.id}`)
			.set("Authorization", bearer()).expect(204);

		await expect(
			db.$transaction(tx => auth.assertActivePrincipal(principal, tx)),
		).rejects.toMatchObject({ code: "INVALID_API_KEY" });
	});

	it("throttles persisted last-used updates", async () => {
		const created = (await create().expect(201)).body;

		await use(created.key).expect(200);
		const first = await db.apiKey.findUniqueOrThrow({
			where: { id: created.id },
		});

		await use(created.key).expect(200);
		const second = await db.apiKey.findUniqueOrThrow({
			where: { id: created.id },
		});

		expect(first.lastUsedAt).not.toBeNull();
		expect(second.lastUsedAt).toEqual(first.lastUsedAt);
	});

	it("enforces unique hashes", async () => {
		const created = (await create().expect(201)).body;
		const saved = await db.apiKey.findUniqueOrThrow({
			where: { id: created.id },
		});

		await expect(db.apiKey.create({
			data: {
				projectId: ids.projectA,
				createdByUserId: ids.owner,
				name: "Duplicate hash",
				keyHash: saved.keyHash,
				keyPrefix: saved.keyPrefix,
			},
		})).rejects.toMatchObject({ code: "P2002" });

		expect(await db.apiKey.count()).toBe(1);
	});

	it("keeps an overlapping authorized request consistent with the serialization boundary", async () => {
		const original = access.assertProjectAccess.bind(access);

		jest.spyOn(access, "assertProjectAccess")
			.mockImplementationOnce(async (...args) => {
				const project = await original(...args);

				// Commit a role change after this transaction's authorization read.
				// The overlapping operation may serialize before that change.
				await db.membership.update({
					where: {
						organizationId_userId: {
							organizationId: ids.orgA,
							userId: ids.owner,
						},
					},
					data: { role: "MEMBER" },
				});

				return project;
			});

		const overlapping = await create();
		expect([201, 403]).toContain(overlapping.status);

		// A fresh request after the change must follow the new role.
		const fresh = await create().expect(403);
		expect(fresh.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
	});

	it.each(["create", "revoke"] as const)(
		"rolls back %s when its transaction fails before commit",
		async operation => {
			const existing = operation === "revoke"
				? (await create().expect(201)).body
				: undefined;

			type Run = <T>(
				work: (tx: Prisma.TransactionClient) => Promise<T>,
				options?: {
					isolationLevel?: Prisma.TransactionIsolationLevel;
				},
			) => Promise<T>;

			const run = db.$transaction.bind(db) as Run;
			const failure = new Error("forced transaction rollback");

			const replacement: Run = (work, options) =>
				run(async tx => {
					await work(tx);
					throw failure;
				}, options);

			const spy = jest.spyOn(db, "$transaction");
			spy.mockImplementationOnce(
				replacement as typeof db.$transaction,
			);

			const pending = operation === "create"
				? keys.create(
					ids.owner, ids.orgA, ids.projectA, { name: "Rollback" },
				)
				: keys.revoke(
					ids.owner, ids.orgA, ids.projectA, existing.id,
				);

			await expect(pending).rejects.toBe(failure);
			spy.mockRestore();

			if (operation === "create") {
				expect(await db.apiKey.count()).toBe(0);
			} else {
				expect((await db.apiKey.findUniqueOrThrow({
					where: { id: existing.id },
				})).revokedAt).toBeNull();
			}
		},
	);
});
