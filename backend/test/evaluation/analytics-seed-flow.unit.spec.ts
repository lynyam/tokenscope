import "reflect-metadata";
import { Prisma } from "../../src/generated/prisma/client";
import type { PrismaService } from "../../src/database/prisma.service";
import * as passwords from "../../src/auth/password";
import { DATASET_ID, DEFAULT_ANCHOR, type SeedConfig } from "../../src/evaluation/seed-config";
import { loadSeedFixtures, stableJson } from "../../src/evaluation/seed-fixtures";
import { seedEvaluation, seedEvaluationWithAnalytics } from "../../src/evaluation/seed-evaluation";
import { ANALYTICS_PROJECT_ID } from "../../src/evaluation/analytics-demo";

// A deliberately narrow repository double for exercising real orchestration.
// It is NOT evidence for PostgreSQL isolation, migrations or constraint behavior;
// those are covered by the real database suite.
function repositoryDouble() {
  type Row = Record<string, any>;
  const names = ["user", "organization", "membership", "project", "modelPrice", "trace", "evaluationSeedReceipt"] as const;
  type Name = typeof names[number];
  let rows: Record<Name, Row[]> = {
    user: [], organization: [], membership: [], project: [], modelPrice: [], trace: [], evaluationSeedReceipt: [],
  };
  const clone = (value: any): any => value instanceof Date ? new Date(value) :
    value instanceof Prisma.Decimal ? new Prisma.Decimal(value) :
    Array.isArray(value) ? value.map(clone) : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((condition: Row) => matches(row, condition));
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if ("in" in value) return value.in.includes(row[key]);
        if ("lte" in value) return row[key] <= value.lte;
        throw new Error("Unsupported repository-double predicate");
      }
      return row[key] === value;
    });
  }
  const controls = { lock: true, failedBatch: 0, batches: [] as number[] };
  const tx: any = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) =>
      parts.join("").includes("current_database") ? [{ name: "tokenscope" }] : [{ acquired: controls.lock }]),
  };
  for (const name of names) {
    const find = (args: Row = {}) => {
      let found = rows[name].filter(row => matches(row, args.where));
      if (args.orderBy) {
        const [field, order] = Object.entries(args.orderBy)[0];
        found = [...found].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (order === "desc" ? -1 : 1));
      }
      return clone(found);
    };
    const create = (data: Row) => {
      const row = clone(data);
      if (name === "modelPrice") {
        row.inputUsdPerMillion = new Prisma.Decimal(row.inputUsdPerMillion);
        row.outputUsdPerMillion = new Prisma.Decimal(row.outputUsdPerMillion);
      }
      if (name === "evaluationSeedReceipt") row.createdAt ??= new Date("2026-10-24T18:30:00.000Z");
      if (rows[name].some(existing => existing.id === row.id)) throw new Error("Duplicate unit-test ID");
      rows[name].push(row);
      return clone(row);
    };
    tx[name] = {
      findMany: jest.fn(async (args?: Row) => find(args)),
      findUnique: jest.fn(async (args: Row) => find(args)[0] ?? null),
      findFirst: jest.fn(async (args: Row) => find(args)[0] ?? null),
      count: jest.fn(async () => rows[name].length),
      create: jest.fn(async ({ data }: Row) => create(data)),
      createMany: jest.fn(async ({ data }: Row) => {
        if (name === "trace") {
          controls.batches.push(data.length);
          if (controls.failedBatch === controls.batches.length) throw new Error("simulated batch failure");
        }
        for (const row of data) create(row);
        return { count: data.length };
      }),
      update: jest.fn(async ({ where, data }: Row) => {
        const row = rows[name].find(candidate => matches(candidate, where));
        if (!row) throw new Error("Missing unit-test update target");
        Object.assign(row, clone(data));
        return clone(row);
      }),
    };
  }
  const transaction = jest.fn(async (work: (client: Prisma.TransactionClient) => Promise<unknown>) => {
    const before = clone(rows);
    try { return await work(tx); }
    catch (error) { rows = before; throw error; }
  });
  return {
    db: { $transaction: transaction } as unknown as PrismaService, tx, transaction, controls,
    snapshot: () => stableJson(rows),
    rows: (name: Name) => rows[name],
  };
}

const now = new Date("2026-10-24T18:30:00.000Z");
const f = loadSeedFixtures(DEFAULT_ANCHOR);
const config: SeedConfig = {
  database: "tokenscope", databaseUrl: "unused-by-the-unit-double",
  password: "unit-test-only", anchor: DEFAULT_ANCHOR,
};

