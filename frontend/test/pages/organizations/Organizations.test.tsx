import {
  act,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationsPage } from "@/pages/organizations/OrganizationsPage";
import { OrganizationDetailPage } from "@/pages/organizations/OrganizationDetailPage";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import type { OrganizationSummary } from "@/types/workspace.types";

const organization: OrganizationSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Acme AI",
  slug: "acme-ai",
  currentUserRole: "OWNER",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const otherOrganization: OrganizationSummary = {
  ...organization,
  id: "00000000-0000-4000-8000-000000000002",
  name: "Other workspace",
  slug: "other-workspace",
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderPage(path = "/organizations") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to={`/organizations/${otherOrganization.id}`}>
        Open other organization
      </Link>
      <Routes>
        <Route path="/organizations" element={<OrganizationsPage />} />
        <Route
          path="/organizations/:organizationId"
          element={<OrganizationDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("organization-ui-test-token");
});

describe("organization screens with the real HTTP adapter", () => {
  it("shows loading before a genuinely empty list", async () => {
    let finish!: (response: Response) => void;

    fetchMock.mockReturnValueOnce(
      new Promise(resolve => { finish = resolve; }),
    );

    renderPage();

    expect(
      screen.getByRole("status", { name: "Loading organizations" }),
    ).toBeInTheDocument();

    await act(async () => finish(json([])));

    expect(screen.getByText("No organizations yet."))
      .toBeInTheDocument();
  });

  it("prevents duplicate creation and displays the server result", async () => {
    let finish!: (response: Response) => void;

    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockReturnValueOnce(
        new Promise(resolve => { finish = resolve; }),
      );

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("No organizations yet.");
    await user.type(screen.getByLabelText("Organization name"), "Acme AI");

    const form = screen
      .getByRole("button", { name: "Create" })
      .closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(fetchMock).toHaveBeenCalledTimes(2); // One GET and one POST.
    expect(screen.getByRole("button", { name: "Creating…" }))
      .toBeDisabled();
    expect(screen.getByLabelText("Organization name")).toBeDisabled();

    await act(async () => finish(json(organization, 201)));

    expect(
      await screen.findByRole("link", { name: /Acme AI/ }),
    ).toHaveAttribute("href", `/organizations/${organization.id}`);

    expect(screen.getByLabelText("Organization name")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it.each([
    [400, "VALIDATION_ERROR", "Name was rejected."],
    [409, "ORGANIZATION_SLUG_CONFLICT", "An organization already uses this slug."],
    [503, "SERVICE_UNAVAILABLE", "Service unavailable."],
  ] as const)(
    "preserves the list and form after creation fails with %i",
    async (status, code, message) => {
      fetchMock
        .mockResolvedValueOnce(json([organization]))
        .mockResolvedValueOnce(
          json(
            {
              code,
              message: status === 400
                ? "Request validation failed."
                : message,
              details: status === 400
                ? [{ field: "name", messages: [message] }]
                : undefined,
            },
            status,
          ),
        );

      const user = userEvent.setup();
      renderPage();

      await screen.findByRole("link", { name: /Acme AI/ });
      await user.type(
        screen.getByLabelText("Organization name"),
        "New organization",
      );
      await user.click(screen.getByRole("button", { name: "Create" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.getByRole("link", { name: /Acme AI/ }))
        .toBeInTheDocument();
      expect(screen.getByLabelText("Organization name"))
        .toHaveValue("New organization");
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
      expect(getAccessToken()).toBe("organization-ui-test-token");
    },
  );

  it("displays a load failure and lets the user retry", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(json([]));

    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Unable to reach the server");
    expect(screen.queryByText("No organizations yet."))
      .not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No organizations yet."))
      .toBeInTheDocument();
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });

  it("shows an inaccessible organization's 404 without clearing authentication", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        {
          code: "ORGANIZATION_NOT_FOUND",
          message: "Organization not found.",
        },
        404,
      ),
    );

    renderPage(`/organizations/${organization.id}`);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Organization not found.");
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });

  it("ignores the previous organization's late response after navigation", async () => {
    let finishOldRequest!: (response: Response) => void;

    fetchMock
      .mockReturnValueOnce(
        new Promise(resolve => { finishOldRequest = resolve; }),
      )
      .mockResolvedValueOnce(json(otherOrganization));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const oldSignal = fetchMock.mock.calls[0][1]?.signal;

    await user.click(
      screen.getByRole("link", { name: "Open other organization" }),
    );

    await screen.findByText(otherOrganization.name);
    expect(oldSignal?.aborted).toBe(true);

    // The stub deliberately resolves despite cancellation to exercise the guard.
    await act(async () => finishOldRequest(json(organization)));

    expect(screen.getByText(otherOrganization.name)).toBeInTheDocument();
    expect(screen.queryByText(organization.name)).not.toBeInTheDocument();
  });

  it("refreshes the switcher when opened", async () => {
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockImplementation(async () => json([organization]));

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OrganizationSwitcher />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Choose organization" }),
    );

    expect(
      await screen.findByRole("menuitem", { name: "Acme AI" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not present a switcher failure as an empty membership list", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"));

    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <OrganizationSwitcher />
      </MemoryRouter>,
    );

    await user.click(
      screen.getByRole("button", { name: "Choose organization" }),
    );

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Unable to reach the server");
    expect(screen.queryByText("No organizations yet."))
      .not.toBeInTheDocument();
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });

  it("rejects a whitespace-only name without sending a creation request", async () => {
    fetchMock.mockResolvedValueOnce(json([organization]));

    renderPage();
    await screen.findByRole("link", { name: /Acme AI/ });

    const input = screen.getByLabelText("Organization name");

    // Prepare the invalid value without simulating individual keystrokes.
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Organization name is required.");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "org-name-error");
    expect(input).toHaveValue("   ");

    expect(screen.getByRole("link", { name: /Acme AI/ }))
      .toBeInTheDocument();

    // Only the initial list GET should have reached the network boundary.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});
