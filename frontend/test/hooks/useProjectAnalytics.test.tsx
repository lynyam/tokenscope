import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/http-client";
import {
  ANALYTICS_REFRESH_INTERVAL_MS,
  toAssistantSelectionState,
  useProjectAnalytics,
} from "@/hooks/useProjectAnalytics";
import type { AnalyticsSnapshot, AppliedSelection } from "@/types/analytics.types";
import { readEvaluationFixture } from "../api/helpers/evaluation-fixtures";

vi.mock("@/api/analytics.api", async importOriginal => ({
  ...(await importOriginal<typeof import("@/api/analytics.api")>()),
  getAnalytics: vi.fn(),
}));
import { getAnalytics } from "@/api/analytics.api";

const golden: AnalyticsSnapshot = JSON.parse(readEvaluationFixture("responses/analytics-golden.json"));
const empty: AnalyticsSnapshot = JSON.parse(readEvaluationFixture("responses/analytics-empty.json"));
const mocked = vi.mocked(getAnalytics);

const selection: AppliedSelection = {
  organizationId: "o1",
  projectId: golden.projectId,
  from: golden.window.from,
  to: golden.window.to,
  filters: {},
};
const other: AppliedSelection = { ...selection, filters: { provider: "fixture-a" } };

// A request that stays pending until the test settles it.
function deferred() {
  let resolve!: (value: AnalyticsSnapshot) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AnalyticsSnapshot>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-18T10:00:00.000Z"));
  mocked.mockReset();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
});

describe("chargement", () => {
  it("charge le snapshot de la sélection : loading puis ready", async () => {
    const request = deferred();
    mocked.mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useProjectAnalytics(selection));

    await flush();
    expect(result.current.status).toBe("loading");
    expect(result.current.snapshot).toBeNull();
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked.mock.calls[0][0]).toEqual(selection);
    expect(mocked.mock.calls[0][1]).toBeInstanceOf(AbortSignal);

    request.resolve(golden);
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.summary.estimatedCostUsd).toBe("0.015350000000");
  });

  it("sélection invalide (null) : aucune requête", async () => {
    const { result } = renderHook(() => useProjectAnalytics(null));
    await flush(60_000);
    expect(result.current.status).toBe("idle");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("un résultat vide reste un snapshot (pas une erreur)", async () => {
    mocked.mockResolvedValueOnce(empty);
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.summary.traceCount).toBe(0);
    expect(toAssistantSelectionState(result.current.status, result.current.snapshot)).toBe("empty");
  });
});

describe("changement de sélection", () => {
  it("efface les chiffres de l'ancienne sélection tout de suite et abandonne sa requête", async () => {
    mocked.mockResolvedValueOnce(golden);
    const refreshing = deferred();
    mocked.mockReturnValueOnce(refreshing.promise);
    const second = deferred();
    mocked.mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ s }) => useProjectAnalytics(s), {
      initialProps: { s: selection },
    });
    await flush();
    expect(result.current.snapshot).not.toBeNull();

    act(() => result.current.refresh()); // une requête de l'ancienne sélection est en vol
    await flush();
    const inFlightSignal = mocked.mock.calls[1][1] as AbortSignal;
    expect(inFlightSignal.aborted).toBe(false);

    rerender({ s: other });
    // au même rendu : plus aucun chiffre de l'ancienne sélection
    expect(result.current.snapshot).toBeNull();
    expect(result.current.status).toBe("loading");
    expect(inFlightSignal.aborted).toBe(true);

    await flush();
    second.resolve({ ...golden, filters: { ...golden.filters, provider: "fixture-a" } });
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.filters.provider).toBe("fixture-a");

    refreshing.resolve(golden); // la réponse tardive de l'ancienne sélection est ignorée
    await flush();
    expect(result.current.snapshot?.filters.provider).toBe("fixture-a");
  });

  it("ignore la réponse tardive de l'ancienne sélection", async () => {
    const slow = deferred();
    mocked.mockReturnValueOnce(slow.promise);
    const fast = deferred();
    mocked.mockReturnValueOnce(fast.promise);

    const { result, rerender } = renderHook(({ s }) => useProjectAnalytics(s), {
      initialProps: { s: selection },
    });
    await flush();
    rerender({ s: other });
    await flush();

    fast.resolve({ ...golden, filters: { ...golden.filters, provider: "fixture-a" } });
    await flush();
    slow.resolve(golden); // arrive après, pour l'ancienne sélection
    await flush();

    expect(result.current.snapshot?.filters.provider).toBe("fixture-a");
  });
});

describe("rafraîchissement de la même sélection", () => {
  it("garde le snapshot visible pendant la mise à jour puis le remplace d'un bloc", async () => {
    mocked.mockResolvedValueOnce(golden);
    const refreshing = deferred();
    mocked.mockReturnValueOnce(refreshing.promise);

    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(result.current.status).toBe("ready");

    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe("updating");
    expect(result.current.snapshot).toBe(golden); // toujours le snapshot confirmé

    const newer = { ...golden, snapshotId: "new", generatedAt: "2026-10-02T08:00:05.000Z" };
    refreshing.resolve(newer);
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.snapshot?.snapshotId).toBe("new");
  });

  it("une panne garde le snapshot (stale) avec l'erreur, puis Retry répare", async () => {
    mocked.mockResolvedValueOnce(golden);
    mocked.mockRejectedValueOnce(new ApiError(500, "INTERNAL_SERVER_ERROR", "boom"));
    mocked.mockResolvedValueOnce(golden);

    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe("stale");
    expect(result.current.snapshot).toBe(golden);
    expect(result.current.failure).toMatchObject({ kind: "error" });

    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.failure).toBeNull();
  });

  it("échec du premier chargement : error, jamais un faux état vide", async () => {
    mocked.mockRejectedValueOnce(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.snapshot).toBeNull();
    expect(toAssistantSelectionState(result.current.status, result.current.snapshot)).toBe("error");
  });
});

