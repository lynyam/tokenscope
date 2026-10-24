import { createHash } from "node:crypto";
import { hashPassword, verifyPassword } from "../auth/password";
import { PrismaService } from "../database/prisma.service";
import { runSerializable } from "../database/run-serializable";
import { Prisma } from "../generated/prisma/client";
import { calculateTraceCost } from "../pricing/calculate-trace-cost";
import { MAX_CATALOGUE_ROWS } from "../pricing/price-catalogue";
import { PricingService } from "../pricing/pricing.service";
import { hashTracePayload } from "../traces/trace-payload";
import { DATASET_ID, requireSeed, SeedError, type SeedConfig } from "./seed-config";
import { stableJson, type SeedFixtures } from "./seed-fixtures";

function conflict(reason: string): never {
  throw new SeedError("SEED_CONFLICT", `${reason} Nothing was overwritten. Use a fresh disposable database to restore the baseline; do not reset a shared database.`);
}

/** Include related additions, soft-deleted rows and unique-key collisions. */
async function readState(tx: Prisma.TransactionClient, f: SeedFixtures) {
  const users = f.users.map(row => row.id);
  const organizations = f.organizations.map(row => row.id);
  const projects = f.projects.map(row => row.id);
  return {
    users: await tx.user.findMany({
      where: { OR: [{ id: { in: users } }, { email: { in: f.users.map(row => row.email) } }] }, orderBy: { id: "asc" },
    }),
    organizations: await tx.organization.findMany({
      where: { OR: [{ id: { in: organizations } }, { slug: { in: f.organizations.map(row => row.slug) } }] }, orderBy: { id: "asc" },
    }),
    memberships: await tx.membership.findMany({
      where: { OR: [{ id: { in: f.memberships.map(row => row.id) } }, { userId: { in: users } }, { organizationId: { in: organizations } }] }, orderBy: { id: "asc" },
    }),
    projects: await tx.project.findMany({
      where: { OR: [{ id: { in: projects } }, { organizationId: { in: organizations } }] }, orderBy: { id: "asc" },
    }),
    prices: await tx.modelPrice.findMany({
      where: { OR: [{ id: { in: f.prices.map(row => row.id) } }, ...f.prices.map(({ provider, model }) => ({ provider, model }))] }, orderBy: { id: "asc" },
    }),
    traces: await tx.trace.findMany({
      where: { OR: [{ id: { in: f.traces.map(row => row.id) } }, { projectId: { in: projects } }] }, orderBy: { id: "asc" },
    }),
  };
}

function stateFingerprint(state: Awaited<ReturnType<typeof readState>>): string {
  // Serialize Prisma Decimal and Date through their JSON representation first.
  // Includes stored password hashes and timestamps, but never prints them.
  return createHash("sha256").update(stableJson(JSON.parse(JSON.stringify(state)))).digest("hex");
}

