import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  buildDashboardCsv,
  csvFilename,
  escapeCsvCell,
  neutralizeFormula,
} from "../../../src/features/analytics/export-csv";
import type {
  AnalyticsSnapshot,
  DashboardExportInput,
} from "../../../src/features/analytics/export.types";
import goldenJson from "./fixtures/analytics-golden.json";
import emptyJson from "./fixtures/analytics-empty.json";

// ---------------------------------------------------------------- helpers

const golden = goldenJson as AnalyticsSnapshot;
const empty = emptyJson as AnalyticsSnapshot;

// Names taken from identities.json
const goldenInput: DashboardExportInput = {
  project: { id: golden.projectId, name: "Support Golden" },
  snapshot: golden,
};
const emptyInput: DashboardExportInput = {
  project: { id: empty.projectId, name: "Empty Project" },
  snapshot: empty,
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

function deepFreeze<T>(obj: T): T {
  Object.values(obj as object).forEach((v) => {
    if (v && typeof v === "object") deepFreeze(v);
  });
  return Object.freeze(obj);
}

/** Minimal CSV parser (RFC 4180) used only to check the output. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Returns the rows as { column: value } objects. */
function records(csv: string): Record<string, string>[] {
  const [header, ...data] = parseCsv(csv);
  return data.map((cells) =>
    Object.fromEntries(header.map((h, i) => [h, cells[i]])),
  );
}

// ---------------------------------------------------------------- tests

describe("buildDashboardCsv — golden fixture", () => {
  const csv = buildDashboardCsv(goldenInput);
  const rows = records(csv);

  it("uses exactly the header from the ticket", () => {
    expect(parseCsv(csv)[0]).toEqual([...CSV_COLUMNS]);
  });

  it("contains 1 summary row, 24 series rows and 2 model rows", () => {
    expect(rows).toHaveLength(27);
    expect(rows.filter((r) => r.section === "summary")).toHaveLength(1);
    expect(rows.filter((r) => r.section === "series")).toHaveLength(24);
    expect(rows.filter((r) => r.section === "model")).toHaveLength(2);
  });

  it("every row has the same number of cells as the header", () => {
    for (const cells of parseCsv(csv)) {
      expect(cells).toHaveLength(CSV_COLUMNS.length);
    }
  });

  it("keeps the summary values exactly", () => {
    const s = rows.find((r) => r.section === "summary")!;
    expect(s.estimatedCostUsd).toBe("0.015350000000");
    expect(s.inputTokens).toBe("6000");
    expect(s.outputTokens).toBe("1200");
    expect(s.traceCount).toBe("6");
    expect(s.errorCount).toBe("2");
    expect(s.errorRatePct).toBe("33.33");
    expect(s.averageLatencyMs).toBe("1833.333");
    expect(s.bucketStart).toBe("");
    expect(s.provider).toBe("");
    expect(s.model).toBe("");
  });

  it("repeats the metadata on every row", () => {
    for (const r of rows) {
      expect(r.snapshotId).toBe(golden.snapshotId);
      expect(r.projectId).toBe(golden.projectId);
      expect(r.projectName).toBe("Support Golden");
      expect(r.from).toBe("2026-10-01T00:00:00.000Z");
      expect(r.to).toBe("2026-10-02T00:00:00.000Z");
      expect(r.generatedAt).toBe("2026-10-02T08:00:00.000Z");
      expect(r.timezone).toBe("UTC");
      expect(r.bucket).toBe("hour");
      // No active filter in the golden fixture
      expect(r.q).toBe("");
      expect(r.filterProvider).toBe("");
      expect(r.filterModel).toBe("");
      expect(r.filterWorkflow).toBe("");
      expect(r.filterStatus).toBe("");
    }
  });

  it("copies every series bucket in order, including zero ones", () => {
    const series = rows.filter((r) => r.section === "series");
    golden.series.forEach((b, i) => {
      expect(series[i].bucketStart).toBe(b.bucketStart);
      expect(series[i].traceCount).toBe(String(b.traceCount));
      expect(series[i].inputTokens).toBe(b.inputTokens);
      expect(series[i].outputTokens).toBe(b.outputTokens);
      expect(series[i].estimatedCostUsd).toBe(b.estimatedCostUsd);
      // No per-bucket error/latency values in the snapshot → empty
      expect(series[i].errorCount).toBe("");
      expect(series[i].errorRatePct).toBe("");
      expect(series[i].averageLatencyMs).toBe("");
    });
    expect(series[0].estimatedCostUsd).toBe("0.000000000000");
    expect(series[10].estimatedCostUsd).toBe("0.001800000000");
  });

  it("copies the byModel rows into provider/model, not into the filters", () => {
    const models = rows.filter((r) => r.section === "model");
    expect(models.map((m) => [m.provider, m.model, m.estimatedCostUsd])).toEqual([
      ["fixture-b", "demo-large", "0.008200000000"],
      ["fixture-a", "demo-fast", "0.007150000000"],
    ]);
    for (const m of models) {
      expect(m.filterProvider).toBe("");
      expect(m.filterModel).toBe("");
      expect(m.bucketStart).toBe("");
    }
  });

  it("uses CRLF between rows and ends with CRLF", () => {
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("does not modify the captured input", () => {
    const frozen = deepFreeze(clone(goldenInput));
    expect(() => buildDashboardCsv(frozen)).not.toThrow();
  });
});

describe("buildDashboardCsv — empty snapshot", () => {
  const rows = records(buildDashboardCsv(emptyInput));

  it("works: 1 summary row, 24 zero buckets, no model rows", () => {
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.section === "model")).toHaveLength(0);
  });

  it("leaves null averages/rates empty (not 0)", () => {
    const s = rows[0];
    expect(s.errorRatePct).toBe("");
    expect(s.averageLatencyMs).toBe("");
    expect(s.estimatedCostUsd).toBe("0.000000000000");
    expect(s.errorCount).toBe("0");
  });
});

describe("buildDashboardCsv — active filters", () => {
  it("writes each filter in its own column on every row", () => {
    const input = clone(goldenInput);
    input.snapshot.filters = {
      q: "refund",
      provider: "fixture-a",
      model: "demo-fast",
      workflow: "batch",
      status: "ERROR",
    };
    for (const r of records(buildDashboardCsv(input))) {
      expect(r.q).toBe("refund");
      expect(r.filterProvider).toBe("fixture-a");
      expect(r.filterModel).toBe("demo-fast");
      expect(r.filterWorkflow).toBe("batch");
      expect(r.filterStatus).toBe("ERROR");
    }
  });
});

describe("buildDashboardCsv — hard text", () => {
  it("escapes quotes, commas, line breaks and keeps Unicode", () => {
    const input = clone(goldenInput);
    const name = 'Équipe "東京", v2\nligne 2';
    (input.project as { name: string }).name = name;
    input.snapshot.byModel[0].model = "modèle, \"spécial\"";
    const rows = records(buildDashboardCsv(input));
    expect(rows[0].projectName).toBe(name);
    expect(rows.find((r) => r.section === "model")!.model).toBe('modèle, "spécial"');
  });

  it.each([
    ["=HYPERLINK(\"http://x\")"],
    ["+1+1"],
    ["-2+3"],
    ["@SUM(A1)"],
    ["\tcmd"],
    ["\rcmd"],
    ["   =1+1"],
    ["\u0001=1+1"],
    [" \t@x"],
  ])("neutralizes formula-like text %j", (evil) => {
    const input = clone(goldenInput);
    (input.project as { name: string }).name = evil;
    input.snapshot.filters.workflow = evil;
    input.snapshot.byModel[0].provider = evil;
    const rows = records(buildDashboardCsv(input));
    expect(rows[0].projectName).toBe(`'${evil}`);
    expect(rows[0].filterWorkflow).toBe(`'${evil}`);
    expect(rows.find((r) => r.section === "model")!.provider).toBe(`'${evil}`);
  });

  it("does not touch normal text", () => {
    expect(neutralizeFormula("Support Golden")).toBe("Support Golden");
    expect(neutralizeFormula("a=b")).toBe("a=b");
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("buildDashboardCsv — precision", () => {
  it("keeps very large token integers without loss", () => {
    const input = clone(goldenInput);
    input.snapshot.summary.inputTokens = "123456789012345678901234567890";
    const s = records(buildDashboardCsv(input))[0];
    expect(s.inputTokens).toBe("123456789012345678901234567890");
  });

  it("keeps the 12 decimals of small costs", () => {
    const input = clone(goldenInput);
    input.snapshot.series[0].estimatedCostUsd = "0.000000000001";
    const series = records(buildDashboardCsv(input)).filter((r) => r.section === "series");
    expect(series[0].estimatedCostUsd).toBe("0.000000000001");
  });
});

describe("safeguards", () => {
  it("rejects a project that does not match the snapshot", () => {
    const input = { ...goldenInput, project: { id: "other", name: "X" } };
    expect(() => buildDashboardCsv(input)).toThrow();
  });

  it("escapeCsvCell only adds quotes when necessary", () => {
    expect(escapeCsvCell("abc")).toBe("abc");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });
});

describe("csvFilename", () => {
  it("follows the format tokenscope-dashboard-YYYYMMDDTHHmmssZ.csv", () => {
    expect(csvFilename(new Date("2026-10-15T17:05:09.123Z"))).toBe(
      "tokenscope-dashboard-20261015T170509Z.csv",
    );
  });
});