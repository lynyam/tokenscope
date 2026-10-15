import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TracesPage } from "@/pages/projects/TracesPage";
import { listTraces, getModelChoices } from "@/api/traces.api";
import { ApiError } from "@/api/http-client";
import { notifyProjectsChanged } from "@/api/project-events";
import type { Trace, TracePage } from "@/types/trace.types";

vi.mock("@/api/traces.api", () => ({ listTraces: vi.fn(), getTrace: vi.fn(), getModelChoices: vi.fn() }));

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
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Link to={path("p2")}>go p2</Link>
      <Routes>
        <Route path="/organizations/:organizationId/projects/:projectId/traces" element={<TracesPage />} />
      </Routes>
      <Probe />
    </MemoryRouter>,
  );
}
const url = () => screen.getByTestId("url").textContent ?? "";
const lastQuery = () => listMock.mock.calls.at(-1)![2];

beforeEach(() => {
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
  expect(listMock).toHaveBeenCalledTimes(2);
  expect(lastQuery()).toMatchObject({ q: "SUPPORT", page: 1 });
  expect(url()).toContain("q=SUPPORT");
  expect(url()).not.toContain("page=");
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
  choicesMock.mockRejectedValue(new ApiError(500, "X", "boom"));
  listMock.mockResolvedValue(page([]));
  renderAt(path("p1"));
  expect(await screen.findByText("Provider and model choices could not be loaded.")).toBeInTheDocument();
  expect(await screen.findByText("No traces match this period and these filters.")).toBeInTheDocument();
  within(screen.getByLabelText("Trace filters")).getByRole("button", { name: "Retry choices" });
});
