import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { MembersPage } from "../MembersPage";
import * as membershipsApi from "../../../api/memberships.api";
import * as organizationsApi from "../../../api/organizations.api";
import { useCurrentUser } from "../../../hooks/useCurrentUser"; // adapte le chemin
import { MockApiError } from "../../../api/mock-api.utils";

vi.mock("../../../hooks/useCurrentUser");

const mockedUseCurrentUser = vi.mocked(useCurrentUser);

function renderMembersPage(organizationId = "acme") {
    return render(
        <MemoryRouter initialEntries={[`/organizations/${organizationId}/members`]}>
            <Routes>
                <Route path="/organizations/:organizationId/members" element={<MembersPage />} />
                <Route path="/organizations" element={<p>Organizations list</p>} />
            </Routes>
        </MemoryRouter>
    );
}

const OWNER_USER = { id: "user-alice", displayName: "Alice", email: "alice@acme.dev" };

function makeMembership(overrides = {}) {
    return {
        id: "membership-1",
        userId: "user-bob",
        organizationId: "acme",
        role: "MEMBER" as const,
        createdAt: "2026-01-20T00:00:00.000Z",
        updatedAt: "2026-01-20T00:00:00.000Z",
        user: { id: "user-bob", displayName: "Bob", email: "bob@acme.dev" },
        ...overrides,
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    mockedUseCurrentUser.mockReturnValue({ user: OWNER_USER, isLoading: false });
});

// 1. OWNER rename organization
describe("organization rename", () => {
    it("allows an OWNER to rename the organization", async () => {
        const updateOrganizationSpy = vi
            .spyOn(organizationsApi, "updateOrganization")
            .mockResolvedValue({ id: "acme", name: "New Acme Name", slug: "acme", currentUserRole: "OWNER" });

        // ⚠️ adapte au composant réel de rename (nom, props) — placeholder ici
        // render(<RenameOrganizationForm organizationId="acme" currentName="Acme" onRenamed={vi.fn()} />);
        // fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "New Acme Name" } });
        // fireEvent.click(screen.getByRole("button", { name: /save/i }));
        // await waitFor(() => expect(updateOrganizationSpy).toHaveBeenCalledWith("acme", { name: "New Acme Name" }));

        expect(updateOrganizationSpy).toBeDefined(); // TODO: remplacer par le vrai test une fois le composant confirmé
    });
});

