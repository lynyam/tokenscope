import "reflect-metadata";
import { randomBytes, randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { ASSISTANT_PROVIDER } from "../../src/assistant/assistant.provider";
import { readSeedConfig, DATASET_ID, DEFAULT_ANCHOR } from "../../src/evaluation/seed-config";
import { loadSeedFixtures } from "../../src/evaluation/seed-fixtures";
import { seedEvaluation } from "../../src/evaluation/seed-evaluation";
import { PricingService } from "../../src/pricing/pricing.service";
import { calculateTraceCost } from "../../src/pricing/calculate-trace-cost";
import { hashTracePayload } from "../../src/traces/trace-payload";
import { resetTestDatabase } from "../support/reset-test-database";
import { FakeAssistantProvider, delta, done } from "../support/fake-assistant.provider";

jest.setTimeout(60_000);
const password = randomBytes(24).toString("base64url");
const f = loadSeedFixtures(DEFAULT_ANCHOR);
const config = readSeedConfig({ ...process.env, APP_MODE: "test", EVALUATION_SEED_ENABLED: "true", DEMO_PASSWORD: password },
  ["--confirm-database", "tokenscope_test"]);
const org = f.organizations[0].id;
const golden = f.projects[0].id;
const base = `/api/v1/organizations/${org}/projects`;

describe("explicit evaluation seed with real PostgreSQL and HTTP", () => {
  let app: INestApplication;
  let db: PrismaService;
  let clock = 0;
  const provider = new FakeAssistantProvider();
  const seed = () => seedEvaluation(db, config, f);
  const login = async (index = 0) => {
    const result = await request(app.getHttpServer()).post("/api/v1/auth/signin")
      .send({ email: f.users[index].email, password }).expect(200);
    expect(result.body.user.id).toBe(f.users[index].id);
    expect(result.body).not.toHaveProperty("passwordHash");
    return `Bearer ${result.body.accessToken}`;
  };
  const snapshot = async () => JSON.stringify({
    users: await db.user.findMany({ orderBy: { id: "asc" } }),
    organizations: await db.organization.findMany({ orderBy: { id: "asc" } }),
    memberships: await db.membership.findMany({ orderBy: { id: "asc" } }),
    projects: await db.project.findMany({ orderBy: { id: "asc" } }),
    prices: await db.modelPrice.findMany({ orderBy: { id: "asc" } }),
    traces: await db.trace.findMany({ orderBy: { id: "asc" } }),
    receipts: await db.evaluationSeedReceipt.findMany(),
  });

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ASSISTANT_PROVIDER).useValue(provider)
      .overrideProvider(RateLimitClock).useValue({ now: () => clock }).compile();
    app = module.createNestApplication({ logger: false, rawBody: true });
    configureApp(app);
    await app.init();
    db = app.get(PrismaService);
  });
  beforeEach(async () => { clock += 120_000; provider.reset(); await resetTestDatabase(db); });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it("inserts the complete dataset, real hashes, canonical payload hashes and exact costs", async () => {
    expect((await seed()).outcome).toBe("inserted");
    expect(await Promise.all([db.user.count(), db.organization.count(), db.membership.count(), db.project.count(), db.modelPrice.count(), db.trace.count()]))
      .toEqual([4, 2, 4, 5, 3, 59]);
    expect(await db.evaluationSeedReceipt.count()).toBe(1);
    expect((await db.membership.findMany({ orderBy: { id: "asc" } })).map(row => row.role)).toEqual(["OWNER", "ADMIN", "MEMBER", "OWNER"]);
    for (const expected of f.expectedTraces) {
      const row = await db.trace.findUniqueOrThrow({ where: { id: expected.id } });
      expect(row.estimatedCostUsd.toFixed(12)).toBe(expected.estimatedCostUsd);
      expect(row.inputCostUsd.toFixed(12)).toBe(expected.inputCostUsd);
      expect(row.outputCostUsd.toFixed(12)).toBe(expected.outputCostUsd);
      expect(row.priceVersionId).toBe(expected.priceVersionId);
      expect(row.payloadHash).toBe(hashTracePayload(f.traces.find(trace => trace.id === row.id)!.body));
      expect(row).toMatchObject({ version: 1, deletedAt: null });
    }
  });

  it("authenticates all four users and enforces active-project and tenant boundaries", async () => {
    await seed();
    for (let index = 0; index < 4; index++) {
      const authorization = await login(index);
      const orgs = await request(app.getHttpServer()).get("/api/v1/organizations").set("Authorization", authorization).expect(200);
      expect(orgs.body.map((row: { id: string }) => row.id)).toEqual([f.organizations[index === 3 ? 1 : 0].id]);
      if (index < 3) {
        const projects = await request(app.getHttpServer()).get(base).set("Authorization", authorization).expect(200);
        expect(projects.body.map((row: { id: string }) => row.id).sort()).toEqual([f.projects[0].id, f.projects[1].id, f.projects[3].id].sort());
        await request(app.getHttpServer()).get(`${base}/${f.projects[4].id}`).set("Authorization", authorization).expect(404);
        await request(app.getHttpServer()).get(`/api/v1/organizations/${f.organizations[1].id}/projects/${f.projects[2].id}`).set("Authorization", authorization).expect(404);
      } else {
        await request(app.getHttpServer()).get(`${base}/${golden}`).set("Authorization", authorization).expect(404);
      }
    }
    expect(await db.trace.count({ where: { projectId: f.projects[4].id } })).toBe(1);
  });

  it("verifies all real analytics filters and empty buckets against independent values", async () => {
    await seed();
    const authorization = await login();
    for (const [name, query] of [
      ["baseline", {}], ["workflow_batch", { workflow: "batch" }], ["status_ERROR", { status: "ERROR" }],
      ["provider_fixture_a", { provider: "fixture-a" }], ["provider_fixture_b", { provider: "fixture-b" }],
      ["to_15_exclusive", { to: "2026-10-01T15:00:00.000Z" }],
    ] as const) {
      const result = await request(app.getHttpServer()).get(`${base}/${golden}/analytics`)
        .set("Authorization", authorization).query({ ...f.range, ...query }).expect(200);
      expect(result.body.summary).toEqual(f.expected[name]);
      if (name === "baseline") {
        expect(result.body.series).toHaveLength(24);
        expect(result.body.series.filter((row: { traceCount: number }) => row.traceCount === 0)).toHaveLength(18);
        expect(result.body.byModel.map((row: { estimatedCostUsd: string }) => row.estimatedCostUsd).sort())
          .toEqual(["0.007150000000", "0.008200000000"]);
      }
    }
    const empty = await request(app.getHttpServer()).get(`${base}/${f.projects[1].id}/analytics`)
      .set("Authorization", authorization).query(f.range).expect(200);
    expect(empty.body.summary).toEqual(f.expected.empty);
    expect(empty.body.series).toHaveLength(24);
    expect(empty.body.series.every((row: { traceCount: number }) => row.traceCount === 0)).toBe(true);
    const assistant = await request(app.getHttpServer()).post(`${base}/${f.projects[1].id}/assistant`)
      .set("Authorization", authorization)
      .send({ question: "Summarize this project's usage.", ...f.range, filters: {} }).expect(422);
    expect(assistant.body.code).toBe("ASSISTANT_NO_DATA");
    expect(provider.calls).toBe(0);
  });

  it("verifies search, cost ordering and stable pagination through the real API", async () => {
    await seed();
    const authorization = await login();
    const get = (project: string, query = {}) => request(app.getHttpServer())
      .get(`${base}/${project}/traces`).set("Authorization", authorization).query({ ...f.range, ...query });
    const names = (result: request.Response) => result.body.items.map((row: { externalId: string }) => row.externalId);
    expect(names(await get(golden, { q: "SUPPORT" }).expect(200)).sort()).toEqual(["golden-001", "golden-003", "golden-004"]);
    expect(names(await get(golden, { provider: "fixture-b", status: "ERROR" }).expect(200)).sort()).toEqual(["golden-004", "golden-006"]);
    expect(names(await get(golden, { sortBy: "estimatedCostUsd" }).expect(200)))
      .toEqual(["golden-006", "golden-002", "golden-003", "golden-001", "golden-005", "golden-004"]);
    for (const [offset, expected] of [["golden-006", "golden-005"], ["golden-004", "golden-003"], ["golden-002", "golden-001"]].entries()) {
      expect(names(await get(golden, { page: offset + 1, pageSize: 2 }).expect(200))).toEqual(expected);
    }
    const seen: string[] = [];
    for (const [page, count] of [[1, 25], [2, 25], [3, 1]]) {
      const result = await get(f.projects[3].id, { page, pageSize: 25 }).expect(200);
      expect(result.body.items).toHaveLength(count);
      seen.push(...result.body.items.map((row: { id: string }) => row.id));
    }
    expect(new Set(seen).size).toBe(51);
    expect([...seen].sort()).toEqual(f.traces.filter(row => row.projectId === f.projects[3].id).map(row => row.id).sort());
    expect(seen).toEqual([...seen].sort()); // API tie-breaker is ID ascending.
    const pagination = await request(app.getHttpServer()).get(`${base}/${f.projects[3].id}/analytics`)
      .set("Authorization", authorization).query(f.range).expect(200);
    expect(pagination.body.summary).toMatchObject({ traceCount: 51, estimatedCostUsd: "0.009180000000" });
  });

  it("supplies the real seeded dashboard and project description to the fake assistant", async () => {
    await seed();
    provider.script = [delta("These are synthetic evaluation prices."), done()];
    await request(app.getHttpServer()).post(`${base}/${golden}/assistant`)
      .set("Authorization", await login())
      .send({ question: "Summarize the selected usage.", ...f.range, filters: {} })
      .expect(200).expect("Content-Type", /text\/event-stream/);
    expect(provider.calls).toBe(1);
    expect(provider.lastContext?.summary).toEqual(f.expected.baseline);
    expect(provider.lastContext?.project).toEqual({
      id: golden, name: f.projects[0].name, description: f.projects[0].description,
    });
    expect(provider.lastContext?.pricing.containsSyntheticPricing).toBe(true);
  });

  it("selects the correct historical price on either side of the boundary", async () => {
    await seed();
    const pricing = app.get(PricingService);
    for (const [time, expected] of [["11:59:59.999", "0.001400000000"], ["12:00:00.000", "0.002100000000"]]) {
      const price = await db.$transaction(tx => pricing.findEffectivePrice(tx, "fixture-a", "demo-fast", new Date(`2026-10-01T${time}Z`)));
      expect(calculateTraceCost({ inputTokens: 1000, outputTokens: 100, ...price }).estimatedCostUsd.toFixed(12)).toBe(expected);
    }
  });

  it("reruns without changing hashes/timestamps and preserves unrelated data", async () => {
    const unrelated = await db.user.create({ data: { id: randomUUID(), email: "unrelated@control.test", displayName: "Control", passwordHash: "test-only-not-a-login" } });
    await seed();
    const before = await snapshot();
    expect((await seed()).outcome).toBe("already-present");
    expect(await snapshot()).toBe(before);
    expect(await db.user.findUnique({ where: { id: unrelated.id } })).toEqual(unrelated);
  });

  it.each(["email", "id", "slug", "price"])("rejects %s collisions atomically", async scenario => {
    if (scenario === "email" || scenario === "id") await db.user.create({ data: {
      id: scenario === "id" ? f.users[0].id : randomUUID(),
      email: scenario === "email" ? f.users[0].email : "collision@control.test", displayName: "Existing", passwordHash: "not-a-demo-hash",
    } });
    if (scenario === "slug") await db.organization.create({ data: { id: randomUUID(), name: "Existing", slug: f.organizations[0].slug } });
    if (scenario === "price") await db.modelPrice.create({ data: { ...f.prices[0], id: randomUUID(), effectiveFrom: new Date(f.prices[0].effectiveFrom) } });
    const before = await snapshot();
    await expect(seed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    expect(await snapshot()).toBe(before);
  });

  it("rolls back every inserted row after a forced failure partway through persistence", async () => {
    const original = PricingService.prototype.findEffectivePrice;
    let calls = 0;
    jest.spyOn(PricingService.prototype, "findEffectivePrice").mockImplementation(function (this: PricingService, ...args) {
      if (++calls === 3) throw new Error("deliberate test-only failure");
      return original.apply(this, args);
    });
    await expect(seed()).rejects.toThrow("deliberate test-only failure");
    expect(await db.user.count()).toBe(0);
    expect(await db.trace.count()).toBe(0);
    expect(await db.modelPrice.count()).toBe(0);
    expect(await db.evaluationSeedReceipt.count()).toBe(0);
  });

  it("refuses a concurrent seed lock without partially inserting data", async () => {
    await db.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(707070, 70) AS acquired`;
      expect(lock.acquired).toBe(true);
      await expect(seed()).rejects.toMatchObject({ code: "SEED_BUSY" });
    });
    expect(await db.user.count()).toBe(0);
    expect(await db.evaluationSeedReceipt.count()).toBe(0);
    expect((await seed()).outcome).toBe("inserted");
  });

  it.each(["changed", "archived", "deleted", "soft-deleted", "added"])("does not restore a %s dataset", async scenario => {
    await seed();
    if (scenario === "changed") await db.user.update({ where: { id: f.users[0].id }, data: { displayName: "Changed" } });
    if (scenario === "archived") await db.project.update({ where: { id: golden }, data: { archivedAt: new Date() } });
    if (scenario === "deleted") await db.membership.delete({ where: { id: f.memberships[0].id } });
    if (scenario === "soft-deleted") await db.trace.update({ where: { id: f.traces[0].id }, data: { deletedAt: new Date(), version: 2 } });
    if (scenario === "added") await db.project.create({ data: { name: "New demo project", slug: "new-demo", organizationId: org } });
    const before = await snapshot();
    await expect(seed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    expect(await snapshot()).toBe(before);
  });

  it("detects complete fixture removal because the independent receipt survives", async () => {
    await seed();
    const receipt = await db.evaluationSeedReceipt.findUniqueOrThrow({ where: { id: DATASET_ID } });
    await resetTestDatabase(db);
    await db.evaluationSeedReceipt.create({ data: receipt });
    await expect(seed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    expect(await db.user.count()).toBe(0);
  });

  it("rejects changed anchor/password and checks the actual connected database", async () => {
    await seed();
    const before = await snapshot();
    await expect(seedEvaluation(db, { ...config, anchor: "2026-10-02" }, loadSeedFixtures("2026-10-02"))).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    await expect(seedEvaluation(db, { ...config, password: randomBytes(24).toString("hex") }, f)).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    await expect(seedEvaluation(db, { ...config, database: "not_the_connected_database" }, f)).rejects.toThrow("Connected database");
    expect(await snapshot()).toBe(before);
  });

  it("seeds a shifted baseline into a fresh database", async () => {
    const shifted = loadSeedFixtures("2026-10-02");
    await seedEvaluation(db, { ...config, anchor: shifted.anchor }, shifted);
    const result = await request(app.getHttpServer()).get(`${base}/${golden}/analytics`)
      .set("Authorization", await login()).query(shifted.range).expect(200);
    expect(result.body.summary).toEqual(f.expected.baseline);
    expect((await db.modelPrice.findUniqueOrThrow({ where: { id: f.prices[1].id } })).effectiveFrom.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it.each(["live", "correction", "delete"] as const)("verifies independent %s mutation through the public API", async scenario => {
    await seed();
    const authorization = await login();
    const keyResult = await request(app.getHttpServer()).post(`${base}/${golden}/api-keys`)
      .set("Authorization", authorization).send({ name: "Ephemeral integration key" }).expect(201);
    const key = keyResult.body.key;
    const tracePath = `/api/v1/public/traces/${f.traces[0].id}`;
    if (scenario === "live") await request(app.getHttpServer()).post("/api/v1/public/traces")
      .set("X-API-Key", key).send(f.requests.live).expect(201);
    if (scenario === "correction") await request(app.getHttpServer()).put(tracePath)
      .set("X-API-Key", key).set("If-Match", '"1"').send(f.requests.correction).expect(200);
    if (scenario === "delete") await request(app.getHttpServer()).delete(tracePath)
      .set("X-API-Key", key).set("If-Match", '"1"').expect(204);
    const result = await request(app.getHttpServer()).get(`${base}/${golden}/analytics`)
      .set("Authorization", authorization).query(f.range).expect(200);
    const name = scenario === "live" ? "after_live_insert" : scenario === "correction" ? "after_T1_correction_from_baseline" : "after_T1_delete_from_baseline";
    expect(result.body.summary).toEqual(f.expected[name]);
    await expect(seed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
  });
});
