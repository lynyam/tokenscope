import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { TraceDetailPage } from "@/pages/projects/TraceDetailPage";
import { getTrace } from "@/api/traces.api";
import { ApiError } from "@/api/http-client";
import type { Trace } from "@/types/trace.types";
import { saveAccessToken } from "@/api/auth-session";
import { notifyProjectsChanged } from "@/api/project-events";

vi.mock("@/api/traces.api", () => ({ listTraces: vi.fn(), getTrace: vi.fn(), getModelChoices: vi.fn() }));
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
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/organizations/o1/projects/p1/traces/t1", state }]}>
      <Routes>
        <Route path="/organizations/:organizationId/projects/:projectId/traces/:traceId" element={<TraceDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => getMock.mockReset());

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