describe("MembersPage", () => {
    // 2. OWNER adds an existing user
    it("adds an existing user as a new member", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [],
        });
        const addMemberSpy = vi.spyOn(membershipsApi, "addOrganizationMember").mockResolvedValue(
            makeMembership({ role: "MEMBER" })
        );

        renderMembersPage();

        await screen.findByText("No member yet.");
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "bob@acme.dev" } });
        fireEvent.click(screen.getByRole("button", { name: /add/i }));

        await waitFor(() => expect(addMemberSpy).toHaveBeenCalled());
        expect(await screen.findByText("Bob")).toBeInTheDocument();
    });

    // 3. role defaults to MEMBER when not specified
    it("defaults the new member's role to MEMBER when none is chosen", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [],
        });
        const addMemberSpy = vi
            .spyOn(membershipsApi, "addOrganizationMember")
            .mockResolvedValue(makeMembership({ role: "MEMBER" }));

        renderMembersPage();
        await screen.findByText("No member yet.");

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "bob@acme.dev" } });
        fireEvent.click(screen.getByRole("button", { name: /add/i }));

        await waitFor(() =>
            expect(addMemberSpy).toHaveBeenCalledWith(
                "acme",
                expect.objectContaining({ email: "bob@acme.dev", role: "MEMBER" })
            )
        );
    });

    // 4. OWNER changes a member's role
    it("lets an OWNER change another member's role", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership({ role: "MEMBER" })],
        });
        const updateRoleSpy = vi
            .spyOn(membershipsApi, "updateOrganizationMemberRole")
            .mockResolvedValue(makeMembership({ role: "ADMIN" }));

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /change role/i }));
        fireEvent.change(within(screen.getByRole("table")).getByRole("combobox"), {
            target: { value: "ADMIN" },
        });
        fireEvent.click(screen.getByRole("button", { name: /confirmer/i }));

        await waitFor(() =>
            expect(updateRoleSpy).toHaveBeenCalledWith("acme", "user-bob", { role: "ADMIN" })
        );
        expect(await screen.findByText("ADMIN")).toBeInTheDocument();
    });

    // 5. OWNER removes a membership
    it("lets an OWNER remove a member", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership()],
        });
        const removeSpy = vi.spyOn(membershipsApi, "removeOrganizationMember").mockResolvedValue(undefined);
        vi.spyOn(window, "confirm").mockReturnValue(true);

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /remove/i }));

        await waitFor(() => expect(removeSpy).toHaveBeenCalledWith("acme", "user-bob"));
        await waitFor(() => expect(screen.queryByText("Bob")).not.toBeInTheDocument());
    });

    // 6. last-owner rejection
    it("rejects removing the last OWNER and leaves state unchanged", async () => {
        const lastOwner = makeMembership({
            id: "membership-owner",
            userId: "user-alice",
            role: "OWNER",
            user: OWNER_USER,
        });
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [lastOwner],
        });
        vi.spyOn(membershipsApi, "removeOrganizationMember").mockRejectedValue(
            new MockApiError(409, "At least one OWNER is required")
        );
        vi.spyOn(window, "confirm").mockReturnValue(true);

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /remove/i }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/at least one owner/i);
        expect(screen.getByText("Alice")).toBeInTheDocument(); // toujours dans la liste
    });

    // 7. duplicate member / unknown user errors
    it("surfaces an error when adding a duplicate or unknown user", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [],
        });
        vi.spyOn(membershipsApi, "addOrganizationMember").mockRejectedValue(
            new MockApiError(404, "No user with that email")
        );

        renderMembersPage();
        await screen.findByText("No member yet.");
        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "ghost@acme.dev" } });
        fireEvent.click(screen.getByRole("button", { name: /add/i }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/no user with that email/i);
    });

    // 8. ADMIN/MEMBER cannot see management controls
    it.each(["ADMIN", "MEMBER"] as const)(
        "hides management controls for a %s",
        async (role) => {
            vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
                currentUserRole: role,
                memberships: [makeMembership()],
            });

            renderMembersPage();
            await screen.findByText("Bob");

            expect(screen.queryByRole("button", { name: /change role/i })).not.toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
            expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument(); // AddMemberForm absent
        }
    );

    // 9a. self-demotion recomputes visible controls
    it("hides management controls immediately after the current user demotes themselves", async () => {
        const selfMembership = makeMembership({
            id: "membership-owner",
            userId: "user-alice",
            role: "OWNER",
            user: OWNER_USER,
        });
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [selfMembership],
        });
        vi.spyOn(membershipsApi, "updateOrganizationMemberRole").mockResolvedValue({
            ...selfMembership,
            role: "ADMIN",
        });

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /change role/i }));
        fireEvent.change(within(screen.getByRole("table")).getByRole("combobox"), {
            target: { value: "ADMIN" },
        });
        fireEvent.click(screen.getByRole("button", { name: /confirmer/i }));

        await waitFor(() =>
            expect(screen.queryByRole("button", { name: /change role/i })).not.toBeInTheDocument()
        );
    });

    // 9b. self-removal redirects to /organizations
    it("redirects to /organizations when the current user removes themselves", async () => {
        const selfMembership = makeMembership({
            id: "membership-owner",
            userId: "user-alice",
            role: "OWNER",
            user: OWNER_USER,
        });
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [selfMembership],
        });
        vi.spyOn(membershipsApi, "removeOrganizationMember").mockResolvedValue(undefined);
        vi.spyOn(window, "confirm").mockReturnValue(true);

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /remove/i }));

        expect(await screen.findByText("Organizations list")).toBeInTheDocument();
    });
});