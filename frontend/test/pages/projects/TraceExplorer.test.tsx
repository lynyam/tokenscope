import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TracesPage } from "@/pages/projects/TracesPage";
import { listTraces, getModelChoices } from "@/api/traces.api";
import { ApiError } from "@/api/http-client";
import { notifyProjectsChanged } from "@/api/project-events";
import type { Trace, TracePage } from "@/types/trace.types";
import { clearAuthSession, getAuthSessionSnapshot, isAuthSessionCurrent, saveAccessToken } from "@/api/auth-session";

vi.mock("@/api/traces.api", () => ({ listTraces: vi.fn(), getTrace: vi.fn(), getModelChoices: vi.fn() }));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ user: { id: "viewer" }, isLoading: false }),
}));

const listMock = vi.mocked(listTraces);
const choicesMock = vi.mocked(getModelChoices);

const GOLDEN = "?from=2026-10-01T00%3A00%3A00.000Z&to=2026-10-02T00%3A00%3A00.000Z";
const path = (project: string, search = GOLDEN) => `/organizations/o1/projects/${project}/traces${search}`;

function trace(n: number, patch: Partial<Trace> = {}): Trace {
  return {
    id: `t${n}`, projectId: "p1", externalId: `ext-00${n}`, provider: "fixture-a", model: "demo-fast",
    workflow: "Support", inputTokens: 1000, outputTokens: 200, latencyMs: 120, status: "SUCCESS",
    occurredAt: "2026-10-01T10:00:00.000Z", metadata: {}, priceVersionId: "pv",
    pricing: { inputUsdPerMillion: "1.000000", outputUsdPerMillion: "4.000000", currency: "USD", isSynthetic: true },
    inputCostUsd: "0.001000000000", outputCostUsd: "0.000800000000", estimatedCostUsd: "0.001800000000",
    version: 1, createdAt: "x", updatedAt: "x", ...patch,
  };
}
const page = (items: Trace[], extra: Partial<TracePage> = {}): TracePage =>
  ({ items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function Probe() {
  const location = useLocation();
  return <output data-testid="url">{location.pathname + location.search}</output>;
}

function renderAt(initial: string) {
  const tree = () => (
    <MemoryRouter initialEntries={[initial]}>
      <Link to={path("p2")}>go p2</Link>
      <Routes>
        <Route path="/organizations/:organizationId/projects/:projectId/traces" element={<TracesPage />} />
      </Routes>
      <Probe />
    </MemoryRouter>
  );
  const view = render(tree());
  return { ...view, rerenderPage: () => view.rerender(tree()) };
}
const url = () => screen.getByTestId("url").textContent ?? "";
const lastQuery = () => listMock.mock.calls.at(-1)![2];

beforeEach(() => {
  saveAccessToken("explorer-session");
  listMock.mockReset();
  choicesMock.mockReset();
  choicesMock.mockResolvedValue({
    providers: ["fixture-a", "fixture-b"],
    modelsByProvider: { "fixture-a": ["demo-fast"], "fixture-b": ["demo-large"] },
  });
});
afterEach(() => vi.useRealTimers());

it("shows rows, short costs, total and page", async () => {
  listMock.mockResolvedValue(page([trace(1), trace(2, { estimatedCostUsd: "0.000000000000" })], { total: 51, totalPages: 3 }));
  renderAt(path("p1"));
  expect(await screen.findByText("$0.0018")).toBeInTheDocument();
  expect(screen.getByText("$0.00")).toBeInTheDocument();
  expect(screen.getAllByText("2026-10-01 10:00:00 UTC")).toHaveLength(2);
  expect(screen.getByTestId("trace-summary")).toHaveTextContent("51 traces · Page 1 of 3");
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
});

it("resolves the default period once into the URL by replacing", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1", ""));
  await screen.findByText("$0.0018");
  expect(url()).toMatch(/\?from=.*Z&to=.*Z$/);
  expect(listMock).toHaveBeenCalledTimes(1);
  expect(lastQuery().to > lastQuery().from).toBe(true);
});

it("explains empty results without calling them a failure", async () => {
  listMock.mockResolvedValue(page([]));
  renderAt(path("p1"));
  expect(await screen.findByText("No traces match this period and these filters.")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("debounces search into one request and resets the page", async () => {
  listMock.mockResolvedValue(page([trace(1)], { page: 2, total: 60, totalPages: 3 }));
  renderAt(path("p1", GOLDEN + "&page=2"));
  await screen.findByText("$0.0018");
  vi.useFakeTimers();
  const input = screen.getByLabelText("Search");
  fireEvent.change(input, { target: { value: "S" } });
  fireEvent.change(input, { target: { value: "SUPPORT" } });
  expect(listMock).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(listMock).toHaveBeenCalledTimes(2);
  expect(lastQuery()).toMatchObject({ q: "SUPPORT", page: 1 });
  expect(url()).toContain("q=SUPPORT");
  expect(url()).not.toContain("page=");
});

it("keeps a filter chosen while the search timer is pending", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  await screen.findByText("$0.0018");
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "SUPPORT" } });
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "SUCCESS" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(url()).toContain("status=SUCCESS");
  expect(url()).toContain("q=SUPPORT");
  expect(lastQuery()).toMatchObject({ q: "SUPPORT", status: "SUCCESS" });
});

