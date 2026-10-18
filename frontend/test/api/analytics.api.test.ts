import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  analyticsQueryParams,
  analyticsSelectionKey,
  getAnalytics,
} from "@/api/analytics.api";
import { saveAccessToken } from "@/api/auth-session";
import { ApiError } from "@/api/http-client";
import type { AppliedSelection } from "@/types/analytics.types";
import { readEvaluationFixture } from "./helpers/evaluation-fixtures";

const golden = JSON.parse(readEvaluationFixture("responses/analytics-golden.json"));
const empty = JSON.parse(readEvaluationFixture("responses/analytics-empty.json"));

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const selection: AppliedSelection = {
  organizationId: "20000000-0000-4000-8000-000000000001",
  projectId: golden.projectId,
  from: golden.window.from,
  to: golden.window.to,
  filters: {},
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("token-1");
});

describe("analyticsQueryParams", () => {
  it("envoie les dates exactes et seulement les filtres actifs", () => {
    const params = analyticsQueryParams({
      ...selection,
      filters: { q: "a&b=c", provider: "fixture-a", model: "", status: "ERROR" },
    });
    expect(params.get("from")).toBe(selection.from);
    expect(params.get("to")).toBe(selection.to);
    expect(params.get("q")).toBe("a&b=c"); // le texte utilisateur n'injecte pas un autre paramètre
    expect(params.get("provider")).toBe("fixture-a");
    expect(params.get("status")).toBe("ERROR");
    expect(params.has("model")).toBe(false);
    expect(params.has("workflow")).toBe(false);
    expect([...params.keys()].sort()).toEqual(["from", "provider", "q", "status", "to"]);
  });
});

describe("analyticsSelectionKey", () => {
  it("identique pour une même sélection, différente dès qu'un élément change", () => {
    const key = analyticsSelectionKey(selection);
    expect(analyticsSelectionKey({ ...selection, filters: {} })).toBe(key);
    expect(analyticsSelectionKey({ ...selection, filters: { q: "" } })).toBe(key);
    expect(analyticsSelectionKey({ ...selection, projectId: "other" })).not.toBe(key);
    expect(analyticsSelectionKey({ ...selection, to: "2026-10-03T00:00:00.000Z" })).not.toBe(key);
    expect(analyticsSelectionKey({ ...selection, filters: { status: "ERROR" } })).not.toBe(key);
  });
});

describe("getAnalytics", () => {
  it("appelle la bonne URL avec le jeton, le signal, sans cache", async () => {
    fetchMock.mockResolvedValue(json(golden));
    const controller = new AbortController();
    await getAnalytics(selection, controller.signal);

    const [url, init] = fetchMock.mock.calls[0];
    const parsed = new URL(String(url), "http://x");
    expect(parsed.pathname).toBe(
      `/api/v1/organizations/${selection.organizationId}/projects/${selection.projectId}/analytics`,
    );
    expect(parsed.searchParams.get("from")).toBe(selection.from);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-1");
    expect(init?.signal).toBe(controller.signal);
    expect(init?.method).toBe("GET");
  });

  it("encode les identifiants dans le chemin", async () => {
    fetchMock.mockResolvedValue(json({ ...golden, projectId: "p/1" }));
    await getAnalytics({ ...selection, organizationId: "o/1", projectId: "p/1" });
    expect(new URL(String(fetchMock.mock.calls[0][0]), "http://x").pathname).toBe(
      "/api/v1/organizations/o%2F1/projects/p%2F1/analytics",
    );
  });

  it("réponse de référence : valeurs exactes en chaînes, séries et modèles", async () => {
    fetchMock.mockResolvedValue(json(golden));
    const snapshot = await getAnalytics(selection);
    expect(snapshot.summary.traceCount).toBe(6);
    expect(snapshot.summary.inputTokens).toBe("6000");
    expect(snapshot.summary.totalTokens).toBe("7200");
    expect(snapshot.summary.estimatedCostUsd).toBe("0.015350000000");
    expect(snapshot.summary.errorRatePct).toBe(33.33);
    expect(snapshot.series).toHaveLength(24);
    expect(snapshot.series[10].estimatedCostUsd).toBe("0.001800000000");
    expect(snapshot.byModel.map(model => model.provider + "/" + model.model)).toEqual([
      "fixture-b/demo-large",
      "fixture-a/demo-fast",
    ]);
  });

  it("réponse vide : les moyennes restent null (jamais 0)", async () => {
    fetchMock.mockResolvedValue(json(empty));
    const snapshot = await getAnalytics({ ...selection, projectId: empty.projectId });
    expect(snapshot.summary.traceCount).toBe(0);
    expect(snapshot.summary.errorRatePct).toBeNull();
    expect(snapshot.summary.averageLatencyMs).toBeNull();
    expect(snapshot.byModel).toEqual([]);
  });

  it("refuse un coût converti en nombre", async () => {
    fetchMock.mockResolvedValue(
      json({ ...golden, summary: { ...golden.summary, estimatedCostUsd: 0.01535 } }),
    );
    await expect(getAnalytics(selection)).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("refuse une réponse mal formée", async () => {
    for (const body of [[], { ...golden, series: "x" }, { ...golden, summary: null }, { ...golden, window: { ...golden.window, timezone: "Paris" } }]) {
      fetchMock.mockResolvedValueOnce(json(body));
      await expect(getAnalytics(selection)).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
    }
  });

  it("refuse une réponse qui décrit un autre projet, une autre période ou d'autres filtres", async () => {
    fetchMock.mockResolvedValueOnce(json({ ...golden, projectId: "autre" }));
    await expect(getAnalytics(selection)).rejects.toMatchObject({ code: "ANALYTICS_SELECTION_MISMATCH" });

    fetchMock.mockResolvedValueOnce(json({ ...golden, window: { ...golden.window, to: "2026-10-03T00:00:00.000Z" } }));
    await expect(getAnalytics(selection)).rejects.toMatchObject({ code: "ANALYTICS_SELECTION_MISMATCH" });

    // la sélection demandait un filtre que la réponse ne reflète pas
    fetchMock.mockResolvedValueOnce(json(golden));
    await expect(getAnalytics({ ...selection, filters: { provider: "openai" } })).rejects.toMatchObject({
      code: "ANALYTICS_SELECTION_MISMATCH",
    });
  });

  it("accepte une réponse filtrée qui reflète les filtres demandés", async () => {
    fetchMock.mockResolvedValue(json({ ...golden, filters: { ...golden.filters, provider: "fixture-a", status: "ERROR" } }));
    await expect(
      getAnalytics({ ...selection, filters: { provider: "fixture-a", status: "ERROR" } }),
    ).resolves.toMatchObject({ filters: { provider: "fixture-a", status: "ERROR" } });
  });

  it("remonte les erreurs API : 404 projet, 400, 429 avec Retry-After", async () => {
    fetchMock.mockResolvedValueOnce(json({ statusCode: 404, code: "PROJECT_NOT_FOUND", message: "x" }, 404));
    await expect(getAnalytics(selection)).rejects.toMatchObject({ statusCode: 404, code: "PROJECT_NOT_FOUND" });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 400, code: "VALIDATION_ERROR", message: "x" }, 400));
    await expect(getAnalytics(selection)).rejects.toMatchObject({ statusCode: 400 });

    fetchMock.mockResolvedValueOnce(json({ statusCode: 429, code: "RATE_LIMITED", message: "x" }, 429, { "Retry-After": "8" }));
    const error = await getAnalytics(selection).catch(e => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ statusCode: 429, retryAfterSeconds: 8 });
  });

  it("un abandon n'est pas une erreur réseau", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getAnalytics(selection, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
