import {
  act,
  fireEvent,
  render,
  screen,
  within,
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
describe("organization rename with the real HTTP adapter", () => {
  it("sends one PATCH, uses the server result, and resets cancelled edits", async () => {
    let finish!: (response: Response) => void;
    const updated = { ...organization, name: "New Acme" };

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockImplementationOnce(
        () => new Promise(resolve => { finish = resolve; }),
      );

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Rename" }),
    );

    const input = screen.getByLabelText("Organization name");
    expect(input).toHaveValue(organization.name);

    fireEvent.change(input, { target: { value: "  New Acme  " } });

    // Exercise two submissions within one React batch, before a rerender.
    act(() => {
      fireEvent.submit(input.closest("form")!);
      fireEvent.submit(input.closest("form")!);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // One GET and one PATCH.
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/v1/organizations/${organization.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ name: "New Acme" }),
      }),
    );

    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => { finish(json(updated)); });

    expect(await screen.findByText(updated.name)).toBeInTheDocument();
    expect(screen.getByText(organization.slug)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Organization name"))
      .toHaveValue(updated.name);

    fireEvent.change(screen.getByLabelText("Organization name"), {
      target: { value: "Discard this" },
    });

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Rename" }));

    expect(screen.getByLabelText("Organization name"))
      .toHaveValue(updated.name);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["ADMIN", "MEMBER"] as const)(
    "hides rename for %s",
    async role => {
      fetchMock.mockResolvedValueOnce(
        json({ ...organization, currentUserRole: role }),
      );

      renderPage(`/organizations/${organization.id}`);

      await screen.findByText(organization.name);
      expect(screen.queryByRole("button", { name: "Rename" }))
        .not.toBeInTheDocument();
    },
  );

  it.each([
    ["   ", "Organization name is required."],
    ["x".repeat(101), "Organization name must not exceed 100 characters."],
  ])("rejects invalid rename input %s", async (value, message) => {
    fetchMock.mockResolvedValueOnce(json(organization));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Rename" }),
    );

    const input = screen.getByLabelText("Organization name");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [400, "VALIDATION_ERROR", "Name was rejected."],
    [
      403,
      "INSUFFICIENT_ORGANIZATION_ROLE",
      "Only owners can rename this organization.",
    ],
    [404, "ORGANIZATION_NOT_FOUND", "Organization not found."],
    [503, "SERVICE_UNAVAILABLE", "Service unavailable."],
  ] as const)(
    "preserves the draft, organization and session after %i",
    async (status, code, message) => {
      fetchMock
        .mockResolvedValueOnce(json(organization))
        .mockResolvedValueOnce(json({
          code,
          message: status === 400
            ? "Request validation failed."
            : message,
          details: status === 400
            ? [{ field: "name", messages: [message] }]
            : undefined,
        }, status));

      const user = userEvent.setup();
      renderPage(`/organizations/${organization.id}`);

      await user.click(
        await screen.findByRole("button", { name: "Rename" }),
      );

      const input = screen.getByLabelText("Organization name");
      fireEvent.change(input, { target: { value: "Kept draft" } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveValue("Kept draft");
      expect(input).toBeEnabled();
      expect(screen.getByText(organization.slug)).toBeInTheDocument();
      expect(getAccessToken()).toBe("organization-ui-test-token");
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(screen.getByText(organization.name)).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("keeps the draft after a connection failure and allows a manual retry", async () => {
    const updated = { ...organization, name: "Retried name" };

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(json(updated));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Rename" }),
    );

    const input = screen.getByLabelText("Organization name");
    fireEvent.change(input, { target: { value: updated.name } });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Unable to reach the server");
    expect(input).toHaveValue(updated.name);
    expect(getAccessToken()).toBe("organization-ui-test-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(updated.name)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not apply a late rename response to another organization", async () => {
    let finish!: (response: Response) => void;

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockImplementationOnce(
        () => new Promise(resolve => { finish = resolve; }),
      )
      .mockResolvedValueOnce(json(otherOrganization));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Rename" }),
    );

    const input = screen.getByLabelText("Organization name");
    fireEvent.change(input, {
      target: { value: "Old organization renamed" },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    const oldSignal = fetchMock.mock.calls[1][1]?.signal;

    await user.click(
      screen.getByRole("link", { name: "Open other organization" }),
    );

    await screen.findByText(otherOrganization.name);
    expect(oldSignal?.aborted).toBe(true);

    // The stub ignores cancellation so the page's stale-response guard is tested.
    await act(async () => {
      finish(json({
        ...organization,
        name: "Old organization renamed",
      }));
    });

    expect(screen.getByText(otherOrganization.name)).toBeInTheDocument();
    expect(screen.queryByText("Old organization renamed"))
      .not.toBeInTheDocument();
    expect(screen.queryByLabelText("Organization name"))
      .not.toBeInTheDocument();
  });
});

describe("organization deletion with the real HTTP adapter", () => {
  const deleteUrl = `/api/v1/organizations/${organization.id}`;

  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );
    return screen.findByRole("dialog");
  }

  it.each(["ADMIN", "MEMBER"] as const)("hides deletion for %s", async role => {
    fetchMock.mockResolvedValueOnce(
      json({ ...organization, currentUserRole: role }),
    );

    renderPage(`/organizations/${organization.id}`);

    await screen.findByText(organization.name);
    expect(screen.queryByRole("button", { name: "Delete organization" }))
      .not.toBeInTheDocument();
  });

  it("enables deletion only for the exact slug and resets cancelled input", async () => {
    fetchMock.mockResolvedValueOnce(json(organization));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const dialog = within(await openDialog(user));
    const input = dialog.getByLabelText("Organization slug");
    const submit = dialog.getByRole("button", { name: "Delete organization" });

    expect(submit).toBeDisabled();

    for (const wrong of ["ACME-AI", "acme-ai ", " acme-ai", "acme", "   "]) {
      fireEvent.change(input, { target: { value: wrong } });
      expect(submit).toBeDisabled();
    }

    fireEvent.change(input, { target: { value: "acme-ai" } });
    expect(submit).toBeEnabled();

    await user.click(dialog.getByRole("button", { name: "Cancel" }));

    const reopened = within(await openDialog(user));
    expect(reopened.getByLabelText("Organization slug")).toHaveValue("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends one DELETE with the exact slug, blocks controls, then returns to the list", async () => {
    let finish!: (response: Response) => void;

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockImplementationOnce(
        () => new Promise(resolve => { finish = resolve; }),
      )
      .mockResolvedValueOnce(json([]));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const dialog = within(await openDialog(user));
    const input = dialog.getByLabelText("Organization slug");
    fireEvent.change(input, { target: { value: "acme-ai" } });

    // Two submissions inside one React batch must still send one request.
    act(() => {
      fireEvent.submit(input.closest("form")!);
      fireEvent.submit(input.closest("form")!);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2); // One GET and one DELETE.
    expect(fetchMock).toHaveBeenLastCalledWith(
      deleteUrl,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ confirmSlug: "acme-ai" }),
      }),
    );

    expect(input).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await act(async () => { finish(new Response(null, { status: 204 })); });

    expect(await screen.findByText("No organizations yet."))
      .toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });

  it.each([
    [409, "ORGANIZATION_CONFIRMATION_MISMATCH", "The confirmation does not match."],
    [409, "CONCURRENT_MODIFICATION", "The organization was modified concurrently."],
    [503, "SERVICE_UNAVAILABLE", "Service unavailable."],
  ] as const)(
    "keeps the dialog, typed slug and session after %i %s",
    async (status, code, message) => {
      fetchMock
        .mockResolvedValueOnce(json(organization))
        .mockResolvedValueOnce(json({ code, message }, status));

      const user = userEvent.setup();
      renderPage(`/organizations/${organization.id}`);

      const dialog = within(await openDialog(user));
      const input = dialog.getByLabelText("Organization slug");
      fireEvent.change(input, { target: { value: "acme-ai" } });
      await user.click(dialog.getByRole("button", { name: "Delete organization" }));

      expect(await dialog.findByRole("alert")).toHaveTextContent(message);
      expect(input).toHaveValue("acme-ai");
      expect(input).toBeEnabled();
      expect(getAccessToken()).toBe("organization-ui-test-token");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("closes the dialog and reloads the role after 403 INSUFFICIENT_ORGANIZATION_ROLE", async () => {
    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockResolvedValueOnce(json({
        code: "INSUFFICIENT_ORGANIZATION_ROLE",
        message: "Only owners can delete this organization.",
      }, 403))
      .mockResolvedValueOnce(json({ ...organization, currentUserRole: "ADMIN" }));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const dialog = within(await openDialog(user));
    fireEvent.change(dialog.getByLabelText("Organization slug"), {
      target: { value: "acme-ai" },
    });
    await user.click(dialog.getByRole("button", { name: "Delete organization" }));

    // The effective role is reloaded from the server.
    expect(await screen.findByText("ADMIN")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete organization" }))
      .not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3); // GET, DELETE, GET again.
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });
    it("blocks deletion while a rename is pending", async () => {
    let finish!: (response: Response) => void;

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockImplementationOnce(
        () => new Promise(resolve => { finish = resolve; }),
      );

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    await user.click(await screen.findByRole("button", { name: "Rename" }));
    const nameInput = screen.getByLabelText("Organization name");
    fireEvent.change(nameInput, { target: { value: "Acme Renamed" } });
    act(() => { fireEvent.submit(nameInput.closest("form")!); });

    // While the PATCH is pending, archiving cannot start.
    expect(screen.getByRole("button", { name: "Delete organization" }))
      .toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2); // One GET and one PATCH.

    await act(async () => {
      finish(json({ ...organization, name: "Acme Renamed" }));
    });

    expect(await screen.findByText("Acme Renamed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete organization" }))
      .toBeEnabled();
  });

  it("ignores a late DELETE response after leaving the organization", async () => {
    let finish!: (response: Response) => void;
    const other = {
      ...organization,
      id: "00000000-0000-4000-8000-000000000002",
      name: "Other Org",
      slug: "other-org",
    };

    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockImplementationOnce(
        () => new Promise(resolve => { finish = resolve; }),
      )
      .mockResolvedValueOnce(json(other));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const dialog = within(await openDialog(user));
    const input = dialog.getByLabelText("Organization slug");
    fireEvent.change(input, { target: { value: "acme-ai" } });
    act(() => { fireEvent.submit(input.closest("form")!); });

    // Leave while the DELETE is pending (the page behind the dialog is inert).
    fireEvent.click(
      screen.getByRole("link", { name: "Open other organization", hidden: true }),
    );
    expect(await screen.findByText("Other Org")).toBeInTheDocument();

    await act(async () => { finish(new Response(null, { status: 204 })); });

    // The late 204 must neither navigate away nor touch the new screen.
    expect(screen.getByText("Other Org")).toBeInTheDocument();
    expect(screen.queryByText("No organizations yet.")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(getAccessToken()).toBe("organization-ui-test-token");
  }); 

  it("clears the content with a link back after ORGANIZATION_NOT_FOUND", async () => {
    fetchMock
      .mockResolvedValueOnce(json(organization))
      .mockResolvedValueOnce(json({
        code: "ORGANIZATION_NOT_FOUND",
        message: "Organization not found.",
      }, 404));

    const user = userEvent.setup();
    renderPage(`/organizations/${organization.id}`);

    const dialog = within(await openDialog(user));
    fireEvent.change(dialog.getByLabelText("Organization slug"), {
      target: { value: "acme-ai" },
    });
    await user.click(dialog.getByRole("button", { name: "Delete organization" }));

    expect(await screen.findByText("Organization not found"))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to organizations/ }))
      .toHaveAttribute("href", "/organizations");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(organization.slug)).not.toBeInTheDocument();
    expect(getAccessToken()).toBe("organization-ui-test-token");
  });
});