it("keeps the search when the workflow timer fires after it", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  await screen.findByText("$0.0018");
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "SUPPORT" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "billing" } });
  // The search timer fires first and the page renders before the workflow timer does.
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(url()).toContain("q=SUPPORT");
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(url()).toContain("q=SUPPORT");
  expect(url()).toContain("workflow=billing");
  expect(lastQuery()).toMatchObject({ q: "SUPPORT", workflow: "billing" });
});

it("clears the model when the provider changes", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1", GOLDEN + "&provider=fixture-a&model=demo-fast"));
  await screen.findByText("$0.0018");
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "fixture-b" } });
  await waitFor(() => expect(lastQuery()).toMatchObject({ provider: "fixture-b" }));
  expect(lastQuery().model).toBeUndefined();
  expect(screen.getByLabelText("Model")).toHaveValue("");
});

it("sorts by cost descending first, then toggles", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  await screen.findByText("$0.0018");
  fireEvent.click(screen.getByRole("button", { name: "Estimated cost" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ sortBy: "estimatedCostUsd", sortOrder: "desc" }));
  fireEvent.click(await screen.findByRole("button", { name: /Estimated cost/ }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ sortOrder: "asc" }));
});

it("applies a custom period only on Apply and validates it", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  await screen.findByText("$0.0018");
  fireEvent.change(screen.getByLabelText("To (UTC)"), { target: { value: "2026-10-01T00:00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
  expect(await screen.findByText("The end of the period must be after its start.")).toBeInTheDocument();
  expect(listMock).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("To (UTC)"), { target: { value: "2026-10-03T00:00:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply period" }));
  await waitFor(() => expect(lastQuery().to).toBe("2026-10-03T00:00:00.000Z"));
});

it("rejects a malformed link visibly and Reset restores defaults", async () => {
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1", GOLDEN + "&page=0&q=a&q=b"));
  expect(await screen.findByText("This link contains filters that cannot be applied:")).toBeInTheDocument();
  expect(listMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Reset" })[0]);
  await screen.findByText("$0.0018");
  expect(url()).not.toContain("page=");
});

it("never shows project A rows in project B", async () => {
  const a = deferred<TracePage>();
  const b = deferred<TracePage>();
  listMock.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  renderAt(path("p1"));
  await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByText("go p2"));
  await act(async () => { b.resolve(page([trace(2, { workflow: "B-work" })])); });
  await act(async () => { a.resolve(page([trace(1, { workflow: "A-work" })])); });
  expect(await screen.findByText("B-work")).toBeInTheDocument();
  expect(screen.queryByText("A-work")).not.toBeInTheDocument();
});

it("hides old rows when the query changes but keeps them on a same-query refresh", async () => {
  listMock.mockResolvedValueOnce(page([trace(1, { workflow: "First" })]));
  renderAt(path("p1"));
  await screen.findByText("First");

  const refresh = deferred<TracePage>();
  listMock.mockReturnValueOnce(refresh.promise);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByText("Updating…")).toBeInTheDocument();
  expect(screen.getByText("First")).toBeInTheDocument();
  await act(async () => { refresh.resolve(page([trace(1, { workflow: "First" })])); });
  await waitFor(() => expect(screen.queryByText("Updating…")).not.toBeInTheDocument());

  const changed = deferred<TracePage>();
  listMock.mockReturnValueOnce(changed.promise);
  fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ERROR" } });
  await waitFor(() => expect(screen.queryByText("First")).not.toBeInTheDocument());
  expect(screen.getByText("Loading traces…")).toBeInTheDocument();
  await act(async () => {
    changed.resolve(page([]));
  });
});

