import { randomUUID } from "node:crypto"; // generates a random v4 UUID
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing"; // builds a Nest app inside Jest
import request from "supertest"; // sends real HTTP requests to an app, from inside the app
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { TokenService } from "../../src/auth/token.service";
// ADAPT: copy any PrismaService override used by projects.e2e-spec.ts

/**
 * universal unique identifier (128 bit)
 */
const ORG = randomUUID();
const PROJECT = randomUUID();
const URL = `/api/v1/organizations/${ORG}/projects/${PROJECT}/assistant`;

const validBody = {
	question: "Which model contributes most to the estimated cost?",
	from: "2026-09-28T00:00:00.000Z",
	to: "2026-10-05T00:00:00.000Z",
	filters: { provider: "openai" },
};

describe("POST /assistant — request contract (TSE-80 phase 2)", () => {
	let app: INestApplication;
	let token: string;

	beforeAll(async () => {
		// createTestingModule + compile: assembles the real module graph.
		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			// .overrideProvider(PrismaService).useValue(...)   ← ADAPT as in existing e2e specs
			.compile();

		// createNestApplication: the HTTP app. Same rawBody option as main.ts.
		app = moduleRef.createNestApplication({ rawBody: true });
		configureApp(app); // same prefix, filter, pipe as production
		await app.init(); // starts the app (without listening on a port)

		// app.get(): fetch a provider instance. The guard checks only the JWT,
		// not the database, so any UUID works for these contract tests.
		token = app.get(TokenService).signAccessToken(randomUUID()).accessToken;
	});

	afterAll(async () => {
		await app.close();
	});

	// supertest: request(server).post(url).set(header).send(body).expect(status)
	const post = (body: unknown) =>
		request(app.getHttpServer()).post(URL).set("Authorization", `Bearer ${token}`).send(body as object);

	it("401 AUTHENTICATION_REQUIRED without a token", async () => {
		const res = await request(app.getHttpServer()).post(URL).send(validBody).expect(401);
		expect(res.body.code).toBe("AUTHENTICATION_REQUIRED"); // ADAPT if the envelope nests the code
	});

	it("401 INVALID_ACCESS_TOKEN with a forged token", async () => {
		const res = await request(app.getHttpServer())
			.post(URL)
			.set("Authorization", "Bearer not.a.jwt")
			.send(validBody)
			.expect(401);
		expect(res.body.code).toBe("INVALID_ACCESS_TOKEN");
	});

	it("400 on a non-UUID route id", async () => {
		await request(app.getHttpServer())
			.post(`/api/v1/organizations/not-a-uuid/projects/${PROJECT}/assistant`)
			.set("Authorization", `Bearer ${token}`)
			.send(validBody)
			.expect(400);
	});

	it.each<[string, unknown]>([
		["blank question", { ...validBody, question: "   " }],
		["question over 2000 chars", { ...validBody, question: "a".repeat(2001) }],
		["missing from", { ...validBody, from: undefined }],
		["offset instead of Z", { ...validBody, from: "2026-09-28T02:00:00.000+02:00" }],
		["not a date", { ...validBody, to: "yesterday" }],
		["reversed range", { ...validBody, from: validBody.to, to: validBody.from }],
		["over 90 days", { ...validBody, from: "2026-06-01T00:00:00.000Z" }],
		["missing filters", { ...validBody, filters: undefined }],
		["filters not an object", { ...validBody, filters: "openai" }],
		["array in a text filter", { ...validBody, filters: { provider: ["openai"] } }],
		["null filter value", { ...validBody, filters: { provider: null } }],
		["invalid status", { ...validBody, filters: { status: "FAILED" } }],
		["unknown top-level field", { ...validBody, extra: true }],
		["legacy traceId", { ...validBody, traceId: randomUUID() }],
		["client-supplied project name", { ...validBody, projectName: "x" }],
		["client-calculated totals", { ...validBody, summary: { traceCount: 6 } }],
		["unknown nested filter", { ...validBody, filters: { foo: "bar" } }],
		["pagination parameter", { ...validBody, page: 2 }],
	])("400 VALIDATION_ERROR: %s", async (_label, body) => {
		const res = await post(body).expect(400);
		expect(res.body.code).toBe("VALIDATION_ERROR");
	});

	it("413 when ACTUAL bytes exceed 8 KiB although every field is valid", async () => {
		// Whitespace is legal JSON: the DTO passes, but the raw body is ~9 KB.
		const padded = "{" + " ".repeat(9000) + JSON.stringify(validBody).slice(1);
		const res = await request(app.getHttpServer())
			.post(URL)
			.set("Authorization", `Bearer ${token}`)
			.set("Content-Type", "application/json")
			.send(padded)
			.expect(413);
		expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
	});

	it("accepts multibyte text within 8 KiB (2000 × 'é' = 4000 bytes)", async () => {
		await post({ ...validBody, question: "é".repeat(2000) }).expect(501);
	});

	it("accepts an empty filters object", async () => {
		await post({ ...validBody, filters: {} }).expect(501);
	});

	it("a valid request reaches the service (temporary 501 until Phase 5)", async () => {
		await post(validBody).expect(501);
	});
});