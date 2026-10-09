import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MembersPage } from "@/pages/organizations/MembersPage";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import type { MembershipRole, MembershipWithUser } from "@/types/workspace.types";

vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: vi.fn() }));

const orgId = "00000000-0000-4000-8000-000000000001";
const otherOrgId = "00000000-0000-4000-8000-000000000009";
const alice = { id: "00000000-0000-4000-8000-000000000002", displayName: "Alice", email: "alice@example.test" };
const bob = { id: "00000000-0000-4000-8000-000000000003", displayName: "Bob", email: "bob@example.test" };
const base = "/api/v1/organizations/" + orgId + "/members";
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function membership(user = bob, role: MembershipRole = "MEMBER"): MembershipWithUser {
  return {
    id: user.id.replace(/^00000000/, "10000000"), userId: user.id, organizationId: orgId, role,
    createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", user,
  };
}
function list(memberships: MembershipWithUser[] = [membership()], role: MembershipRole = "OWNER") {
  return json({ memberships, currentUserRole: role });
}
function view() {
  return <MemoryRouter initialEntries={["/organizations/" + orgId + "/members"]}>
    <Link to={"/organizations/" + otherOrgId + "/members"}>Other organization</Link>
    <Routes>
      <Route path="/organizations/:organizationId/members" element={<MembersPage />} />
      <Route path="/organizations" element={<h1>Organizations list</h1>} />
    </Routes>
  </MemoryRouter>;
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("alice-token");
  vi.mocked(useCurrentUser).mockReturnValue({ user: alice, isLoading: false });
});