export async function seedEvaluation(db: PrismaService, config: SeedConfig, f: SeedFixtures) {
  requireSeed(config.anchor === f.anchor, "Configuration and fixture anchors differ.");
  const pricing = new PricingService(db);
  return runSerializable(db, async tx => {
    const [target] = await tx.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    requireSeed(target?.name === config.database, "Connected database does not match --confirm-database.");
    // Do not wait on another seed with an already-established serializable snapshot.
    const [lock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(707070, 70) AS acquired`;
    if (!lock?.acquired) throw new SeedError("SEED_BUSY", "Another evaluation seed is running. Retry when it finishes.");

    const receipt = await tx.evaluationSeedReceipt.findUnique({ where: { id: DATASET_ID } });
    const before = await readState(tx, f);
    if (receipt) {
      if (receipt.anchor !== f.anchor || receipt.fixtureVersion !== f.version ||
          receipt.fixtureFingerprint !== f.fingerprint) conflict("Fixture version, content or anchor differs from the installed dataset.");
      if (stateFingerprint(before) !== receipt.stateFingerprint) conflict("Fixture records were changed, added, archived or deleted.");
      for (const user of before.users) {
        if (!await verifyPassword(user.passwordHash, config.password)) conflict("DEMO_PASSWORD does not match the existing demo accounts.");
      }
      return seedSummary(config, f, "already-present");
    }
    if (Object.values(before).some(rows => rows.length > 0)) {
      conflict("A reserved fixture ID, email, slug, membership or provider/model already exists without a matching seed receipt.");
    }
    requireSeed(await tx.modelPrice.count() + f.prices.length <= MAX_CATALOGUE_ROWS,
      "The complete price catalogue would exceed its existing limit.");

    const timestamp = new Date(f.range.from);
    // Hash only after collision checks; no hash is regenerated on unchanged reruns.
    for (const user of f.users) {
      await tx.user.create({ data: { ...user, passwordHash: await hashPassword(config.password), createdAt: timestamp, updatedAt: timestamp } });
    }
    await tx.organization.createMany({ data: f.organizations.map(row => ({ ...row, archivedAt: null, createdAt: timestamp, updatedAt: timestamp })) });
    await tx.membership.createMany({ data: f.memberships.map(row => ({ ...row, createdAt: timestamp, updatedAt: timestamp })) });
    await tx.project.createMany({ data: f.projects.map(row => ({ ...row, archivedAt: null, createdAt: timestamp, updatedAt: timestamp })) });
    await tx.modelPrice.createMany({ data: f.prices.map(row => ({ ...row, effectiveFrom: new Date(row.effectiveFrom), createdAt: timestamp })) });

    for (const trace of f.traces) {
      const price = await pricing.findEffectivePrice(tx, trace.body.provider, trace.body.model, new Date(trace.body.occurredAt));
      const costs = calculateTraceCost({ ...trace.body, ...price });
      const expected = f.expectedTraces.find(row => row.id === trace.id);
      if (expected) {
        requireSeed(price.id === expected.priceVersionId &&
          Object.entries(costs).every(([field, value]) => value.toFixed(12) === expected[field]),
        "Calculated golden costs differ from the independent expected results.");
      }
      await tx.trace.create({ data: {
        id: trace.id, projectId: trace.projectId, ...trace.body,
        occurredAt: new Date(trace.body.occurredAt),
        priceVersionId: price.id, inputUsdPerMillion: price.inputUsdPerMillion,
        outputUsdPerMillion: price.outputUsdPerMillion, ...costs,
        payloadHash: hashTracePayload(trace.body), version: 1, deletedAt: null,
        createdAt: timestamp, updatedAt: timestamp,
      } });
    }
    // Archive only after its trace exists, without deleting either record.
    for (const project of f.projects.filter(row => row.archivedAt !== null)) {
      await tx.project.update({ where: { id: project.id }, data: { archivedAt: new Date(project.archivedAt!), updatedAt: timestamp } });
    }
    await tx.evaluationSeedReceipt.create({ data: {
      id: DATASET_ID, fixtureVersion: f.version, anchor: f.anchor,
      fixtureFingerprint: f.fingerprint, stateFingerprint: stateFingerprint(await readState(tx, f)),
    } });
    return seedSummary(config, f, "inserted");
  });
}

export function seedSummary(config: Pick<SeedConfig, "database">, f: SeedFixtures, outcome: "inserted" | "already-present") {
  return {
    outcome, fixtureVersion: f.version, database: config.database, anchor: f.anchor,
    dashboardRange: f.range,
    counts: { users: 4, organizations: 2, memberships: 4, projects: 5, modelPrices: 3, traces: 59 },
    accounts: f.users.map(user => ({ email: user.email,
      memberships: f.memberships.filter(row => row.userId === user.id).map(row => ({
        organization: f.organizations.find(org => org.id === row.organizationId)!.name, role: row.role,
      })),
    })),
    note: "Synthetic evaluation prices, not provider quotes. Passwords and API keys are never printed.",
  };
}