it("recovers an out-of-range page once through a replace", async () => {
  listMock.mockImplementation(async (_o, _p, query) =>
    query.page > 2 ? page([], { page: query.page, total: 50, totalPages: 2 }) : page([trace(1)], { page: query.page, total: 50, totalPages: 2 }));
  renderAt(path("p1", GOLDEN + "&page=3"));
  await screen.findByText("$0.0018");
  expect(url()).toContain("page=2");
  expect(listMock).toHaveBeenCalledTimes(2);
});

it("shows a validation failure without hiding the filters", async () => {
  listMock.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "Bad filters", [{ field: "q", messages: ["q is too long"] }]));
  renderAt(path("p1"));
  expect(await screen.findByText("q is too long")).toBeInTheDocument();
  expect(screen.getByLabelText("Search")).toBeInTheDocument();
});

it("waits out a rate limit without retrying on its own", async () => {
  vi.useFakeTimers();
  listMock.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "slow"));
  renderAt(path("p1"));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("button", { name: /Retry in \d+s/ })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(11_000); });
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(listMock).toHaveBeenCalledTimes(1);
});

it("uses the server's Retry-After for the cooldown", async () => {
  vi.useFakeTimers();
  listMock.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "slow", undefined, undefined, 3));
  renderAt(path("p1"));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole("button", { name: "Retry in 3s" })).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(listMock).toHaveBeenCalledTimes(1);
});

it("shows an unavailable state for a missing project and when it is archived here", async () => {
  listMock.mockRejectedValueOnce(new ApiError(404, "PROJECT_NOT_FOUND", "nope"));
  const first = renderAt(path("p1"));
  expect(await screen.findByText("This project is not available.")).toBeInTheDocument();
  first.unmount();

  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  await screen.findByText("$0.0018");
  act(() => notifyProjectsChanged({ organizationId: "o1", kind: "archive", projectId: "p1" }));
  expect(await screen.findByText("This project is not available.")).toBeInTheDocument();
});

it("keeps the list usable when the catalogue fails", async () => {
  choicesMock.mockRejectedValue(new ApiError(500, "X", "boom", undefined, "req-catalogue"),);
  listMock.mockResolvedValue(page([]));
  renderAt(path("p1"));

  // Catalogue loading fails asynchronously.
  // Wait until React displays the resulting error and request ID.
  expect(
    await screen.findByText("Request ID: req-catalogue"),
  ).toBeInTheDocument();
  expect(await screen.findByText("Provider and model choices could not be loaded.")).toBeInTheDocument();
  expect(await screen.findByText("No traces match this period and these filters.")).toBeInTheDocument();
  within(screen.getByLabelText("Trace filters")).getByRole("button", { name: "Retry choices" });
});
it("preserves exact milliseconds when applying an unchanged period", async () => {
  listMock.mockResolvedValue(page([]));
  renderAt(path("p1", GOLDEN.replaceAll(".000Z", ".123Z")));

  await screen.findByText(
    "No traces match this period and these filters.",
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Apply period" }),
  );

  expect(
    new URLSearchParams(url().split("?")[1]).get("from"),
  ).toBe("2026-10-01T00:00:00.123Z");

  expect(listMock).toHaveBeenCalledTimes(1);
});

