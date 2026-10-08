import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  PrismaClient,
} from "../../src/generated/prisma/client";

import {
  resetTestDatabase,
} from "../support/reset-test-database";

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL!,
  }),
});

const sql = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

const ids = {
  user: randomUUID(),
  org: randomUUID(),
  project: randomUUID(),
  other: randomUUID(),
  ApiKey: randomUUID(),
  ModelPrice: randomUUID(),
  Trace: randomUUID(),
  ProjectDocument: randomUUID(),
  FileDeletionJob: randomUUID(),
};

const digest = "a".repeat(64);

const priceData = () => ({
  id: ids.ModelPrice,
  provider: "fixture-a",
  model: "demo-fast",
  effectiveFrom: new Date("2026-09-01T00:00:00Z"),
  inputUsdPerMillion: "1.000000",
  outputUsdPerMillion: "4.000000",
  currency: "USD",
  isSynthetic: true,
});

const traceData = () => ({
  id: ids.Trace,
  projectId: ids.project,
  externalId: "schema-test",
  provider: "fixture-a",
  model: "demo-fast",
  workflow: "support",
  status: "SUCCESS" as const,
  inputTokens: 1000,
  outputTokens: 200,
  latencyMs: 1000,
  occurredAt: new Date("2026-10-01T10:00:00Z"),
  priceVersionId: ids.ModelPrice,
  inputUsdPerMillion: "1.000000",
  outputUsdPerMillion: "4.000000",
  inputCostUsd: "0.001000000000",
  outputCostUsd: "0.000800000000",
  estimatedCostUsd: "0.001800000000",
  payloadHash: digest,
});

