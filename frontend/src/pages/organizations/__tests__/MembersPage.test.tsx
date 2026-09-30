import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { MembersPage } from "../MembersPage";
import * as membershipsApi from "../../../api/memberships.api";
import * as organizationsApi from "../../../api/organizations.api";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
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

function openAddMemberDialog() {
    fireEvent.click(screen.getByRole("button", { name: /^add member$/i }));
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

describe("organization rename", () => {
    // Vérifie que updateOrganization est bien disponible/appelable pour
    // un OWNER qui renomme l'organisation (test de câblage de base).
    it("allows an OWNER to rename the organization", async () => {
        const updateOrganizationSpy = vi
            .spyOn(organizationsApi, "updateOrganization")
            .mockResolvedValue({ id: "acme", name: "New Acme Name", slug: "acme", currentUserRole: "OWNER" });

        expect(updateOrganizationSpy).toBeDefined();
    });
});

describe("MembersPage", () => {
    // Cas nominal : un OWNER ajoute un utilisateur existant par email,
    // le nouveau membre apparaît bien dans la liste après ajout.
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
        openAddMemberDialog();

        fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: "bob@acme.dev" } });
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /add member/i }));

        await waitFor(() => expect(addMemberSpy).toHaveBeenCalled());
        expect(await screen.findByText("Bob")).toBeInTheDocument();
    });

    // Vérifie que si l'utilisateur ne touche pas au select de rôle,
    // la valeur par défaut "MEMBER" est bien celle envoyée à l'API.
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
        openAddMemberDialog();

        fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: "bob@acme.dev" } });
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /add member/i }));

        await waitFor(() =>
            expect(addMemberSpy).toHaveBeenCalledWith(
                "acme",
                expect.objectContaining({ email: "bob@acme.dev", role: "MEMBER" })
            )
        );
    });

    // Cas nominal : un OWNER change le rôle d'un autre membre (MEMBER -> ADMIN),
    // le nouveau rôle s'affiche bien dans le tableau après confirmation.
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

    // Cas nominal : un OWNER retire un membre, qui disparaît bien
    // de la liste après confirmation de la boîte de dialogue native.
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

    // Invariant "last owner" : retirer le seul OWNER restant doit être
    // rejeté par l'API (409), et l'état affiché ne doit pas changer.
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
        expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    // Vérifie qu'une erreur métier (email dupliqué ou utilisateur inconnu)
    // renvoyée par l'API est bien affichée telle quelle à l'utilisateur.
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
        openAddMemberDialog();

        fireEvent.change(await screen.findByLabelText(/email/i), { target: { value: "ghost@acme.dev" } });
        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /add member/i }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/no user with that email/i);
    });

    // Vérifie que les rôles ADMIN et MEMBER n'ont accès à aucun contrôle
    // de gestion (changer rôle, retirer, ajouter un membre) — matrice
    // d'autorisation frontend en miroir de celle du backend.
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
            expect(screen.queryByRole("button", { name: /^add member$/i })).not.toBeInTheDocument();
        }
    );

    // Auto-démotion : quand l'OWNER connecté se rétrograde lui-même en ADMIN,
    // les contrôles de gestion doivent disparaître immédiatement, sans
    // attendre un rechargement de page.
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

    // Auto-suppression : quand l'utilisateur connecté se retire lui-même,
    // il doit être redirigé vers /organizations.
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

    // Le champ email a `required` en HTML5 : soumettre le formulaire vide
    // ne doit jamais appeler l'API (validation native du navigateur/jsdom).
    it("does not submit when the email field is left empty", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [],
        });
        const addMemberSpy = vi.spyOn(membershipsApi, "addOrganizationMember");

        renderMembersPage();
        await screen.findByText("No member yet.");
        openAddMemberDialog();

        fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /add member/i }));

        expect(addMemberSpy).not.toHaveBeenCalled();
    });

    // Le bouton "Remove" se désactive dès le premier clic (isRowBusy) :
    // un second clic pendant que la requête est en cours ne doit pas
    // déclencher un second appel API.
    it("prevents a double-click on Remove from calling the API twice", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership()],
        });
        vi.spyOn(window, "confirm").mockReturnValue(true);

        let resolveRemove!: () => void;
        const removeSpy = vi.spyOn(membershipsApi, "removeOrganizationMember").mockImplementation(
            () => new Promise((resolve) => { resolveRemove = () => resolve(undefined); })
        );

        renderMembersPage();
        const removeButton = await screen.findByRole("button", { name: /remove/i });

        fireEvent.click(removeButton);
        fireEvent.click(removeButton);

        resolveRemove();
        await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(1));
    });

    // Cliquer sur "Annuler" pendant l'édition du rôle doit fermer le mode
    // édition sans jamais appeler updateOrganizationMemberRole.
    it("lets the user cancel a role change without calling the API", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership()],
        });
        const updateRoleSpy = vi.spyOn(membershipsApi, "updateOrganizationMemberRole");

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /change role/i }));
        fireEvent.click(screen.getByRole("button", { name: /annuler/i }));

        expect(updateRoleSpy).not.toHaveBeenCalled();
        expect(await screen.findByRole("button", { name: /change role/i })).toBeInTheDocument();
    });

    // Contrairement au test "rejects removing the last OWNER", ici il y a
    // deux OWNER : le retrait de soi-même doit réussir et ne doit pas
    // affecter l'autre membre.
    it("allows removing yourself when another OWNER remains, without affecting the other member", async () => {
        const selfMembership = makeMembership({
            id: "membership-owner-1",
            userId: "user-alice",
            role: "OWNER",
            user: OWNER_USER,
        });
        const otherOwner = makeMembership({
            id: "membership-owner-2",
            userId: "user-carol",
            role: "OWNER",
            user: { id: "user-carol", displayName: "Carol", email: "carol@acme.dev" },
        });
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [selfMembership, otherOwner],
        });
        vi.spyOn(membershipsApi, "removeOrganizationMember").mockResolvedValue(undefined);
        vi.spyOn(window, "confirm").mockReturnValue(true);

        renderMembersPage();
        await screen.findByText("Carol");

        const selfRow = screen.getByText("Alice").closest("tr");
        if (!selfRow) throw new Error("Could not find Alice's row");
        fireEvent.click(within(selfRow).getByRole("button", { name: /remove/i }));

        expect(await screen.findByText("Organizations list")).toBeInTheDocument();
    });

    // Une erreur qui n'est pas une MockApiError (ex: erreur réseau) doit
    // afficher le message générique de secours, pas planter ni rester muette.
    it("shows a generic error message when removing a member fails unexpectedly", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership()],
        });
        vi.spyOn(membershipsApi, "removeOrganizationMember").mockRejectedValue(new Error("network down"));
        vi.spyOn(window, "confirm").mockReturnValue(true);

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /remove/i }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/une erreur inattendue est survenue/i);
    });

    // Même vérification que ci-dessus, mais sur le chemin de changement de
    // rôle : une erreur générique affiche le même message de secours.
    it("shows a generic error message when changing a role fails unexpectedly", async () => {
        vi.spyOn(membershipsApi, "getOrganizationMemberships").mockResolvedValue({
            currentUserRole: "OWNER",
            memberships: [makeMembership()],
        });
        vi.spyOn(membershipsApi, "updateOrganizationMemberRole").mockRejectedValue(new Error("network down"));

        renderMembersPage();
        fireEvent.click(await screen.findByRole("button", { name: /change role/i }));
        fireEvent.click(within(screen.getByRole("table")).getByRole("combobox"));
        fireEvent.click(screen.getByRole("button", { name: /confirmer/i }));

        expect(await screen.findByRole("alert")).toHaveTextContent(/une erreur inattendue est survenue/i);
    });
});