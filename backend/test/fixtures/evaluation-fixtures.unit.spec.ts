import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type GoldenInput = {
  expectedSeedId: string;
  projectId: string;
  body: {
    provider: string;
    model: string;
    occurredAt: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    status: string;
  };
};

type Price = {
  id: string;
  provider: string;
  model: string;
  effectiveFrom: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  isSynthetic: boolean;
};

type CostRow = {
  estimatedCostUsd: string;
};

type Analytics = {
  projectId: string;
  summary: unknown;
  series: CostRow[];
  byModel: CostRow[];
};

const root = resolve(
  __dirname,
  "../../../fixtures/evaluation",
);

const read = (name: string) =>
  JSON.parse(
    readFileSync(resolve(root, name), "utf8"),
  );

// Independent integer arithmetic:
// tokens × millionth-USD rate = trillionth-USD cost.
const cost = (tokens: number, rate: string) =>
  BigInt(tokens) * BigInt(rate.replace(".", ""));

const money = (value: bigint) =>
  `${value / 1000000000000n}.${
    (value % 1000000000000n)
      .toString()
      .padStart(12, "0")
  }`;

describe("Canonical evaluation fixtures", () => {
  it("preserves historical price selection and golden arithmetic", () => {
    const inputs: GoldenInput[] = read("traces-golden.json");
    const prices: Price[] = read("model-prices.json");

    const responses: Array<{ id: string }> =
      read("responses/traces-golden.json");

    const analytics: Analytics =
      read("responses/analytics-golden.json");

    let total = 0n;

    expect(inputs).toHaveLength(6);

    for (const input of inputs) {
      const trace = input.body;

      const price = prices
        .filter(
          candidate =>
            candidate.provider === trace.provider &&
            candidate.model === trace.model &&
            candidate.effectiveFrom <= trace.occurredAt,
        )
        .sort(
          (a, b) =>
            b.effectiveFrom.localeCompare(a.effectiveFrom),
        )[0];

      expect(price.isSynthetic).toBe(true);

      const inputCost = cost(
        trace.inputTokens,
        price.inputUsdPerMillion,
      );

      const outputCost = cost(
        trace.outputTokens,
        price.outputUsdPerMillion,
      );

      const result = responses.find(
        response => response.id === input.expectedSeedId,
      );

      expect(result).toMatchObject({
        ...trace,
        projectId: input.projectId,
        priceVersionId: price.id,
        inputCostUsd: money(inputCost),
        outputCostUsd: money(outputCost),
        estimatedCostUsd: money(inputCost + outputCost),
      });

      total += inputCost + outputCost;
    }

    expect(money(total)).toBe("0.015350000000");

    expect(analytics.summary).toEqual({
      traceCount: 6,
      inputTokens: "6000",
      outputTokens: "1200",
      totalTokens: "7200",
      estimatedCostUsd: money(total),
      errorCount: 2,
      errorRatePct: 33.33,
      averageLatencyMs: 1833.333,
    });

    expect(
      inputs.reduce(
        (sum, trace) => sum + trace.body.inputTokens,
        0,
      ),
    ).toBe(6000);

    expect(
      inputs.reduce(
        (sum, trace) => sum + trace.body.outputTokens,
        0,
      ),
    ).toBe(1200);

    expect(
      inputs.filter(
        trace => trace.body.status === "ERROR",
      ),
    ).toHaveLength(2);

    expect(
      inputs.reduce(
        (sum, trace) => sum + trace.body.latencyMs,
        0,
      ),
    ).toBe(11000);

    for (const rows of [
      analytics.series,
      analytics.byModel,
    ]) {
      const summed = rows.reduce(
        (sum, row) =>
          sum +
          BigInt(
            row.estimatedCostUsd.replace(".", ""),
          ),
        0n,
      );

      expect(summed).toBe(total);
    }

    const pagination: Array<{ projectId: string }> =
      read("traces-pagination.json");

    expect(pagination).toHaveLength(51);

    expect(
      pagination.every(
        row => row.projectId !== analytics.projectId,
      ),
    ).toBe(true);
  });

  it("preserves the supplied upload sample bytes and checksums", () => {
    for (const file of read("uploads-manifest.json")) {
      const bytes = readFileSync(
        resolve(root, "uploads", file.name),
      );

      expect(bytes.length).toBe(file.sizeBytes);

      expect(
        createHash("sha256")
          .update(bytes)
          .digest("hex"),
      ).toBe(file.sha256);
    }
  });

  it("uses dashboard scope and matching context in the assistant transcript", () => {
    const input = read("assistant/request.json");
    const context = read("assistant/context.json");

    expect(input).toEqual({
      question: expect.any(String),
      from: context.window.from,
      to: context.window.to,
      filters: {},
    });

    expect(context.summary).toEqual(
      read("responses/analytics-golden.json").summary,
    );

    const text = readFileSync(
      resolve(root, "assistant/success.sse"),
      "utf8",
    );

    const first = text
      .split("\n\n")[0]
      .split("\n")[1]
      .slice("data: ".length);

    expect(JSON.parse(first)).toMatchObject({
      provider: "gemini",
      context,
    });

    expect(JSON.parse(first)).not.toHaveProperty("traceId");

    const raw = Buffer.from(text, "utf8");

    const offsets: number[] =
      read("assistant/chunk-boundaries.json")
        .splitAtByteOffsets;

    expect(offsets).toContain(
      raw.indexOf(Buffer.from("é")) + 1,
    );
  });
});