describe("Evaluation schema with PostgreSQL", () => {
  beforeEach(async () => {
    await resetTestDatabase(prisma);

    await prisma.user.create({
      data: {
        id: ids.user,
        email: "schema@tests.invalid",
        displayName: "Schema",
        passwordHash: "test-only",
      },
    });

    await prisma.organization.create({
      data: {
        id: ids.org,
        name: "Schema",
        slug: "schema",
      },
    });

    await prisma.project.createMany({
      data: [ids.project, ids.other].map(id => ({
        id,
        organizationId: ids.org,
        name: id,
        slug: id,
      })),
    });

    await prisma.apiKey.create({
      data: {
        id: ids.ApiKey,
        projectId: ids.project,
        createdByUserId: ids.user,
        name: "Schema",
        keyHash: digest,
        keyPrefix: "tsk_fixture",
      },
    });

    await prisma.modelPrice.create({
      data: priceData(),
    });

    await prisma.trace.create({
      data: traceData(),
    });

    await prisma.projectDocument.create({
      data: {
        id: ids.ProjectDocument,
        projectId: ids.project,
        uploadedByUserId: ids.user,
        originalName: "sample.txt",
        storageKey: randomUUID(),
        mediaType: "text/plain",
        sizeBytes: 10,
        sha256: digest,
      },
    });

    await prisma.fileDeletionJob.create({
      data: {
        id: ids.FileDeletionJob,
        storageKey: randomUUID(),
        nextAttemptAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await sql.end();
  });

  it("creates every model and round-trips exact rates, costs and defaults", async () => {
    const trace = await prisma.trace.findUniqueOrThrow({
      where: { id: ids.Trace },
    });

    expect(trace.inputUsdPerMillion.toFixed(6)).toBe("1.000000");
    expect(trace.outputUsdPerMillion.toFixed(6)).toBe("4.000000");
    expect(trace.inputCostUsd.toFixed(12)).toBe("0.001000000000");
    expect(trace.outputCostUsd.toFixed(12)).toBe("0.000800000000");
    expect(trace.estimatedCostUsd.toFixed(12)).toBe("0.001800000000");

    expect(trace).toMatchObject({
      version: 1,
      metadata: {},
      deletedAt: null,
    });

    expect(
      await prisma.organization.findUniqueOrThrow({
        where: { id: ids.org },
      }),
    ).toMatchObject({
      archivedAt: null,
    });

    expect(
      await prisma.fileDeletionJob.findUniqueOrThrow({
        where: { id: ids.FileDeletionJob },
      }),
    ).toMatchObject({
      attempts: 0,
      lastErrorCode: null,
    });
  });

  it("enforces all declared unique keys", async () => {
    const key = await prisma.apiKey.findUniqueOrThrow({
      where: { id: ids.ApiKey },
    });

    await expect(
      prisma.apiKey.create({
        data: { ...key, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.modelPrice.create({
        data: { ...priceData(), id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const document = await prisma.projectDocument.findUniqueOrThrow({
      where: { id: ids.ProjectDocument },
    });

    await expect(
      prisma.projectDocument.create({
        data: { ...document, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const job = await prisma.fileDeletionJob.findUniqueOrThrow({
      where: { id: ids.FileDeletionJob },
    });

    await expect(
      prisma.fileDeletionJob.create({
        data: { ...job, id: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("reserves external IDs after deletion, but scopes uniqueness to a project", async () => {
    const duplicate = {
      ...traceData(),
      id: randomUUID(),
    };

    await expect(
      prisma.trace.create({ data: duplicate }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.trace.update({
      where: { id: ids.Trace },
      data: { deletedAt: new Date() },
    });

    await expect(
      prisma.trace.create({ data: duplicate }),
    ).rejects.toMatchObject({ code: "P2002" });

    await expect(
      prisma.trace.create({
        data: {
          ...duplicate,
          projectId: ids.other,
        },
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ["ApiKey", "projectId"],
    ["ApiKey", "createdByUserId"],
    ["Trace", "projectId"],
    ["Trace", "priceVersionId"],
    ["ProjectDocument", "projectId"],
    ["ProjectDocument", "uploadedByUserId"],
  ] as const)(
    "enforces %s.%s foreign key",
    async (table, column) => {
      // Identifiers come only from this fixed test allowlist.
      // Values remain parameterized.
      await expect(
        sql.query(
          `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`,
          [randomUUID(), ids[table]],
        ),
      ).rejects.toMatchObject({
        code: "23503",
        constraint: `${table}_${column}_fkey`,
      });
    },
  );

  it.each([
    ["Project", ids.project],
    ["User", ids.user],
    ["ModelPrice", ids.ModelPrice],
  ])(
    "restricts deletion of referenced %s",
    async (table, id) => {
      await expect(
        sql.query(
          `DELETE FROM "${table}" WHERE id = $1`,
          [id],
        ),
      ).rejects.toMatchObject({
        code: "23503",
      });
    },
  );

  const invalid: Array<
    [keyof typeof ids, string, unknown, string]
  > = [
    ["Trace", "inputTokens", -1, "Trace_input_tokens_check"],
    ["Trace", "inputTokens", 1000000001, "Trace_input_tokens_check"],
    ["Trace", "outputTokens", -1, "Trace_output_tokens_check"],
    ["Trace", "outputTokens", 1000000001, "Trace_output_tokens_check"],
    ["Trace", "latencyMs", -1, "Trace_latency_check"],
    ["Trace", "latencyMs", 86400001, "Trace_latency_check"],
    ["Trace", "version", 0, "Trace_version_check"],
    ["Trace", "metadata", "[]", "Trace_metadata_check"],
    ["Trace", "metadata", "null", "Trace_metadata_check"],
    ["Trace", "payloadHash", "bad", "Trace_payloadHash_check"],
    ["ApiKey", "keyHash", "bad", "ApiKey_keyHash_check"],
    ["ModelPrice", "currency", "EUR", "ModelPrice_currency_check"],
    ["ProjectDocument", "sizeBytes", 0, "ProjectDocument_size_check"],
    ["ProjectDocument", "sizeBytes", 10485761, "ProjectDocument_size_check"],
    ["ProjectDocument", "mediaType", "text/html", "ProjectDocument_media_type_check"],
    ["ProjectDocument", "originalName", "é".repeat(128), "ProjectDocument_name_bytes_check"],
    ["ProjectDocument", "sha256", "bad", "ProjectDocument_sha256_check"],
    ["FileDeletionJob", "attempts", -1, "FileDeletionJob_attempts_check"],
  ];

  for (const table of ["ModelPrice", "Trace"] as const) {
    for (const direction of ["input", "output"] as const) {
      for (const value of [
        "-0.000001",
        "1000000.000000",
        "NaN",
      ]) {
        invalid.push([
          table,
          `${direction}UsdPerMillion`,
          value,
          `${table}_${direction}_rate_check`,
        ]);
      }
    }
  }

  for (const [column, constraint] of [
    ["inputCostUsd", "Trace_input_cost_check"],
    ["outputCostUsd", "Trace_output_cost_check"],
    ["estimatedCostUsd", "Trace_total_cost_check"],
  ]) {
    for (const value of ["-0.000000000001", "NaN"]) {
      invalid.push([
        "Trace",
        column,
        value,
        constraint,
      ]);
    }
  }

  it.each(invalid)(
    "rejects invalid %s.%s = %s",
    async (table, column, value, constraint) => {
      await expect(
        sql.query(
          `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`,
          [value, ids[table]],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint,
      });
    },
  );

  it("rejects an unknown trace status and overlong identifiers", async () => {
    await expect(
      sql.query(
        'UPDATE "Trace" SET status = $1 WHERE id = $2',
        ["UNKNOWN", ids.Trace],
      ),
    ).rejects.toMatchObject({
      code: "22P02",
    });

    await expect(
      sql.query(
        'UPDATE "Trace" SET "externalId" = $1 WHERE id = $2',
        ["x".repeat(129), ids.Trace],
      ),
    ).rejects.toMatchObject({
      code: "22001",
    });
  });

  it("accepts zero counters/rates/costs and exact upper bounds", async () => {
    await prisma.trace.update({
      where: { id: ids.Trace },
      data: {
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        inputUsdPerMillion: "0",
        outputUsdPerMillion: "0",
        inputCostUsd: "0",
        outputCostUsd: "0",
        estimatedCostUsd: "0",
      },
    });

    await prisma.modelPrice.update({
      where: { id: ids.ModelPrice },
      data: {
        inputUsdPerMillion: "0",
        outputUsdPerMillion: "0",
      },
    });

    await prisma.trace.update({
      where: { id: ids.Trace },
      data: {
        inputTokens: 1000000000,
        outputTokens: 1000000000,
        latencyMs: 86400000,
        inputUsdPerMillion: "999999.999999",
        outputUsdPerMillion: "999999.999999",
      },
    });

    await prisma.modelPrice.update({
      where: { id: ids.ModelPrice },
      data: {
        inputUsdPerMillion: "999999.999999",
        outputUsdPerMillion: "999999.999999",
      },
    });

    await prisma.projectDocument.update({
      where: { id: ids.ProjectDocument },
      data: {
        sizeBytes: 10485760,
        originalName: "é".repeat(127) + "a",
      },
    });
  });

  it("retains a cleanup job after the document metadata is deleted", async () => {
    const document = await prisma.projectDocument.findUniqueOrThrow({
      where: { id: ids.ProjectDocument },
    });

    await prisma.$transaction(async tx => {
      await tx.projectDocument.delete({
        where: { id: document.id },
      });

      await tx.fileDeletionJob.create({
        data: {
          storageKey: document.storageKey,
          nextAttemptAt: new Date(),
        },
      });
    });

    expect(
      await prisma.projectDocument.findUnique({
        where: { id: document.id },
      }),
    ).toBeNull();

    expect(
      await prisma.fileDeletionJob.findUnique({
        where: { storageKey: document.storageKey },
      }),
    ).not.toBeNull();
  });

  it("parent archive retains projects, keys, traces and document metadata", async () => {
    await prisma.organization.update({
      where: { id: ids.org },
      data: { archivedAt: new Date() },
    });

    expect(await prisma.project.count()).toBe(2);
    expect(await prisma.apiKey.count()).toBe(1);
    expect(await prisma.trace.count()).toBe(1);
    expect(await prisma.projectDocument.count()).toBe(1);

    expect(
      await prisma.project.findUniqueOrThrow({
        where: { id: ids.project },
      }),
    ).toMatchObject({
      archivedAt: null,
    });
  });
});