it("Reset cancels unapplied search and workflow drafts", async () => {
  listMock.mockResolvedValue(page([]));
  renderAt(path("p1"));

  await screen.findByText(
    "No traces match this period and these filters.",
  );

  vi.useFakeTimers();

  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: "stale" },
  });
  fireEvent.change(screen.getByLabelText("Workflow"), {
    target: { value: "stale-work" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

  expect(lastQuery().q).toBeUndefined();
  expect(lastQuery().workflow).toBeUndefined();
  expect(screen.getByLabelText("Search")).toHaveValue("");
  expect(screen.getByLabelText("Workflow")).toHaveValue("");
});

it("changing filters cannot bypass the rate-limit deadline", async () => {
  vi.useFakeTimers();

  listMock.mockRejectedValue(
    new ApiError(
      429, "RATE_LIMITED", "slow",
      undefined, "req-limit", 3,
    ),
  );

  renderAt(path("p1"));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });

  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "ERROR" },
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(listMock).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Retry in 2s" }),
  ).toBeDisabled();
  expect(
    screen.getByText("Request ID: req-limit"),
  ).toBeInTheDocument();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });

  expect(listMock).toHaveBeenCalledTimes(1);

  listMock.mockResolvedValueOnce(page([]));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

  expect(lastQuery().status).toBe("ERROR");
  expect(listMock).toHaveBeenCalledTimes(2);
});

it("discards a response from a superseded login", async () => {
  saveAccessToken("session-a");

  const pending = deferred<TracePage>();
  listMock.mockReturnValueOnce(pending.promise);
  renderAt(path("p1"));

  saveAccessToken("session-b");

  await act(async () => {
    pending.resolve(
      page([trace(1, { workflow: "old-private-data" })]),
    );
  });

  expect(
    screen.queryByText("old-private-data"),
  ).not.toBeInTheDocument();
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
  setVisibility("visible");
  realtime.handlers = null;
  realtime.enabled = true;
});

