import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TraceDetailPage } from "@/pages/projects/TraceDetailPage";
import { getTrace } from "@/api/traces.api";
import { ApiError } from "@/api/http-client";
import type { Trace } from "@/types/trace.types";
import { clearAuthSession, getAuthSessionSnapshot, isAuthSessionCurrent, saveAccessToken } from "@/api/auth-session";
import { notifyProjectsChanged } from "@/api/project-events";

vi.mock("@/api/traces.api", () => ({ listTraces: vi.fn(), getTrace: vi.fn(), getModelChoices: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: "viewer" }, isLoading: false }),
}));
const getMock = vi.mocked(getTrace);

const trace: Trace = {
  id: "t1", projectId: "p1", externalId: "ext-001", provider: "fixture-a", model: "demo-fast", workflow: "Support",
  inputTokens: 1000, outputTokens: 200, latencyMs: 120, status: "SUCCESS", occurredAt: "2026-10-01T10:00:00.000Z",
  metadata: { note: "<img src=x onerror=alert(1)>" }, priceVersionId: "pv",
  pricing: { inputUsdPerMillion: "1.000000", outputUsdPerMillion: "4.000000", currency: "USD", isSynthetic: true },
  inputCostUsd: "0.001000000000", outputCostUsd: "0.000800000000", estimatedCostUsd: "0.001800000000",
  version: 3, createdAt: "2026-10-01T10:00:01.000Z", updatedAt: "2026-10-01T10:00:02.000Z",
};

