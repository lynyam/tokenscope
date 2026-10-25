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
import { loadSeedFixtures, readFixture } from "../../src/evaluation/seed-fixtures";
import { seedEvaluation, seedEvaluationWithAnalytics } from "../../src/evaluation/seed-evaluation";
import { buildAnalyticsDemo, ANALYTICS_PROJECT_ID } from "../../src/evaluation/analytics-demo";
import { demoExpectations } from "../evaluation/analytics-demo-oracle";
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

  describe("rich analytics dataset and additive 1.2 upgrade", () => {
    const demoNow = new Date("2026-10-24T18:30:00.000Z");
    const demo = buildAnalyticsDemo(org, "2026-10-24T18:00:00.000Z", demoNow);
    const richSeed = (at = demoNow) => seedEvaluationWithAnalytics(db, config, f, at);
    const expected = readFixture("analytics-demo/expected-results.json") as ReturnType<typeof demoExpectations>;
    const analyticsUrl = base + "/" + ANALYTICS_PROJECT_ID + "/analytics";
    const legacyState = async () => {
      const state = JSON.parse(await snapshot());
      delete state.receipts;
      state.projects = state.projects.filter((row: { id: string }) => row.id !== ANALYTICS_PROJECT_ID);
      state.prices = state.prices.filter((row: { id: string }) => !demo.prices.some(price => price.id === row.id));
      state.traces = state.traces.filter((row: { projectId: string }) => row.projectId !== ANALYTICS_PROJECT_ID);
      return JSON.stringify(state);
    };

    it("fresh-seeds 899 traces atomically and exposes exact dashboard analytics and tenant boundaries", async () => {
      const summary = await richSeed();
      expect(summary).toMatchObject({ outcome: "inserted", fixtureVersion: "1.3",
        counts: { projects: 6, modelPrices: 15, traces: 899 }, analyticsDemo: { range: demo.range } });
      expect(await Promise.all([db.project.count(), db.modelPrice.count(), db.trace.count(), db.evaluationSeedReceipt.count()]))
        .toEqual([6, 15, 899, 1]);
      const authorization = await login();
      const result = await request(app.getHttpServer()).get(analyticsUrl)
        .set("Authorization", authorization).query(demo.range).expect(200);
      expect(result.body.summary).toEqual(expected.baseline);
      expect(result.body.byModel).toHaveLength(12);
      for (const row of result.body.byModel) {
        const totals = expected.byModel[row.provider + "/" + row.model];
        expect(row).toMatchObject({ traceCount: totals.traceCount, inputTokens: totals.inputTokens,
          outputTokens: totals.outputTokens, estimatedCostUsd: totals.estimatedCostUsd });
      }
      // Frozen golden fixtures still give exactly the original totals in the enriched DB.
      const goldenResult = await request(app.getHttpServer()).get(base + "/" + golden + "/analytics")
        .set("Authorization", authorization).query(f.range).expect(200);
      expect(goldenResult.body.summary).toEqual(f.expected.baseline);
      await request(app.getHttpServer()).get(analyticsUrl)
        .set("Authorization", await login(3)).query(demo.range).expect(404);
      const stored = await db.trace.findMany({ where: { projectId: ANALYTICS_PROJECT_ID }, orderBy: { id: "asc" } });
      for (const [index, row] of stored.entries()) {
        expect(row.payloadHash).toBe(hashTracePayload(demo.traces[index].body));
        expect(row).toMatchObject({ version: 1, deletedAt: null });
      }
    });

    it("verifies provider/model/workflow/status filters, daily variation, quiet buckets and pagination", async () => {
      await richSeed();
      const authorization = await login();
      for (const [key, group] of [["provider", expected.byProvider], ["workflow", expected.byWorkflow]] as const) {
        for (const [value, summary] of Object.entries(group)) {
          const result = await request(app.getHttpServer()).get(analyticsUrl)
            .set("Authorization", authorization).query({ ...demo.range, [key]: value }).expect(200);
          expect(result.body.summary).toEqual(summary);
        }
      }
      const model = await request(app.getHttpServer()).get(analyticsUrl)
        .set("Authorization", authorization).query({ ...demo.range, provider: "demo-boreal", model: "boreal-pro" }).expect(200);
      expect(model.body.summary).toEqual(expected.byModel["demo-boreal/boreal-pro"]);
      const errors = await request(app.getHttpServer()).get(analyticsUrl)
        .set("Authorization", authorization).query({ ...demo.range, status: "ERROR" }).expect(200);
      expect(errors.body.summary).toMatchObject({ traceCount: 49, errorCount: 49, errorRatePct: 100 });
      const start = Date.parse(demo.range.from);
      for (let day = 0; day < 7; day++) {
        const result = await request(app.getHttpServer()).get(analyticsUrl)
          .set("Authorization", authorization).query({
            from: new Date(start + day * 86_400_000).toISOString(),
            to: new Date(start + (day + 1) * 86_400_000).toISOString(),
          }).expect(200);
        expect(result.body.summary).toEqual(expected.byRollingDay[String(day + 1)]);
        expect(result.body.series.some((row: { traceCount: number }) => row.traceCount === 0)).toBe(true);
      }
      const ids: string[] = [];
      for (let page = 1; page <= 9; page++) {
        const result = await request(app.getHttpServer()).get(base + "/" + ANALYTICS_PROJECT_ID + "/traces")
          .set("Authorization", authorization).query({ ...demo.range, pageSize: 100, page }).expect(200);
        expect(result.body.items).toHaveLength(page === 9 ? 40 : 100);
        ids.push(...result.body.items.map((row: { id: string }) => row.id));
      }
      expect(new Set(ids).size).toBe(840);
    });

    it("uses all twelve models and synthetic-price disclosure in the real assistant context without live quota", async () => {
      await richSeed();
      provider.script = [delta("The report-generation spike is synthetic."), done()];
      await request(app.getHttpServer()).post(base + "/" + ANALYTICS_PROJECT_ID + "/assistant")
        .set("Authorization", await login())
        .send({ question: "Which models contribute most to cost?", ...demo.range, filters: {} }).expect(200);
      expect(provider.lastContext?.summary).toEqual(expected.baseline);
      expect(provider.lastContext?.project.description).toBe(demo.project.description);
      expect(provider.lastContext?.pricing.containsSyntheticPricing).toBe(true);
      expect(provider.calls).toBe(1);
    });

    it("upgrades an unchanged 1.2 receipt without modifying any existing entity, hash, date or price", async () => {
      await seed();
      const before = await legacyState();
      const receipt = await db.evaluationSeedReceipt.findUniqueOrThrow({ where: { id: DATASET_ID } });
      expect(receipt.analyticsWindowEnd).toBeNull();
      expect((await richSeed()).outcome).toBe("upgraded");
      expect(await legacyState()).toBe(before);
      const upgraded = await db.evaluationSeedReceipt.findUniqueOrThrow({ where: { id: DATASET_ID } });
      expect(upgraded.createdAt).toEqual(receipt.createdAt);
      expect(upgraded.analyticsWindowEnd?.toISOString()).toBe(demo.range.to);
      expect(upgraded.anchor).toBe(receipt.anchor);
      expect(upgraded.fixtureVersion).toBe("1.3");
    });

    it("reuses the installed clock and changes absolutely nothing on a rerun several days later", async () => {
      await richSeed();
      const before = await snapshot();
      const later = await richSeed(new Date("2026-11-02T23:59:00.000Z"));
      expect(later).toMatchObject({ outcome: "already-present", analyticsDemo: { range: demo.range } });
      expect(await snapshot()).toBe(before);
    });

    it.each(["fresh", "upgrade"])("rolls back an analytics insertion failure during %s", async scenario => {
      if (scenario === "upgrade") await seed();
      const before = await snapshot();
      const original = PricingService.prototype.findEffectivePrice;
      jest.spyOn(PricingService.prototype, "findEffectivePrice").mockImplementation(function (this: PricingService, ...args) {
        if (args[1] === "demo-boreal") throw new Error("deliberate analytics failure");
        return original.apply(this, args);
      });
      await expect(richSeed()).rejects.toThrow("deliberate analytics failure");
      expect(await snapshot()).toBe(before);
    });

    it.each(["legacy-trace", "legacy-account", "added-project", "new-price", "new-id"])(
      "refuses an unsafe upgrade: %s", async scenario => {
        await seed();
        if (scenario === "legacy-trace") await db.trace.update({ where: { id: f.traces[0].id }, data: { version: 2 } });
        if (scenario === "legacy-account") await db.user.update({ where: { id: f.users[0].id }, data: { displayName: "Changed" } });
        if (scenario === "added-project") await db.project.create({ data: { organizationId: org, name: "Extra", slug: "extra" } });
        if (scenario === "new-price") await db.modelPrice.create({ data: {
          ...demo.prices[0], id: randomUUID(), effectiveFrom: new Date(demo.range.from),
        } });
        if (scenario === "new-id") await db.project.create({ data: {
          id: ANALYTICS_PROJECT_ID, organizationId: f.organizations[1].id, name: "Existing", slug: "other",
        } });
        const before = await snapshot();
        await expect(richSeed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
        expect(await snapshot()).toBe(before);
      });

    it.each(["changed", "soft-deleted", "deleted-project", "new-trace", "receipt-window"])(
      "does not repair a modified enriched seed: %s", async scenario => {
        await richSeed();
        if (scenario === "changed") await db.trace.update({ where: { id: demo.traces[0].id }, data: { inputTokens: 1 } });
        if (scenario === "soft-deleted") await db.trace.update({ where: { id: demo.traces[0].id }, data: { deletedAt: new Date(), version: 2 } });
        if (scenario === "deleted-project") {
          await db.trace.deleteMany({ where: { projectId: ANALYTICS_PROJECT_ID } });
          await db.project.delete({ where: { id: ANALYTICS_PROJECT_ID } });
        }
        if (scenario === "new-trace") {
          const row = await db.trace.findUniqueOrThrow({ where: { id: demo.traces[0].id } });
          await db.trace.create({ data: { ...row, metadata: row.metadata!, id: randomUUID(), externalId: "added-after-seed" } });
        }
        if (scenario === "receipt-window") await db.evaluationSeedReceipt.update({
          where: { id: DATASET_ID }, data: { analyticsWindowEnd: null },
        });
        const before = await snapshot();
        await expect(richSeed()).rejects.toMatchObject({ code: "SEED_CONFLICT" });
        expect(await snapshot()).toBe(before);
      });

    it("preserves unrelated data and rejects password/anchor changes during upgrade and subsequent reruns", async () => {
      await seed();
      const unrelated = await db.user.create({ data: {
        email: "rich-unrelated@control.test", displayName: "Control", passwordHash: "not-a-login",
      } });
      for (const upgraded of [false, true]) {
        if (upgraded) await richSeed();
        const before = await snapshot();
        await expect(seedEvaluationWithAnalytics(db, { ...config, password: randomBytes(24).toString("hex") }, f, demoNow))
          .rejects.toMatchObject({ code: "SEED_CONFLICT" });
        await expect(seedEvaluationWithAnalytics(db, { ...config, anchor: "2026-10-02" }, loadSeedFixtures("2026-10-02"), demoNow))
          .rejects.toMatchObject({ code: "SEED_CONFLICT" });
        expect(await snapshot()).toBe(before);
      }
      expect(await db.user.findUnique({ where: { id: unrelated.id } })).toEqual(unrelated);
    });
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