describe("rich seed transaction orchestration with a repository double", () => {
  beforeEach(() => {
    jest.spyOn(passwords, "hashPassword").mockResolvedValue("unit-hash");
    jest.spyOn(passwords, "verifyPassword").mockResolvedValue(true);
  });
  afterEach(() => jest.restoreAllMocks());

  it("inserts both datasets in one transaction and batches only the 840 new traces", async () => {
    const r = repositoryDouble();
    const result = await seedEvaluationWithAnalytics(r.db, config, f, now);
    expect(result).toMatchObject({ outcome: "inserted", counts: { traces: 899, modelPrices: 15, projects: 6 } });
    expect(r.transaction).toHaveBeenCalledTimes(1);
    expect(r.transaction.mock.calls[0]).toHaveLength(2);
    expect(r.controls.batches).toEqual([250, 250, 250, 90]);
    expect(r.tx.modelPrice.findFirst).toHaveBeenCalledTimes(59 + 12);
    expect(r.rows("trace")).toHaveLength(899);
    expect(r.rows("evaluationSeedReceipt")[0]).toMatchObject({
      id: DATASET_ID, fixtureVersion: "1.3", analyticsWindowEnd: new Date("2026-10-24T18:00:00.000Z"),
    });
  });

  it("upgrades the real legacy fingerprint, then remains byte-for-byte unchanged on a later rerun", async () => {
    const r = repositoryDouble();
    await seedEvaluation(r.db, config, f);
    const users = stableJson(r.rows("user"));
    const originalTrace = stableJson(r.rows("trace")[0]);
    const receiptCreatedAt = r.rows("evaluationSeedReceipt")[0].createdAt;
    expect((await seedEvaluationWithAnalytics(r.db, config, f, now)).outcome).toBe("upgraded");
    expect(stableJson(r.rows("user"))).toBe(users);
    expect(stableJson(r.rows("trace")[0])).toBe(originalTrace);
    expect(r.rows("evaluationSeedReceipt")[0].createdAt).toEqual(receiptCreatedAt);
    expect(passwords.hashPassword).toHaveBeenCalledTimes(4);
    const before = r.snapshot();
    const result = await seedEvaluationWithAnalytics(r.db, config, f, new Date("2026-11-24T01:00:00.000Z"));
    expect(result).toMatchObject({ outcome: "already-present",
      analyticsDemo: { range: { to: "2026-10-24T18:00:00.000Z" } } });
    expect(r.snapshot()).toBe(before);
    expect(r.controls.batches).toEqual([250, 250, 250, 90]);
  });

  it.each(["fresh", "upgrade"])("propagates a middle-batch failure inside the single %s transaction", async scenario => {
    const r = repositoryDouble();
    if (scenario === "upgrade") await seedEvaluation(r.db, config, f);
    const before = r.snapshot();
    r.controls.failedBatch = 2;
    await expect(seedEvaluationWithAnalytics(r.db, config, f, now)).rejects.toThrow("simulated batch failure");
    expect(r.snapshot()).toBe(before);
    expect(r.tx.evaluationSeedReceipt.update).not.toHaveBeenCalled();
  });

  it.each(["legacy", "analytics", "price-collision", "deleted-demo", "version"])("refuses unsafe state: %s", async scenario => {
    const r = repositoryDouble();
    await seedEvaluation(r.db, config, f);
    if (scenario === "legacy") r.rows("trace")[0].version = 2;
    if (scenario === "price-collision") r.rows("modelPrice").push({
      id: "pre-existing", provider: "demo-aurora", model: "aurora-mini", effectiveFrom: new Date(0),
    });
    if (scenario === "version") r.rows("evaluationSeedReceipt")[0].fixtureVersion = "unknown";
    if (scenario === "analytics" || scenario === "deleted-demo") {
      await seedEvaluationWithAnalytics(r.db, config, f, now);
      if (scenario === "analytics") r.rows("trace").find(row => row.projectId === ANALYTICS_PROJECT_ID)!.inputTokens++;
      else r.rows("project").splice(r.rows("project").findIndex(row => row.id === ANALYTICS_PROJECT_ID), 1);
    }
    const before = r.snapshot();
    await expect(seedEvaluationWithAnalytics(r.db, config, f, now)).rejects.toMatchObject({ code: "SEED_CONFLICT" });
    expect(r.snapshot()).toBe(before);
  });

  it("rejects a busy lock before hashing or inserting anything", async () => {
    const r = repositoryDouble();
    r.controls.lock = false;
    await expect(seedEvaluationWithAnalytics(r.db, config, f, now)).rejects.toMatchObject({ code: "SEED_BUSY" });
    expect(passwords.hashPassword).not.toHaveBeenCalled();
    expect(r.rows("trace")).toHaveLength(0);
  });
});
