import { beforeEach, expect, it, vi } from "vitest";
import { getModelChoices, getTrace, listTraces } from "@/api/traces.api";
import { defaultTraceQuery } from "@/api/trace-filters";
import { ApiError } from "@/api/http-client";
import { saveAccessToken } from "@/api/auth-session";
import type { Trace } from "@/types/trace.types";

export const trace: Trace = {
  id: "t1", projectId: "p1", externalId: "ext-1", provider: "fixture-a", model: "demo-fast",
  workflow: "Support", inputTokens: 1000, outputTokens: 200, latencyMs: 120, status: "SUCCESS",
  occurredAt: "2026-10-01T10:00:00.000Z", metadata: { channel: "<b>chat</b>" }, priceVersionId: "pv1",
  pricing: { inputUsdPerMillion: "1.000000", outputUsdPerMillion: "4.000000", currency: "USD", isSynthetic: true },
  inputCostUsd: "0.001000000000", outputCostUsd: "0.000800000000", estimatedCostUsd: "0.001800000000",
  version: 1, createdAt: "2026-10-01T10:00:01.000Z", updatedAt: "2026-10-01T10:00:01.000Z",
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const query = { ...defaultTraceQuery(new Date("2026-10-15T00:00:00.000Z")), q: "a&b=c" };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("token");
});

it("lists traces with every applied value and keeps cost strings", async () => {
  fetchMock.mockResolvedValue(json({ items: [trace], page: 1, pageSize: 25, total: 1, totalPages: 1 }));
  const page = await listTraces("o/1", "p1", query);
  const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
  expect(url.pathname).toBe("/api/v1/organizations/o%2F1/projects/p1/traces");
  expect(url.searchParams.get("q")).toBe("a&b=c");
  expect(url.searchParams.get("pageSize")).toBe("25");
  expect(page.items[0].estimatedCostUsd).toBe("0.001800000000");
});

it("rejects a malformed list response", async () => {
  fetchMock.mockResolvedValue(json({ items: [{ ...trace, estimatedCostUsd: 0.0018 }], page: 1, pageSize: 25, total: 1, totalPages: 1 }));
  await expect(listTraces("o", "p", query)).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
});

it("gets one trace with an encoded id and surfaces API errors", async () => {
  fetchMock.mockResolvedValueOnce(json(trace));
  await getTrace("o", "p", "a/b", undefined);
  expect(String(fetchMock.mock.calls[0][0])).toBe("/api/v1/organizations/o/projects/p/traces/a%2Fb");
  fetchMock.mockResolvedValueOnce(json({ statusCode: 404, code: "TRACE_NOT_FOUND", message: "gone" }, 404));
  const error = await getTrace("o", "p", "x").catch(e => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ statusCode: 404, code: "TRACE_NOT_FOUND" });
});

it("deduplicates provider and model choices", async () => {
  fetchMock.mockResolvedValue(json([
    { id: "1", provider: "fixture-a", model: "demo-fast" },
    { id: "2", provider: "fixture-a", model: "demo-fast" },
    { id: "3", provider: "fixture-b", model: "demo-large" },
  ]));
  expect(await getModelChoices()).toEqual({
    providers: ["fixture-a", "fixture-b"],
    modelsByProvider: { "fixture-a": ["demo-fast"], "fixture-b": ["demo-large"] },
  });
});