describe("déclencheurs et limites", () => {
  it("une rafale de notifications donne une seule requête", async () => {
    mocked.mockResolvedValue(golden);
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(mocked).toHaveBeenCalledTimes(1);

    act(() => { for (let i = 0; i < 20; i++) result.current.notifyChanged(); });
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("une notification pendant une requête donne un seul suivi", async () => {
    const running = deferred();
    mocked.mockReturnValueOnce(running.promise);
    mocked.mockResolvedValue(golden);
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();

    act(() => { for (let i = 0; i < 10; i++) result.current.notifyChanged(); });
    await flush(2000);
    expect(mocked).toHaveBeenCalledTimes(1); // une seule requête à la fois

    running.resolve(golden);
    await flush();
    expect(mocked).toHaveBeenCalledTimes(2);
    await flush(2000);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("recharge toutes les 30 secondes tant que l'onglet est visible", async () => {
    mocked.mockResolvedValue(golden);
    renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(mocked).toHaveBeenCalledTimes(1);

    await flush(ANALYTICS_REFRESH_INTERVAL_MS + 500);
    expect(mocked).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await flush(ANALYTICS_REFRESH_INTERVAL_MS * 3);
    expect(mocked).toHaveBeenCalledTimes(2); // rien pendant que l'onglet est caché
  });

  it("recharge quand la fenêtre reprend le focus ou que l'onglet redevient visible", async () => {
    mocked.mockResolvedValue(golden);
    renderHook(() => useProjectAnalytics(selection));
    await flush();

    act(() => { window.dispatchEvent(new Event("focus")); });
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(2);

    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(3);
  });

  it("429 : les données restent et rien ne repart avant le Retry-After", async () => {
    mocked.mockResolvedValueOnce(golden);
    mocked.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "slow", undefined, undefined, 20));
    mocked.mockResolvedValue(golden);

    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe("stale");
    expect(result.current.failure).toMatchObject({ kind: "rate-limit", retryAfterSeconds: 20 });
    expect(result.current.snapshot).toBe(golden);
    expect(mocked).toHaveBeenCalledTimes(2);

    act(() => result.current.notifyChanged());
    act(() => result.current.refresh());
    await flush(15_000);
    expect(mocked).toHaveBeenCalledTimes(2); // pas de rafale pendant le délai

    await flush(6000);
    expect(mocked).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe("ready");
  });

  it("ne boucle pas après une panne réseau", async () => {
    mocked.mockResolvedValueOnce(golden);
    mocked.mockRejectedValueOnce(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    mocked.mockResolvedValue(golden);

    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    act(() => { result.current.refresh(); result.current.notifyChanged(); });
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(2); // la panne n'a pas déclenché de relance seule
  });
});

describe("accès perdu, session, nettoyage", () => {
  it("404 projet : efface le contenu et arrête tout", async () => {
    mocked.mockResolvedValueOnce(golden);
    mocked.mockRejectedValueOnce(new ApiError(404, "PROJECT_NOT_FOUND", "gone"));
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();

    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toBe("unavailable");
    expect(result.current.snapshot).toBeNull();

    await flush(ANALYTICS_REFRESH_INTERVAL_MS * 3);
    act(() => result.current.refresh());
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(2); // plus aucune requête
  });

  it("401 : arrête les relances", async () => {
    mocked.mockRejectedValueOnce(new ApiError(401, "INVALID_ACCESS_TOKEN", "expired"));
    const { result } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    expect(result.current.status).toBe("error");

    await flush(ANALYTICS_REFRESH_INTERVAL_MS * 3);
    act(() => result.current.refresh());
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("au démontage : abandonne la requête et arrête les minuteurs", async () => {
    const running = deferred();
    mocked.mockReturnValueOnce(running.promise);
    const { unmount } = renderHook(() => useProjectAnalytics(selection));
    await flush();
    const signal = mocked.mock.calls[0][1] as AbortSignal;

    unmount();
    expect(signal.aborted).toBe(true);
    await flush(ANALYTICS_REFRESH_INTERVAL_MS * 3);
    act(() => { window.dispatchEvent(new Event("focus")); });
    await flush(1000);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});

describe("toAssistantSelectionState", () => {
  it("traduit l'état du dashboard pour l'assistant", () => {
    expect(toAssistantSelectionState("idle", null)).toBe("invalid");
    expect(toAssistantSelectionState("loading", null)).toBe("loading");
    expect(toAssistantSelectionState("error", null)).toBe("error");
    expect(toAssistantSelectionState("unavailable", null)).toBe("error");
    expect(toAssistantSelectionState("ready", golden)).toBe("ready");
    expect(toAssistantSelectionState("updating", golden)).toBe("ready");
    expect(toAssistantSelectionState("stale", golden)).toBe("ready");
    expect(toAssistantSelectionState("ready", empty)).toBe("empty");
  });
});
