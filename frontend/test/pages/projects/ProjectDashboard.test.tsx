import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { ProjectDashboard, type DashboardHandoff } from "@/pages/projects/ProjectDashboard";
import { ApiError } from "@/api/http-client";
import { saveAccessToken } from "@/api/auth-session";
import type { ProjectRealtimeHandlers } from "@/hooks/useProjectRealtime";
import type { AppliedSelection } from "@/types/analytics.types";
import { readEvaluationFixture } from "../../api/helpers/evaluation-fixtures";

vi.mock("@/api/analytics.api", async original => ({
  ...await original<typeof import("@/api/analytics.api")>(), getAnalytics: vi.fn(),
}));
vi.mock("@/api/traces.api", () => ({ getModelChoices: vi.fn() }));
vi.mock("@/pages/projects/DashboardCharts", () => ({ DashboardCharts: () => <div>Charts</div> }));
let handlers: ProjectRealtimeHandlers;
vi.mock("@/hooks/useProjectRealtime", () => ({
  useProjectRealtime: (_o: string, _p: string, value: ProjectRealtimeHandlers) => { handlers = value; return "live"; },
}));
import { getAnalytics } from "@/api/analytics.api";
import { getModelChoices } from "@/api/traces.api";
const golden = JSON.parse(readEvaluationFixture("responses/analytics-golden.json"));
const from = "2026-10-01T00:00:30.123Z";
const to = "2026-10-02T00:00:30.456Z";
const path = `/?from=${from}&to=${to}`;
const extras = vi.fn((_handoff: DashboardHandoff) => <div>Assistant placeholder</div>);
function Location() { return <output data-testid="url">{useLocation().search}</output>; }
function view(search = path, onUnavailable = vi.fn()) {
  return render(<MemoryRouter initialEntries={[search]}><Location />
    <ProjectDashboard organizationId="o" projectId="p" renderExtras={extras} onUnavailable={onUnavailable} />
  </MemoryRouter>);
}
async function flush(ms = 0) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
const lastSelection = () => vi.mocked(getAnalytics).mock.calls.at(-1)![0];
beforeEach(() => {
  vi.useFakeTimers();
  saveAccessToken("current");
  extras.mockClear();
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  vi.mocked(getModelChoices).mockReset().mockResolvedValue({ providers: ["fixture-a"], modelsByProvider: { "fixture-a": ["demo-fast"] } });
  vi.mocked(getAnalytics).mockReset().mockImplementation(async (selection: AppliedSelection) => ({
    ...golden, projectId: selection.projectId,
    window: { ...golden.window, from: selection.from, to: selection.to },
    filters: { ...golden.filters, ...selection.filters },
  }));
});
afterEach(() => { vi.useRealTimers(); });

it("preserves shared URL filters and exact milliseconds on unchanged Apply", async () => {
  view(path + "&q=support&status=ERROR"); await flush();
  expect(lastSelection().filters).toEqual({ q: "support", status: "ERROR" });
  fireEvent.click(screen.getByRole("button", { name: "Apply period" })); await flush();
  expect(lastSelection()).toMatchObject({ from, to });
  expect(screen.getByTestId("applied-period")).toHaveTextContent(from);
});

it("Reset discards pending search and workflow drafts", async () => {
  view(); await flush();
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "unapplied" } });
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "pending" } });
  fireEvent.click(screen.getByRole("button", { name: "Reset" })); await flush(500);
  expect(lastSelection().filters).toEqual({});
  expect(screen.getByLabelText("Search")).toHaveValue("");
  expect(screen.getByLabelText("Workflow")).toHaveValue("");
});

it("concurrent debounced edits preserve both filters", async () => {
  view(); await flush();
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "support" } });
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: "chat" } });
  await flush(500);
  await flush();
  expect(lastSelection().filters).toMatchObject({ q: "support", workflow: "chat" });
});

it("clears an incompatible model on provider change", async () => {
  view(path + "&provider=fixture-a&model=demo-fast"); await flush();
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "" } }); await flush();
  expect(lastSelection().filters).toEqual({});
});

it("reports invalid links without fetching analytics", async () => {
  view("/?from=bad&to=bad"); await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("UTC instant");
  expect(getAnalytics).not.toHaveBeenCalled();
});

it("keeps the snapshot usable when the catalogue fails, including its request ID", async () => {
  vi.mocked(getModelChoices).mockRejectedValue(new ApiError(503, "INTERNAL_SERVER_ERROR", "Unavailable", undefined, "req-catalogue"));
  view(); await flush();
  expect(screen.getByText("Request ID: req-catalogue")).toBeInTheDocument();
  expect(screen.getByText("6,000")).toBeInTheDocument();
});

it("refreshing preserves the selection object; access loss removes the handoff", async () => {
  const unavailable = vi.fn(); view(path, unavailable); await flush();
  const first = extras.mock.calls.at(-1)![0];
  expect(first.exportEnabled).toBe(true);
  act(() => handlers.onChanged()); await flush(300);
  expect(extras.mock.calls.at(-1)![0].selection).toBe(first.selection);
  act(() => handlers.onRevoked()); await flush();
  expect(screen.queryByText("Assistant placeholder")).not.toBeInTheDocument();
  expect(screen.queryByTestId("metric")).not.toBeInTheDocument();
  expect(unavailable).toHaveBeenCalled();
});

it("shows No observations for null averages and rates", async () => {
  vi.mocked(getAnalytics).mockResolvedValue({ ...golden, summary: { ...golden.summary, traceCount: 0, averageLatencyMs: null, errorRatePct: null } });
  view(); await flush();
  expect(screen.getAllByText("No observations")).toHaveLength(2);
  expect(extras.mock.calls.at(-1)![0].exportEnabled).toBe(true);
});