async function flush(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function notify(kind: "onChanged" | "onSynced" | "onRevoked") {
  act(() => { realtime.handlers![kind](); });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

// Opens the list with the first read settled, under a controlled clock.
async function openLoaded(search = GOLDEN, rows = page([trace(1)])) {
  vi.useFakeTimers();
  listMock.mockResolvedValueOnce(rows);
  const view = renderAt(path("p1", search));
  await flush();
  expect(listMock).toHaveBeenCalledTimes(1);
  return view;
}

it("refreshes after a notice with the same applied query, keeping the rows meanwhile", async () => {
  await openLoaded(GOLDEN + "&q=SUPPORT&page=2", page([trace(1)], { page: 2, total: 60, totalPages: 3 }));
  const firstQuery = lastQuery();
  const next = deferred<TracePage>();
  listMock.mockReturnValueOnce(next.promise);
  notify("onChanged");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  expect(lastQuery()).toEqual(firstQuery); // same instants, filters and page
  expect(screen.getByText("Updating…")).toBeInTheDocument();
  expect(screen.getByText("$0.0018")).toBeInTheDocument(); // confirmed rows stay visible
  await act(async () => {
    next.resolve(page([trace(1), trace(9, { workflow: "New-row" })], { page: 2, total: 61, totalPages: 3 }));
  });
  expect(screen.queryByText("Updating…")).not.toBeInTheDocument();
  expect(screen.getByTestId("trace-summary")).toHaveTextContent("61 traces · Page 2 of 3");
  expect(screen.getByText("New-row")).toBeInTheDocument();
  expect(url()).toContain("q=SUPPORT");
  expect(url()).toContain("page=2");
});

it("does not resolve the default period again on a notice", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00.000Z"));
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1", ""));
  await flush();
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(1);
  const first = lastQuery();
  vi.setSystemTime(new Date("2026-10-21T11:00:00.000Z"));
  notify("onChanged");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  expect(lastQuery().from).toBe(first.from);
  expect(lastQuery().to).toBe(first.to);
});

it("coalesces a burst of notices and an acknowledgement into one read", async () => {
  await openLoaded();
  listMock.mockResolvedValue(page([trace(1)]));
  act(() => {
    realtime.handlers!.onChanged();
    realtime.handlers!.onChanged();
    realtime.handlers!.onSynced();
  });
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(2);
});

it("queues exactly one follow-up when a notice arrives during a read", async () => {
  await openLoaded();
  const slow = deferred<TracePage>();
  listMock.mockReturnValueOnce(slow.promise).mockResolvedValue(page([trace(1)]));
  notify("onChanged");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  notify("onChanged");
  notify("onChanged");
  notify("onChanged");
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(2); // still one read at a time
  await act(async () => { slow.resolve(page([trace(1)])); });
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(3); // one follow-up, not three
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(3);
});

it("recovers once to the last valid page after a deletion, keeping the query", async () => {
  await openLoaded(GOLDEN + "&q=SUPPORT&page=3", page([trace(1)], { page: 3, total: 51, totalPages: 3 }));
  listMock
    .mockResolvedValueOnce(page([], { page: 3, total: 50, totalPages: 2 }))
    .mockResolvedValueOnce(page([trace(2)], { page: 2, total: 50, totalPages: 2 }));
  notify("onChanged");
  await flush(300);
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(3);
  expect(url()).toContain("page=2");
  expect(url()).toContain("q=SUPPORT");
  expect(lastQuery()).toMatchObject({ q: "SUPPORT", page: 2 });
  expect(screen.getByTestId("trace-summary")).toHaveTextContent("50 traces · Page 2 of 2");
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(3); // no pagination loop
});

it("keeps the confirmed rows with an error and a deliberate Retry after a transient failure", async () => {
  await openLoaded();
  listMock.mockRejectedValueOnce(new ApiError(500, "INTERNAL_SERVER_ERROR", "boom", undefined, "req-500"));
  notify("onChanged");
  await flush(300);
  expect(screen.getByText("$0.0018")).toBeInTheDocument(); // not turned into an empty result
  expect(screen.queryByText("No traces match this period and these filters.")).not.toBeInTheDocument();
  expect(screen.getByText("Request ID: req-500")).toBeInTheDocument();
  await flush(5000);
  expect(listMock).toHaveBeenCalledTimes(2); // no automatic retry loop
  listMock.mockResolvedValueOnce(page([trace(1), trace(7, { workflow: "Back-again" })]));
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(3);
  expect(screen.getByText("Back-again")).toBeInTheDocument();
  expect(screen.queryByText("Request ID: req-500")).not.toBeInTheDocument();
});

it("does not read again before the Retry-After deadline, whatever the trigger", async () => {
  await openLoaded();
  listMock.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "slow", undefined, undefined, 10));
  notify("onChanged");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  listMock.mockResolvedValue(page([trace(1, { workflow: "After-limit" })]));
  notify("onChanged");
  notify("onSynced");
  await flush(5000);
  expect(listMock).toHaveBeenCalledTimes(2); // deadline not reached
  await flush(5500);
  expect(listMock).toHaveBeenCalledTimes(3); // one read once the deadline has passed
  expect(screen.getByText("After-limit")).toBeInTheDocument();
});

it("does not read while the tab is hidden and reads once when it is visible again", async () => {
  await openLoaded();
  setVisibility("hidden");
  listMock.mockResolvedValue(page([trace(1, { workflow: "While-hidden" })]));
  notify("onChanged");
  notify("onChanged");
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(2);
  expect(screen.getByText("While-hidden")).toBeInTheDocument();
});