const LIST = "?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-02T00%3A00%3A00.000Z&q=SUPPORT";
function renderDetail(state?: unknown) {
  const tree = () => (
    <MemoryRouter initialEntries={[{ pathname: "/organizations/o1/projects/p1/traces/t1", state }]}>
      <Routes>
        <Route path="/organizations/:organizationId/projects/:projectId/traces/:traceId" element={<TraceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
  const view = render(tree());
  return { ...view, rerenderPage: () => view.rerender(tree()) };
}

beforeEach(() => {
  getMock.mockReset();
  saveAccessToken("detail-session");
});

it("shows every recorded fact with exact decimal strings and escaped metadata", async () => {
  getMock.mockResolvedValue(trace);
  renderDetail({ listSearch: LIST });
  expect(await screen.findByText("$0.001800000000")).toBeInTheDocument();
  expect(screen.getByText("$0.001000000000")).toBeInTheDocument();
  expect(screen.getByText("$0.000800000000")).toBeInTheDocument();
  expect(screen.getByText("$1.000000 per million tokens")).toBeInTheDocument();
  expect(screen.getByText(/Synthetic pricing/)).toBeInTheDocument();
  const metadata = screen.getByTestId("trace-metadata");
  expect(metadata.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(metadata.querySelector("img")).toBeNull();
});

it("returns to the list query it came from, or to the default list", async () => {
  getMock.mockResolvedValue(trace);
  const first = renderDetail({ listSearch: LIST });
  const link = await screen.findByRole("link", { name: "← Back to traces" });
  expect(link.getAttribute("href")).toContain("q=SUPPORT");
  first.unmount();
  renderDetail();
  expect((await screen.findByRole("link", { name: "← Back to traces" })).getAttribute("href"))
    .toBe("/organizations/o1/projects/p1/traces");
});

it("distinguishes a missing trace from an unavailable project", async () => {
  getMock.mockRejectedValueOnce(new ApiError(404, "TRACE_NOT_FOUND", "x"));
  const first = renderDetail();
  expect(await screen.findByText("This trace no longer exists.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "← Back to traces" })).toBeInTheDocument();
  first.unmount();
  getMock.mockRejectedValueOnce(new ApiError(404, "PROJECT_NOT_FOUND", "x"));
  renderDetail();
  expect(await screen.findByText("This project is not available.")).toBeInTheDocument();
});

it("offers Retry on a server failure", async () => {
  getMock.mockRejectedValueOnce(new ApiError(500, "X", "Server broke"));
  renderDetail();
  expect(await screen.findByText("Server broke")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

it("does not accept detail data from an earlier login", async () => {
  saveAccessToken("session-a");

  let resolve!: (value: Trace) => void;
  getMock.mockReturnValueOnce(
    new Promise<Trace>(done => { resolve = done; }),
  );

  renderDetail();
  saveAccessToken("session-b");

  await act(async () => { resolve(trace); });

  expect(
    screen.queryByText("$0.001800000000"),
  ).not.toBeInTheDocument();
});

it("an archive aborts loading and a late response cannot restore detail", async () => {
  let resolve!: (value: Trace) => void;
  getMock.mockReturnValueOnce(
    new Promise<Trace>(done => { resolve = done; }),
  );

  renderDetail();
  await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
  const signal = getMock.mock.calls[0][3];

  act(() => {
    notifyProjectsChanged({
      organizationId: "o1",
      kind: "archive",
      projectId: "p1",
    });
  });

  expect(signal?.aborted).toBe(true);
  await act(async () => { resolve(trace); });

  expect(
    screen.getByText("This project is not available."),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("$0.001800000000"),
  ).not.toBeInTheDocument();
});

it.each([
  "TRACE_NOT_FOUND",
  "PROJECT_NOT_FOUND",
  "INTERNAL_SERVER_ERROR",
])("keeps the request ID for %s", async code => {
  getMock.mockRejectedValueOnce(
    new ApiError(
      code === "INTERNAL_SERVER_ERROR" ? 500 : 404,
      code,
      "Request failed",
      undefined,
      "req-detail",
    ),
  );

  renderDetail();

  expect(
    await screen.findByText("Request ID: req-detail"),
  ).toBeInTheDocument();
});
// ---- Realtime refresh (TSE-87) ----
// Controlled realtime channel: the tests fire the three callbacks by hand.
const realtime = vi.hoisted(() => ({
  handlers: null as null | { onChanged: () => void; onSynced: () => void; onRevoked: () => void },
  enabled: true,
}));
vi.mock("@/hooks/useProjectRealtime", () => ({
  useProjectRealtime: (
    _organizationId: string,
    _projectId: string,
    handlers: { onChanged: () => void; onSynced: () => void; onRevoked: () => void },
    enabled = true,
  ) => {
    realtime.handlers = handlers;
    realtime.enabled = enabled;
    return "live";
  },
}));

afterEach(() => {
  vi.useRealTimers();
  setVisibility("visible");
  realtime.handlers = null;
  realtime.enabled = true;
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function notify(kind: "onChanged" | "onSynced" | "onRevoked") {
  act(() => { realtime.handlers![kind](); });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

// Opens the page with the first read settled, under a controlled clock.
async function openLoaded() {
  vi.useFakeTimers();
  getMock.mockResolvedValueOnce(trace);
  const view = renderDetail();
  await flush();
  expect(getMock).toHaveBeenCalledTimes(1);
  return view;
}

it("refreshes the open trace after a notice and keeps it visible meanwhile", async () => {
  await openLoaded();
  const next = deferred<Trace>();
  getMock.mockReturnValueOnce(next.promise);
  notify("onChanged");
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Updating…")).toBeInTheDocument();
  expect(screen.getByText("Trace ext-001")).toBeInTheDocument();
  await act(async () => { next.resolve({ ...trace, inputTokens: 5000, version: 4 }); });
  expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
  expect(screen.getByText("5000")).toBeInTheDocument();
});

it("coalesces a burst of notices and an acknowledgement into one read", async () => {
  await openLoaded();
  getMock.mockResolvedValue(trace);
  act(() => {
    realtime.handlers!.onChanged();
    realtime.handlers!.onChanged();
    realtime.handlers!.onSynced();
  });
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(2);
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(2);
});

it("queues exactly one follow-up when a notice arrives during a read", async () => {
  await openLoaded();
  const slow = deferred<Trace>();
  getMock.mockReturnValueOnce(slow.promise).mockResolvedValue(trace);
  notify("onChanged");
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(2);
  notify("onChanged");
  notify("onChanged");
  notify("onChanged");
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(2); // still one read at a time
  await act(async () => { slow.resolve(trace); });
  await flush(1);
  expect(getMock).toHaveBeenCalledTimes(3); // one follow-up, not three
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(3);
});

it("shows not-found when the open trace is deleted and stops reading", async () => {
  await openLoaded();
  getMock.mockRejectedValueOnce(new ApiError(404, "TRACE_NOT_FOUND", "Trace not found", undefined, "req-gone"));
  notify("onChanged");
  await flush(300);
  expect(screen.getByText("Request ID: req-gone")).toBeInTheDocument();
  expect(screen.queryByText("Trace ext-001")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "← Back to traces" })).toBeInTheDocument();
  expect(realtime.enabled).toBe(false);
  notify("onChanged");
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(2);
});

it("keeps the confirmed trace with an error and a deliberate Retry after a transient failure", async () => {
  await openLoaded();
  getMock.mockRejectedValueOnce(new ApiError(500, "INTERNAL_SERVER_ERROR", "boom", undefined, "req-500"));
  notify("onChanged");
  await flush(300);
  expect(screen.getByText("Trace ext-001")).toBeInTheDocument(); // not an empty result
  expect(screen.getByText("Request ID: req-500")).toBeInTheDocument();
  await flush(5000);
  expect(getMock).toHaveBeenCalledTimes(2); // no automatic retry loop
  getMock.mockResolvedValueOnce({ ...trace, inputTokens: 7777 });
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await flush(1);
  expect(getMock).toHaveBeenCalledTimes(3);
  expect(screen.getByText("7777")).toBeInTheDocument();
  expect(screen.queryByText("Request ID: req-500")).not.toBeInTheDocument();
});

it("does not read again before the Retry-After deadline, whatever the trigger", async () => {
  await openLoaded();
  getMock.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "slow", undefined, undefined, 10));
  notify("onChanged");
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(2);
  getMock.mockResolvedValue({ ...trace, inputTokens: 4242 });
  notify("onChanged");
  notify("onSynced");
  await flush(5000);
  expect(getMock).toHaveBeenCalledTimes(2); // deadline not reached
  await flush(5500);
  expect(getMock).toHaveBeenCalledTimes(3); // one read once the deadline has passed
  expect(screen.getByText("4242")).toBeInTheDocument();
});

it("does not read while the tab is hidden and reads once when it is visible again", async () => {
  await openLoaded();
  setVisibility("hidden");
  getMock.mockResolvedValue({ ...trace, inputTokens: 3131 });
  notify("onChanged");
  notify("onChanged");
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(getMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("3131")).toBeInTheDocument();
});

it("clears the trace when access is revoked and keeps the signed-in session", async () => {
  await openLoaded();
  const session = getAuthSessionSnapshot();
  notify("onRevoked");
  expect(screen.getByText("This project is not available.")).toBeInTheDocument();
  expect(screen.queryByText("Trace ext-001")).not.toBeInTheDocument();
  expect(realtime.enabled).toBe(false);
  expect(isAuthSessionCurrent(session)).toBe(true);
  notify("onChanged");
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(1);
});

it("cleans up on unmount: no read after leaving the page", async () => {
  const view = await openLoaded();
  notify("onChanged");
  view.unmount();
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(1);
});

it("cancelling a read in flight causes no unhandled rejection", async () => {
  const view = await openLoaded();
  getMock.mockImplementationOnce((_o, _p, _t, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  notify("onChanged");
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(2);
  view.unmount(); // aborts the read: vitest fails the run on an unhandled rejection
  await flush(1);
});

it("clears a confirmed detail before loading it for a new session", async () => {
  const view = await openLoaded();
  const next = deferred<Trace>();
  getMock.mockReturnValueOnce(next.promise);
  saveAccessToken("replacement-session");
  view.rerenderPage();
  expect(screen.queryByText("Trace ext-001")).not.toBeInTheDocument();
  await flush();
  expect(screen.queryByText("Trace ext-001")).not.toBeInTheDocument();
  expect(getMock).toHaveBeenCalledTimes(2);
  await act(async () => { next.resolve({ ...trace, externalId: "new-session" }); });
  expect(screen.getByText("Trace new-session")).toBeInTheDocument();
});

it("invalidation clears detail and queued work without starting a tokenless request", async () => {
  await openLoaded();
  getMock.mockResolvedValue(trace);
  notify("onChanged");
  act(() => { clearAuthSession(); });
  await flush(2000);
  expect(getMock).toHaveBeenCalledTimes(1);
  expect(realtime.enabled).toBe(false);
  expect(screen.queryByText("Trace ext-001")).not.toBeInTheDocument();
});

it("defers even the first detail read while hidden, then reconciles once", async () => {
  vi.useFakeTimers();
  setVisibility("hidden");
  getMock.mockResolvedValue(trace);
  renderDetail();
  notify("onSynced");
  await flush(2000);
  expect(getMock).not.toHaveBeenCalled();
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(getMock).toHaveBeenCalledTimes(1);
});

it("does not turn notices into hidden-tab retries after the first detail read fails", async () => {
  vi.useFakeTimers();
  getMock.mockRejectedValueOnce(new ApiError(503, "UNAVAILABLE", "Unavailable"));
  renderDetail();
  await flush();
  setVisibility("hidden");
  getMock.mockResolvedValue(trace);
  notify("onChanged");
  await flush(300);
  notify("onSynced");
  await flush(300);
  expect(getMock).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(getMock).toHaveBeenCalledTimes(2);
});
