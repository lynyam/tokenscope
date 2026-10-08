import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { STATUS_CODES } from "node:http";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import type { AddMemberDto } from "../../src/memberships/dto/add-member.dto";
import type { UpdateMemberRoleDto } from "../../src/memberships/dto/update-member-role.dto";
import { MembershipsService } from "../../src/memberships/memberships.service";

const actorId = randomUUID();
const organizationId = randomUUID();
const targetUserId = randomUUID();
const base = `/api/v1/organizations/${organizationId}/members`;
const detail = `${base}/${targetUserId}`;
const requestId = "tse40-http";

const membership = {
	id: randomUUID(),
	userId: targetUserId,
	organizationId,
	role: "MEMBER",
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-01T00:00:00.000Z",
	user: {
		id: targetUserId,
		email: "target@memberships.test",
		displayName: "Target",
	},
};

const routes = {
	list: {
		method: "get",
		path: base,
		body: undefined,
	},
	add: {
		method: "post",
		path: base,
		body: { email: membership.user.email },
	},
	updateRole: {
		method: "patch",
		path: detail,
		body: { role: "ADMIN" },
	},
	remove: {
		method: "delete",
		path: detail,
		body: undefined,
	},
} as const;

type Operation = keyof typeof routes;

describe("Membership HTTP contract with real JWT authentication", () => {
	let app: INestApplication;
	let bearer: string;

	const members = {
		list: jest.fn(),
		add: jest.fn(),
		updateRole: jest.fn(),
		remove: jest.fn(),
	};

	beforeAll(async () => {
		const context = await Test.createTestingModule({
			imports: [AppModule],
		})
			.overrideProvider(PrismaService)
			.useValue({})
			.overrideProvider(MembershipsService)
			.useValue(members)
			.compile();

		app = context.createNestApplication({ logger: false });
		configureApp(app);
		await app.init();

		bearer =
			"Bearer " +
			app.get(TokenService).signAccessToken(actorId).accessToken;
	});

	beforeEach(() => {
		Object.values(members).forEach((mock) => mock.mockReset());

		members.list.mockResolvedValue({
			memberships: [membership],
			currentUserRole: "OWNER",
		});

		members.add.mockImplementation(
			async (_actor, _org, dto: AddMemberDto) => ({
				...membership,
				role: dto.role,
			}),
		);

		members.updateRole.mockImplementation(
			async (_actor, _org, _target, dto: UpdateMemberRoleDto) => ({
				...membership,
				role: dto.role,
			}),
		);

		members.remove.mockResolvedValue(undefined);
	});

	afterAll(async () => {
		await app?.close();
	});

	function send(
		operation: Operation,
		options: {
			authorization?: string | null;
			path?: string;
			body?: Record<string, unknown>;
		} = {},
	) {
		const route = routes[operation];

		const call = request(app.getHttpServer())[route.method](
			options.path ?? route.path,
		).set("X-Request-Id", requestId);

		const authorization =
			options.authorization === undefined
				? bearer
				: options.authorization;

		if (authorization !== null) {
			call.set("Authorization", authorization);
		}

		return call.send(options.body ?? route.body);
	}

	function expectNoServiceCalls() {
		Object.values(members).forEach((mock) =>
			expect(mock).not.toHaveBeenCalled(),
		);
	}

	it("GET returns the list envelope and uses the verified actor", async () => {
		await send("list")
			.expect(200)
			.expect("X-Request-Id", requestId)
			.expect({
				memberships: [membership],
				currentUserRole: "OWNER",
			});

		expect(members.list).toHaveBeenCalledWith(
			actorId,
			organizationId,
		);
	});

	it("POST normalizes email, defaults the role, and returns 201", async () => {
		await send("add", {
			body: { email: "  TARGET@Memberships.Test  " },
		})
			.expect(201)
			.expect(membership);

		expect(members.add).toHaveBeenCalledWith(
			actorId,
			organizationId,
			expect.objectContaining({
				email: membership.user.email,
				role: "MEMBER",
			}),
		);
	});

	it("PATCH keeps the actor distinct from the target and returns 200", async () => {
		await send("updateRole")
			.expect(200)
			.expect({ ...membership, role: "ADMIN" });

		expect(members.updateRole).toHaveBeenCalledWith(
			actorId,
			organizationId,
			targetUserId,
			expect.objectContaining({ role: "ADMIN" }),
		);
	});

	it("DELETE returns 204 with an empty body", async () => {
		const response = await send("remove")
			.expect(204)
			.expect("X-Request-Id", requestId);

		expect(response.text).toBe("");
		expect(members.remove).toHaveBeenCalledWith(
			actorId,
			organizationId,
			targetUserId,
		);
	});

	it.each(Object.keys(routes) as Operation[])(
		"requires authentication for %s",
		async (operation) => {
			const response = await send(operation, {
				authorization: null,
			}).expect(401);

			expect(response.body).toMatchObject({
				statusCode: 401,
				code: "AUTHENTICATION_REQUIRED",
				requestId,
			});
			expect(response.headers["x-request-id"]).toBe(requestId);
			expectNoServiceCalls();
		},
	);

	it("rejects an invalid bearer token before calling the service", async () => {
		const response = await send("list", {
			authorization: "Bearer not-a-token",
		}).expect(401);

		expect(response.body.code).toBe("INVALID_ACCESS_TOKEN");
		expectNoServiceCalls();
	});

	it.each([
		["list", "/api/v1/organizations/invalid/members", "organizationId"],
		["add", "/api/v1/organizations/invalid/members", "organizationId"],
		[
			"updateRole",
			`/api/v1/organizations/invalid/members/${targetUserId}`,
			"organizationId",
		],
		[
			"remove",
			`/api/v1/organizations/invalid/members/${targetUserId}`,
			"organizationId",
		],
		["updateRole", `${base}/invalid`, "userId"],
		["remove", `${base}/invalid`, "userId"],
	] as const)(
		"validates UUIDs for %s at %s",
		async (operation, path, field) => {
			const response = await send(operation, { path }).expect(400);

			expect(response.body).toMatchObject({
				code: "VALIDATION_ERROR",
				requestId,
			});
			expect(response.body.details).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ field }),
				]),
			);
			expectNoServiceCalls();
		},
	);

	it.each([
		{},
		{ email: "invalid" },
		{ email: membership.user.email, role: null },
		{ email: membership.user.email, role: "ROOT" },
		{ email: membership.user.email, role: 42 },
	])("rejects invalid POST body %j", async (body) => {
		const response = await send("add", { body }).expect(400);

		expect(response.body).toMatchObject({
			code: "VALIDATION_ERROR",
			requestId,
		});
		expectNoServiceCalls();
	});

	it.each([
		{},
		{ role: null },
		{ role: "ROOT" },
		{ role: 42 },
	])("rejects invalid PATCH body %j", async (body) => {
		const response = await send("updateRole", { body }).expect(400);

		expect(response.body.code).toBe("VALIDATION_ERROR");
		expectNoServiceCalls();
	});

	it.each(["userId", "organizationId", "passwordHash"])(
		"rejects injected body field %s",
		async (field) => {
			for (const operation of ["add", "updateRole"] as const) {
				const response = await send(operation, {
					body: {
						...routes[operation].body,
						[field]: "injected",
					},
				}).expect(400);

				expect(response.body.code).toBe("VALIDATION_ERROR");
			}

			expectNoServiceCalls();
		},
	);

	it.each([
		[
			"list", 404, "ORGANIZATION_NOT_FOUND",
			"Organization not found.",
		],
		[
			"add", 404, "USER_NOT_FOUND",
			"User not found.",
		],
		[
			"add", 409, "MEMBERSHIP_ALREADY_EXISTS",
			"This user is already a member of the organization.",
		],
		[
			"updateRole", 403, "INSUFFICIENT_ORGANIZATION_ROLE",
			"You are not allowed to perform this action.",
		],
		[
			"updateRole", 404, "MEMBERSHIP_NOT_FOUND",
			"Membership not found.",
		],
		[
			"updateRole", 409, "LAST_OWNER_REQUIRED",
			"An organization must retain at least one owner.",
		],
		[
			"remove", 409, "LAST_OWNER_REQUIRED",
			"An organization must retain at least one owner.",
		],
	] as const)(
		"maps %s failure to %s %s",
		async (operation, statusCode, code, message) => {
			members[operation].mockRejectedValueOnce(
				new ApiException(statusCode, code, message),
			);

			await send(operation)
				.expect(statusCode)
				.expect("X-Request-Id", requestId)
				.expect({
					statusCode,
					code,
					error: STATUS_CODES[statusCode],
					message,
					requestId,
				});
		},
	);

	it("hides unexpected internal failures behind the standard 500 response", async () => {
		members.add.mockRejectedValueOnce(
			new Error("P2002 passwordHash=PRIVATE_DATABASE_DETAIL"),
		);

		await send("add")
			.expect(500)
			.expect("X-Request-Id", requestId)
			.expect({
				statusCode: 500,
				code: "INTERNAL_SERVER_ERROR",
				error: "Internal Server Error",
				message: "An unexpected error occurred.",
				requestId,
			});
	});
});
