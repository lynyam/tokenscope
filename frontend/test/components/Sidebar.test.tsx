import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
	MemoryRouter,
	Route,
	Routes,
} from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";
import { notifyProjectsChanged } from "@/api/project-events";
import {
	saveAccessToken,
	getAccessToken,
} from "@/api/auth-session";

// These independent menus are covered separately.
// This test exercises the sidebar's project-access behavior.
vi.mock("@/components/OrganizationSwitcher", () => ({
	OrganizationSwitcher: () => null,
}));

vi.mock("@/components/UserMenu", () => ({
	UserMenu: () => null,
}));

let desktop = true;
let mediaChange: (() => void) | undefined;
beforeEach(() => {
  desktop = true;
  mediaChange = undefined;
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation(() => ({
    get matches() { return desktop; },
    addEventListener: (_: string, listener: () => void) => { mediaChange = listener; },
    removeEventListener: vi.fn(),
  })));
});

it(
	"removes organization navigation when the projects request returns 404",
	async () => {
		saveAccessToken("sidebar-test-token");

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({
					code: "ORGANIZATION_NOT_FOUND",
					message: "Organization not found.",
				}), {
					status: 404,
					headers: { "Content-Type": "application/json" },
				}),
			),
		);

		render(
			<MemoryRouter
				initialEntries={["/organizations/org/projects"]}
			>
				<Routes>
					<Route
						path="/organizations/:organizationId/projects"
						element={<Sidebar />}
					/>
				</Routes>
			</MemoryRouter>,
		);

		expect(await screen.findByRole("alert"))
			.toHaveTextContent("Organization not found.");

		expect(
			screen.getByRole("link", {
				name: "Back to organizations",
			}),
		).toHaveAttribute("href", "/organizations");

		expect(screen.queryByRole("link", { name: "Members" }))
			.not.toBeInTheDocument();

		expect(screen.queryByText("All projects"))
			.not.toBeInTheDocument();

		expect(getAccessToken()).toBe("sidebar-test-token");
	},
);


it("opens accessible mobile navigation, closes on Escape/navigation and handles desktop resize", async () => {
  desktop = false;
  saveAccessToken("sidebar-test-token");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", {
    headers: { "Content-Type": "application/json" },
  })));
  render(<MemoryRouter initialEntries={["/organizations/org/projects"]}>
    <Routes><Route path="/organizations/:organizationId/*" element={<Sidebar />} /></Routes>
  </MemoryRouter>);
  expect(screen.queryByRole("link", { name: "Members" })).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "Open menu" });
  fireEvent.click(trigger);
  const menu = await screen.findByRole("dialog", { name: "Workspace navigation" });
  expect(within(menu).getByRole("link", { name: "Members" })).toBeInTheDocument();
  fireEvent.keyDown(menu, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("link", { name: "Members" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(trigger);
  await screen.findByRole("dialog");
  act(() => { desktop = true; mediaChange?.(); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("complementary", { name: "Workspace navigation" })).toBeInTheDocument();
  act(() => { desktop = false; mediaChange?.(); });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(getAccessToken()).toBe("sidebar-test-token");
});


function renderProjectSidebar(path: string, role: "OWNER" | "ADMIN" | "MEMBER", available = true, failRole = false) {
	saveAccessToken("sidebar-test-token");
	vi.stubGlobal("fetch", vi.fn().mockImplementation((input: RequestInfo | URL) => {
		const url = String(input);
		if (failRole && !url.endsWith("/projects")) {
			failRole = false;
			return Promise.reject(new TypeError("offline"));
		}
		const body = url.endsWith("/projects")
			? (available ? [{ id: "p1", organizationId: "org", name: "Support", slug: "support", description: null, archivedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }] : [])
			: { id: "org", name: "Org", slug: "org", createdAt: "", updatedAt: "", currentUserRole: role };
		return Promise.resolve(new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }));
	}));
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/organizations/:organizationId/projects/:projectId/*" element={<Sidebar />} />
				<Route path="/organizations/:organizationId/*" element={<Sidebar />} />
			</Routes>
		</MemoryRouter>,
	);
}

it.each([["OWNER", true], ["ADMIN", true], ["MEMBER", false]] as const)(
	"%s sees the project links inside a project (API keys: %s)",
	async (role, canSeeKeys) => {
		renderProjectSidebar("/organizations/org/projects/p1/traces", role);
		expect(await screen.findByRole("link", { name: "Traces" })).toHaveAttribute("href", "/organizations/org/projects/p1/traces");
		expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/organizations/org/projects/p1");
		expect(screen.getByRole("link", { name: "Documents" })).toHaveAttribute("href", "/organizations/org/projects/p1/documents");
		await waitFor(() => expect(Boolean(screen.queryByRole("link", { name: "API keys" }))).toBe(canSeeKeys));
		expect(Boolean(screen.queryByRole("link", { name: "Settings" }))).toBe(canSeeKeys);
		expect(screen.getByRole("link", { name: "Traces" })).toHaveAttribute("aria-current", "page");
		expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
	},
);

it("hides the project links outside a project", async () => {
	renderProjectSidebar("/organizations/org/members", "OWNER");
	await screen.findByRole("link", { name: "Members" });
	expect(screen.queryByRole("link", { name: "Traces" })).not.toBeInTheDocument();
	expect(screen.queryByRole("link", { name: "Documents" })).not.toBeInTheDocument();
	expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
});

it("does not advertise sections for a missing or archived project", async () => {
	renderProjectSidebar("/organizations/org/projects/p1/settings", "OWNER", false);
	await waitFor(() => expect(screen.queryByText("Loading projects…")).not.toBeInTheDocument());
	expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
	expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
	expect(screen.queryByRole("link", { name: "Traces" })).not.toBeInTheDocument();
	expect(getAccessToken()).toBe("sidebar-test-token");
});

it("shows a retry when the role read fails, without removing read navigation or logging out", async () => {
	renderProjectSidebar("/organizations/org/projects/p1/traces", "OWNER", true, true);
	expect(await screen.findByRole("alert")).toHaveTextContent("Unable to reach the server");
	expect(screen.getByRole("link", { name: "Traces" })).toBeInTheDocument();
	expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Retry project permissions" }));
	await screen.findByRole("link", { name: "Settings" });
	expect(screen.queryByRole("alert")).not.toBeInTheDocument();
	expect(getAccessToken()).toBe("sidebar-test-token");
});

it("clears project links after a confirmed project access loss without clearing the session", async () => {
	renderProjectSidebar("/organizations/org/projects/p1/settings", "OWNER");
	await screen.findByRole("link", { name: "Settings" });
	act(() => notifyProjectsChanged({ organizationId: "org", projectId: "other", kind: "unavailable" }));
	expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
	act(() => notifyProjectsChanged({ organizationId: "org", projectId: "p1", kind: "unavailable" }));
	expect(screen.queryByRole("group", { name: "Project sections" })).not.toBeInTheDocument();
	expect(getAccessToken()).toBe("sidebar-test-token");
});

it("mobile project navigation reaches Settings and closes the drawer", async () => {
	desktop = false;
	renderProjectSidebar("/organizations/org/projects/p1", "ADMIN");
	fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
	fireEvent.click(await screen.findByRole("link", { name: "Settings" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
	fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
	expect(await screen.findByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
});