it("clears the rows when access is revoked and keeps the signed-in session", async () => {
  await openLoaded();
  const session = getAuthSessionSnapshot();
  notify("onRevoked");
  expect(screen.getByText("This project is not available.")).toBeInTheDocument();
  expect(screen.queryByText("$0.0018")).not.toBeInTheDocument();
  expect(realtime.enabled).toBe(false);
  expect(isAuthSessionCurrent(session)).toBe(true);
  notify("onChanged");
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(1);
});

it("drops queued work and shows nothing of project A after switching to project B", async () => {
  await openLoaded(GOLDEN, page([trace(1, { workflow: "A-work" })]));
  listMock.mockResolvedValue(page([trace(2, { workflow: "B-work" })]));
  notify("onChanged"); // a refresh of project A is queued...
  fireEvent.click(screen.getByText("go p2")); // ...and the person leaves before it runs
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(2); // first read of A + first read of B, nothing else
  expect(screen.queryByText("A-work")).not.toBeInTheDocument();
  expect(screen.getByText("B-work")).toBeInTheDocument();
});

it("cleans up on unmount: no read after leaving the page", async () => {
  const view = await openLoaded();
  notify("onChanged");
  view.unmount();
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(1);
});

it("cancelling a read in flight causes no unhandled rejection", async () => {
  const view = await openLoaded();
  listMock.mockImplementationOnce((_o, _p, _q, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  notify("onChanged");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(2);
  view.unmount(); // aborts the read: vitest fails the run on an unhandled rejection
  await flush(1);
});

it("clears confirmed rows before loading the same query for a new session", async () => {
  const view = await openLoaded(GOLDEN, page([trace(1, { workflow: "Old-session-private" })]));
  const next = deferred<TracePage>();
  listMock.mockReturnValueOnce(next.promise);
  saveAccessToken("replacement-session");
  view.rerenderPage();
  expect(screen.queryByText("Old-session-private")).not.toBeInTheDocument();
  await flush();
  expect(screen.queryByText("Old-session-private")).not.toBeInTheDocument();
  expect(listMock).toHaveBeenCalledTimes(2);
  await act(async () => { next.resolve(page([trace(2, { workflow: "New-session-data" })])); });
  expect(screen.getByText("New-session-data")).toBeInTheDocument();
});

it("invalidation cancels queued reads and the catalogue without starting tokenless work", async () => {
  const catalogue = deferred<Awaited<ReturnType<typeof getModelChoices>>>();
  choicesMock.mockReturnValueOnce(catalogue.promise);
  await openLoaded();
  const catalogueSignal = choicesMock.mock.calls[0][0];
  notify("onChanged");
  act(() => { clearAuthSession(); });
  await flush(2000);
  expect(listMock).toHaveBeenCalledTimes(1);
  expect(choicesMock).toHaveBeenCalledTimes(1);
  expect(catalogueSignal?.aborted).toBe(true);
  expect(realtime.enabled).toBe(false);
  expect(screen.queryByText("$0.0018")).not.toBeInTheDocument();
  await act(async () => { catalogue.resolve({ providers: [], modelsByProvider: {} }); });
});

it("defers even the first list read while hidden, then reconciles once", async () => {
  vi.useFakeTimers();
  setVisibility("hidden");
  listMock.mockResolvedValue(page([trace(1)]));
  renderAt(path("p1"));
  notify("onSynced");
  await flush(2000);
  expect(listMock).not.toHaveBeenCalled();
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(1);
});

it("does not turn notices into hidden-tab retries after the first read fails", async () => {
  vi.useFakeTimers();
  listMock.mockRejectedValueOnce(new ApiError(503, "UNAVAILABLE", "Unavailable"));
  renderAt(path("p1"));
  await flush();
  setVisibility("hidden");
  listMock.mockResolvedValue(page([trace(1)]));
  notify("onChanged");
  await flush(300);
  notify("onSynced");
  await flush(300);
  expect(listMock).toHaveBeenCalledTimes(1);
  setVisibility("visible");
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await flush(1);
  expect(listMock).toHaveBeenCalledTimes(2);
});
