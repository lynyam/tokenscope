import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import type { EnvironmentVariables } from "../../src/config/env.validation";
import { PrismaService } from "../../src/database/prisma.service";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PricingService } from "../../src/pricing/pricing.service";
import { resetTestDatabase } from "../support/reset-test-database";

const ids = {
	owner: randomUUID(), admin: randomUUID(), member: randomUUID(), outsider: randomUUID(),
	orgA: randomUUID(), orgB: randomUUID(),
	activeProject: randomUUID(), archivedProject: randomUUID(), controlProject: randomUUID(),
};
const base = "/api/v1/organizations";
const detail = base + "/" + ids.orgA;
const projectsBase = detail + "/projects";
const projectOne = projectsBase + "/" + ids.activeProject;
const projectArchivedAt = new Date("2025-05-05T00:00:00Z");

describe("Organization archive with PostgreSQL", () => {
	let app: INestApplication;
	let prisma: PrismaService;
	let config: ConfigService<EnvironmentVariables>;

	const bearer = (userId: string) => "Bearer " + sign(
		{ sub: userId },
		config.getOrThrow("JWT_SECRET", { infer: true }),
		{
			algorithm: "HS256",
			issuer: config.getOrThrow("JWT_ISSUER", { infer: true }),
			audience: config.getOrThrow("JWT_AUDIENCE", { infer: true }),
			expiresIn: config.getOrThrow("JWT_ACCESS_TTL_SECONDS", { infer: true }),
		},
	);
	// Requests are built lazily: several eager supertest objects close the server.
	const archive = (userId: string, confirmSlug: string = "original") =>
		request(app.getHttpServer()).delete(detail)
			.set("Authorization", bearer(userId)).send({ confirmSlug });

	const snapshot = async () => ({
		users: await prisma.user.findMany({ orderBy: { id: "asc" } }),
		memberships: await prisma.membership.findMany({ orderBy: { id: "asc" } }),
		projects: await prisma.project.findMany({ orderBy: { id: "asc" } }),
		control: await prisma.organization.findUnique({ where: { id: ids.orgB } }),
	});

	beforeAll(async () => {
		// jest-integration.json runs require-test-database.ts before this file.
		const context = await Test.createTestingModule({ imports: [AppModule] }).compile();
		app = context.createNestApplication({ logger: false, rawBody: true, });
		configureApp(app);
		await app.init();
		prisma = app.get(PrismaService);
		config = app.get(ConfigService);
	});

	beforeEach(async () => {
		// Destructive cleanup is limited to the guarded, isolated test database.
		await resetTestDatabase(prisma);

		await prisma.user.createMany({
			data: (["owner", "admin", "member", "outsider"] as const).map(name => ({
				id: ids[name], email: name + "@archive.test", displayName: name,
				passwordHash: "test-fixture-hash-never-return",
			})),
		});
		await prisma.organization.createMany({
			data: [
				{ id: ids.orgA, name: "Original", slug: "original" },
				{ id: ids.orgB, name: "Control tenant", slug: "control-tenant" },
			],
		});
		await prisma.membership.createMany({
			data: [
				{ organizationId: ids.orgA, userId: ids.owner, role: "OWNER" },
				{ organizationId: ids.orgA, userId: ids.admin, role: "ADMIN" },
				{ organizationId: ids.orgA, userId: ids.member, role: "MEMBER" },
				// The OWNER also belongs to a control organization that must stay usable.
				{ organizationId: ids.orgB, userId: ids.owner, role: "OWNER" },
				{ organizationId: ids.orgB, userId: ids.outsider, role: "OWNER" },
			],
		});
		await prisma.project.createMany({
			data: [
				{ id: ids.activeProject, organizationId: ids.orgA, name: "Active", slug: "active" },
				{
					id: ids.archivedProject, organizationId: ids.orgA, name: "Old", slug: "old",
					archivedAt: projectArchivedAt,
				},
				{ id: ids.controlProject, organizationId: ids.orgB, name: "Control", slug: "control" },
			],
		});
	});

	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => { await app?.close(); });

	it("rejects a missing or malformed token", async () => {
		const missing = await request(app.getHttpServer()).delete(detail)
			.send({ confirmSlug: "original" }).expect(401);
		expect(missing.body.code).toBe("AUTHENTICATION_REQUIRED");
		await request(app.getHttpServer()).delete(detail)
			.set("Authorization", "Bearer not-a-jwt").send({ confirmSlug: "original" }).expect(401);
		expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).archivedAt)
			.toBeNull();
	});

	it("lets the OWNER archive: 204, row kept, children and other tenants untouched", async () => {
		const before = await snapshot();

		const response = await archive(ids.owner).expect(204);
		expect(response.text).toBe("");

		const row = await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } });
		expect(row.archivedAt).toBeInstanceOf(Date);

		const after = await snapshot();
		expect(after.users).toEqual(before.users);
		expect(after.memberships).toEqual(before.memberships);
		expect(after.projects).toEqual(before.projects); // Project archive timestamps included.
		expect(after.control).toEqual(before.control);
		const old = after.projects.find(project => project.id === ids.archivedProject);
		expect(old?.archivedAt?.toISOString()).toBe(projectArchivedAt.toISOString());
	});

	it("checks the role before comparing the slug", async () => {
		// A wrong slug must not reveal anything to non-owners.
		for (const userId of [ids.admin, ids.member]) {
			const response = await archive(userId, "wrong-slug").expect(403);
			expect(response.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
		}
		const outsider = await archive(ids.outsider, "wrong-slug").expect(404);
		expect(outsider.body.code).toBe("ORGANIZATION_NOT_FOUND");

		const mismatch = await archive(ids.owner, "Original").expect(409);
		expect(mismatch.body.code).toBe("ORGANIZATION_CONFIRMATION_MISMATCH");

		expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).archivedAt)
			.toBeNull();
	});

	it("rejects every organization-scoped path once archived, for every former member", async () => {
		await archive(ids.owner).expect(204);
		const server = app.getHttpServer();

		for (const userId of [ids.owner, ids.admin, ids.member]) {
			const auth = bearer(userId);
			const calls = [
				[() => request(server).get(detail).set("Authorization", auth), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).patch(detail).set("Authorization", auth).send({ name: "Renamed" }), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).delete(detail).set("Authorization", auth).send({ confirmSlug: "original" }), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).get(detail + "/members").set("Authorization", auth), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).post(detail + "/members").set("Authorization", auth)
					.send({ email: "outsider@archive.test", role: "MEMBER" }), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).patch(detail + "/members/" + ids.admin).set("Authorization", auth)
					.send({ role: "MEMBER" }), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).delete(detail + "/members/" + ids.member).set("Authorization", auth), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).get(projectsBase).set("Authorization", auth), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).post(projectsBase).set("Authorization", auth).send({ name: "New" }), "ORGANIZATION_NOT_FOUND"],
				[() => request(server).get(projectOne).set("Authorization", auth), "PROJECT_NOT_FOUND"],
				[() => request(server).patch(projectOne).set("Authorization", auth).send({ name: "Changed" }), "PROJECT_NOT_FOUND"],
				[() => request(server).delete(projectOne).set("Authorization", auth), "PROJECT_NOT_FOUND"],
			] as const;

			for (const [makeCall, code] of calls) {
				const response = await makeCall().expect(404);
				expect(response.body.code).toBe(code);
			}
		}
	});

	it("omits the archived organization from every former member's list", async () => {
		await archive(ids.owner).expect(204);
		for (const userId of [ids.owner, ids.admin, ids.member]) {
			const response = await request(app.getHttpServer()).get(base)
				.set("Authorization", bearer(userId)).expect(200);
			const listed = (response.body as { id: string }[]).map(item => item.id);
			expect(listed).not.toContain(ids.orgA);
		}
	});

	it("keeps the session and the control organization usable", async () => {
		await archive(ids.owner).expect(204);
		const me = await request(app.getHttpServer()).get("/api/v1/auth/me")
			.set("Authorization", bearer(ids.owner)).expect(200);
		expect(me.body.id ?? me.body.user?.id).toBe(ids.owner);

		const control = await request(app.getHttpServer()).get(base + "/" + ids.orgB)
			.set("Authorization", bearer(ids.owner)).expect(200);
		expect(control.body.id).toBe(ids.orgB);
		await request(app.getHttpServer()).get(base + "/" + ids.orgB + "/projects")
			.set("Authorization", bearer(ids.owner)).expect(200);
	});

	it("returns 404 on a second deletion and keeps reserving the slug", async () => {
		await archive(ids.owner).expect(204);
		const again = await archive(ids.owner).expect(404);
		expect(again.body.code).toBe("ORGANIZATION_NOT_FOUND");

		const recreate = await request(app.getHttpServer()).post(base)
			.set("Authorization", bearer(ids.owner)).send({ name: "Original" }).expect(409);
		expect(recreate.body.code).toBe("ORGANIZATION_SLUG_CONFLICT");
	});

	it("lets a sole OWNER archive without touching memberships", async () => {
		await prisma.membership.deleteMany({
			where: { organizationId: ids.orgA, userId: { in: [ids.admin, ids.member] } },
		});
		await archive(ids.owner).expect(204);
		expect(await prisma.membership.count({ where: { organizationId: ids.orgA } })).toBe(1);
	});

	it("leaves the organization active when the transaction fails after the write", async () => {
		const original = prisma.$transaction.bind(prisma) as (fn: unknown, options?: unknown) => Promise<unknown>;
		jest.spyOn(prisma, "$transaction").mockImplementation(((fn: (tx: unknown) => Promise<unknown>, options?: unknown) =>
			original(async (tx: unknown) => {
				await fn(tx);
				throw new Error("forced failure after the archive write");
			}, options)) as never);

		const response = await archive(ids.owner).expect(500);
		expect(response.body.code).toBe("INTERNAL_SERVER_ERROR");
		jest.restoreAllMocks();

		expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).archivedAt)
			.toBeNull();
	});

	it("denies the archive after a role change committed before authorization", async () => {
		await prisma.membership.update({
			where: { organizationId_userId: { organizationId: ids.orgA, userId: ids.owner } },
			data: { role: "ADMIN" },
		});
		const response = await archive(ids.owner).expect(403);
		expect(response.body.code).toBe("INSUFFICIENT_ORGANIZATION_ROLE");
		expect((await prisma.organization.findUniqueOrThrow({ where: { id: ids.orgA } })).archivedAt)
			.toBeNull();
	});

	it("cannot bypass the final active-parent condition when archived after the preliminary check", async () => {
		// The first membership lookup is the preliminary authorization. The
		// organization is archived right after it, before the final project query.
		const original = prisma.membership.findUnique.bind(prisma.membership) as (args: unknown) => Promise<unknown>;
		let archived = false;
		jest.spyOn(prisma.membership, "findUnique").mockImplementation((async (args: unknown) => {
			const result = await original(args);
			if (!archived) {
				archived = true;
				await prisma.organization.update({
					where: { id: ids.orgA }, data: { archivedAt: new Date() },
				});
			}
			return result;
		}) as never);

		const response = await request(app.getHttpServer()).get(projectOne)
			.set("Authorization", bearer(ids.owner)).expect(404);
		expect(archived).toBe(true);
		expect(response.body.code).toBe("PROJECT_NOT_FOUND");
	});

	it(
		"blocks keys, traces and analytics after HTTP archive while retaining their rows",
		async () => {
			const fixtureDirectory = existsSync("/fixtures/evaluation")
				? "/fixtures/evaluation"
				: resolve(process.cwd(), "../fixtures/evaluation");

			const readFixture = (name: string): unknown =>
				JSON.parse(
					readFileSync(
						resolve(fixtureDirectory, name),
						"utf8",
					),
				);

			await app.get(PricingService).loadCatalogue(
				readFixture("model-prices.json"),
			);

			const golden = readFixture("traces-golden.json") as Array<{
				body: Record<string, unknown>;
			}>;

			const payload = {
				...golden[0].body,
				externalId: "organization-archive-test",
			};

			const server = app.getHttpServer();
			const authorization = bearer(ids.owner);
			const keyPath = projectOne + "/api-keys";
			const publicPath = "/api/v1/public/traces";

			const period = {
				from: "2026-10-01T00:00:00.000Z",
				to: "2026-10-02T00:00:00.000Z",
			};

			const createdKey = await request(server)
				.post(keyPath)
				.set("Authorization", authorization)
				.send({ name: "Archive test" })
				.expect(201);

			const key = createdKey.body as {
				id: string;
				key: string;
			};

			const createdTrace = await request(server)
				.post(publicPath)
				.set("X-API-Key", key.key)
				.send(payload)
				.expect(201);

			const traceId = createdTrace.body.id as string;
			const tracePath = publicPath + "/" + traceId;

			// Prove these credentials and routes work before archiving.
			await request(server)
				.get(projectOne + "/traces")
				.set("Authorization", authorization)
				.query(period)
				.expect(200);

			await request(server)
				.get(projectOne + "/traces/" + traceId)
				.set("Authorization", authorization)
				.expect(200);

			await request(server)
				.get(projectOne + "/analytics")
				.set("Authorization", authorization)
				.query({ ...period, bucket: "hour" })
				.expect(200);

			const keyBefore = await prisma.apiKey.findUniqueOrThrow({
				where: { id: key.id },
			});

			const traceBefore = await prisma.trace.findUniqueOrThrow({
				where: { id: traceId },
			});

			const childrenBefore = await snapshot();

			// Exercise the real archive endpoint.
			await archive(ids.owner).expect(204);

			for (const userId of [
				ids.owner,
				ids.admin,
				ids.member,
			]) {
				const jwt = bearer(userId);

				// Build requests lazily, as in the existing integration tests.
				const calls = [
					() => request(server)
						.get(keyPath)
						.set("Authorization", jwt),

					() => request(server)
						.post(keyPath)
						.set("Authorization", jwt)
						.send({ name: "Denied" }),

					() => request(server)
						.delete(keyPath + "/" + key.id)
						.set("Authorization", jwt),

					() => request(server)
						.get(projectOne + "/traces")
						.set("Authorization", jwt)
						.query(period),

					() => request(server)
						.get(projectOne + "/traces/" + traceId)
						.set("Authorization", jwt),

					() => request(server)
						.get(projectOne + "/analytics")
						.set("Authorization", jwt)
						.query({ ...period, bucket: "hour" }),
				];

				for (const call of calls) {
					const denied = await call().expect(404);
					expect(denied.body.code).toBe("PROJECT_NOT_FOUND");
				}
			}

			const publicCalls = [
				() => request(server)
					.post(publicPath)
					.set("X-API-Key", key.key)
					.send(payload),

				() => request(server)
					.get(publicPath)
					.set("X-API-Key", key.key)
					.query(period),

				() => request(server)
					.get(tracePath)
					.set("X-API-Key", key.key),

				() => request(server)
					.put(tracePath)
					.set("X-API-Key", key.key)
					.set("If-Match", '"1"')
					.send(payload),

				() => request(server)
					.delete(tracePath)
					.set("X-API-Key", key.key)
					.set("If-Match", '"1"'),
			];

			for (const call of publicCalls) {
				const denied = await call().expect(401);
				expect(denied.body.code).toBe("INVALID_API_KEY");
			}

			// Parent inaccessibility must not mutate the retained child records.
			expect(
				await prisma.apiKey.findUniqueOrThrow({
					where: { id: key.id },
				}),
			).toEqual(keyBefore);

			expect(
				await prisma.trace.findUniqueOrThrow({
					where: { id: traceId },
				}),
			).toEqual(traceBefore);

			expect(await snapshot()).toEqual(childrenBefore);

			await request(server)
				.get("/api/v1/auth/me")
				.set("Authorization", authorization)
				.expect(200);

			await request(server)
				.get(base + "/" + ids.orgB)
				.set("Authorization", authorization)
				.expect(200);
		},
	);
});