describe("membership screen with the real HTTP adapter", () => {
  it.each(["ADMIN", "MEMBER"] as const)("allows %s to read but hides mutation controls", async role => {
    fetchMock.mockResolvedValue(list(undefined, role));
    render(view());
    await screen.findByText("Bob");
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows loading, then an empty collection", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    render(view());
    expect(screen.getByRole("status", { name: "Loading members" })).toBeInTheDocument();
    await act(async () => finish(list([])));
    expect(screen.getByText("No member yet.")).toBeInTheDocument();
  });

  it("adds a registered user, displays the server result, and closes the dialog", async () => {
    fetchMock.mockResolvedValueOnce(list([])).mockResolvedValueOnce(json(membership(), 201));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Email"), bob.email);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add member" }));
    await screen.findByText("Bob");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenLastCalledWith(base, expect.objectContaining({
      method: "POST", body: JSON.stringify({ email: bob.email, role: "MEMBER" }),
    }));
  });

  it.each([
    [404, "USER_NOT_FOUND", "No user with that email."],
    [409, "MEMBERSHIP_ALREADY_EXISTS", "This user is already a member."],
  ])("shows %i %s while retaining the form and existing rows", async (status, code, message) => {
    fetchMock.mockResolvedValueOnce(list()).mockResolvedValueOnce(json({ code, message }, status));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Email"), "unknown@example.test");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Email")).toHaveValue("unknown@example.test");
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(getAccessToken()).toBe("alice-token");
  });

  it("renders backend field validation details", async () => {
    fetchMock.mockResolvedValueOnce(list()).mockResolvedValueOnce(json({
      code: "VALIDATION_ERROR", message: "Request validation failed.",
      details: [{ field: "email", messages: ["Email was rejected."] }],
    }, 400));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Email"), bob.email);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add member" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("email: Email was rejected.");
  });

  it("prevents duplicate submissions while a write is pending", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(list([])).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Email"), bob.email);
    const form = within(screen.getByRole("dialog")).getByRole("button", { name: "Add member" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetchMock).toHaveBeenCalledTimes(2); // One GET, one POST.
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    await act(async () => finish(json(membership(), 201)));
    await screen.findByText("Bob");
  });

  it("changes role using the target user ID, then displays the returned role", async () => {
    fetchMock.mockResolvedValueOnce(list()).mockResolvedValueOnce(json(membership(bob, "ADMIN")));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Change role" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Role for Bob" }), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("ADMIN")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(base + "/" + bob.id, expect.objectContaining({ method: "PATCH", body: '{"role":"ADMIN"}' }));
  });

  it("hides all management controls immediately after self-demotion", async () => {
    fetchMock.mockResolvedValueOnce(list([membership(alice, "OWNER"), membership(bob, "OWNER")]))
      .mockResolvedValueOnce(json(membership(alice, "MEMBER")));
    const user = userEvent.setup();
    render(view());
    const row = (await screen.findByText("Alice")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Change role" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Role for Alice" }), "MEMBER");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("MEMBER");
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("removes a member after 204", async () => {
    fetchMock.mockResolvedValueOnce(list()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await screen.findByText("No member yet.");
    expect(fetchMock).toHaveBeenLastCalledWith(base + "/" + bob.id, expect.objectContaining({ method: "DELETE" }));
  });

  it("keeps the last owner visible when removal is rejected", async () => {
    fetchMock.mockResolvedValueOnce(list([membership(alice, "OWNER")]))
      .mockResolvedValueOnce(json({ code: "LAST_OWNER_REQUIRED", message: "At least one owner is required." }, 409));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("At least one owner is required.");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("OWNER")).toBeInTheDocument();
  });

  it("navigates away after successful self-removal", async () => {
    fetchMock.mockResolvedValueOnce(list([membership(alice, "OWNER"), membership(bob, "OWNER")]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(view());
    await user.click(within((await screen.findByText("Alice")).closest("tr")!).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("heading", { name: "Organizations list" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2); // No forbidden refetch after leaving.
  });

  it("keeps a concealed 404 on the page and supports retry", async () => {
    fetchMock.mockResolvedValueOnce(json({ code: "ORGANIZATION_NOT_FOUND", message: "Organization not found." }, 404))
      .mockResolvedValueOnce(list());
    const user = userEvent.setup();
    render(view());
    expect(await screen.findByRole("alert")).toHaveTextContent("Organization not found.");
    expect(getAccessToken()).toBe("alice-token");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Bob");
  });

  it("discards an old tenant response even if fetch ignores cancellation", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(list([{ ...membership(alice), organizationId: otherOrgId }], "MEMBER"));
    const user = userEvent.setup();
    render(view());
    const signal = fetchMock.mock.calls[0][1]?.signal;
    await user.click(screen.getByRole("link", { name: "Other organization" }));
    await screen.findByText("Alice");
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(list()));
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("does not apply a completed mutation to the next organization", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockResolvedValueOnce(list())
      .mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce(list([{ ...membership(alice), organizationId: otherOrgId }], "MEMBER"));
    const user = userEvent.setup();
    render(view());
    await user.click(await screen.findByRole("button", { name: "Change role" }));
    await user.selectOptions(screen.getByRole("combobox"), "ADMIN");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    const signal = fetchMock.mock.calls[1][1]?.signal;
    await user.click(screen.getByRole("link", { name: "Other organization" }));
    await screen.findByText("Alice");
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(json(membership(bob, "ADMIN"))));
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
    it("clears the page with a link back when adding a member returns ORGANIZATION_NOT_FOUND", async () => {
    fetchMock
      .mockResolvedValueOnce(list([]))
      .mockResolvedValueOnce(json({
        code: "ORGANIZATION_NOT_FOUND",
        message: "Organization not found.",
      }, 404));

    const user = userEvent.setup();
    render(view());

    await user.click(await screen.findByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Email"), bob.email);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Add member" }),
    );

    expect(await screen.findByRole("heading", { name: "Organization not found" }))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to organizations" }))
      .toHaveAttribute("href", "/organizations");
    expect(screen.queryByRole("button", { name: "Add member" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(getAccessToken()).toBe("alice-token");
  });
});
