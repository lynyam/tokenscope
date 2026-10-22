import { describe, expect, it } from "vitest";
import {
  commonFilters, defaultTraceQuery, parseTraceSearchParams, serializeTraceQuery,
  traceQueryToApiParams, validatePeriod,
} from "@/api/trace-filters";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const GOLDEN = "from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-02T00%3A00%3A00.000Z";
const parse = (search: string) => parseTraceSearchParams(new URLSearchParams(search), NOW);

describe("trace filters", () => {
  it("resolves the default period once to explicit dates", () => {
    const result = parse("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.query.from).toBe("2026-10-08T12:00:00.000Z");
    expect(result.query.to).toBe("2026-10-15T12:00:00.000Z");
    expect(result.canonicalSearch).toContain("from=2026-10-08T12%3A00%3A00.000Z");
  });

  it("parses the golden period and is idempotent", () => {
    const first = parse(GOLDEN + "&q=%20SUPPORT%20&provider=Fixture-B&status=ERROR&sortBy=estimatedCostUsd&page=2&pageSize=50");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.query).toMatchObject({
      q: "SUPPORT", provider: "fixture-b", status: "ERROR", sortBy: "estimatedCostUsd", sortOrder: "desc", page: 2, pageSize: 50,
    });
    const second = parse(first.canonicalSearch);
    expect(second.ok && second.query).toEqual(first.query);
    expect(second.ok && second.canonicalSearch).toBe(first.canonicalSearch);
  });

  it("omits defaults and empty values when serializing", () => {
    const query = { ...defaultTraceQuery(NOW), q: "" };
    expect([...serializeTraceQuery(query).keys()]).toEqual(["from", "to"]);
    expect(traceQueryToApiParams(query).get("pageSize")).toBe("25");
    expect(traceQueryToApiParams(query).get("sortBy")).toBe("occurredAt");
  });

  it.each([
    ["repeated", GOLDEN + "&q=a&q=b"],
    ["unknown", GOLDEN + "&foo=1"],
    ["single date", "from=2026-10-01T00%3A00%3A00.000Z"],
    ["no Z", "from=2026-10-01T00%3A00%3A00%2B02%3A00&to=2026-10-02T00%3A00%3A00.000Z"],
    ["impossible date", "from=2026-02-31T00%3A00%3A00.000Z&to=2026-03-02T00%3A00%3A00.000Z"],
    ["reversed", "from=2026-10-02T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z"],
    ["too long", "from=2026-01-01T00%3A00%3A00.000Z&to=2026-10-01T00%3A00%3A00.000Z"],
    ["status", GOLDEN + "&status=OK"],
    ["page zero", GOLDEN + "&page=0"],
    ["page decimal", GOLDEN + "&page=1.5"],
    ["page size", GOLDEN + "&pageSize=10"],
    ["sort", GOLDEN + "&sortBy=id"],
    ["order", GOLDEN + "&sortOrder=up"],
    ["provider", GOLDEN + "&provider=a%20b"],
    ["model", GOLDEN + "&model=-x"],
    ["workflow", GOLDEN + "&workflow="],
    ["q length", GOLDEN + "&q=" + "a".repeat(101)],
  ])("rejects %s values", (_name, search) => {
    const result = parse(search);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it("keeps the workflow case-sensitive and drops an empty q", () => {
    const result = parse(GOLDEN + "&workflow=Support%20Desk&q=%20%20");
    expect(result.ok && result.query.workflow).toBe("Support Desk");
    expect(result.ok && result.query.q).toBeUndefined();
  });

  it("separates shared filters from sorting and pagination", () => {
    const result = parse(GOLDEN + "&q=x&sortBy=latencyMs&page=3&pageSize=100");
    if (!result.ok) throw new Error("unexpected");
    expect(commonFilters(result.query)).toEqual({
      from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z", q: "x",
    });
  });

  it("validates the period bounds", () => {
    expect(validatePeriod("2026-10-01T00:00:00.000Z", "2026-12-30T00:00:00.000Z")).toBeNull();
    expect(validatePeriod("2026-10-01T00:00:00.000Z", "2026-12-31T00:00:00.001Z")).toMatch(/90 days/);
  });
});
