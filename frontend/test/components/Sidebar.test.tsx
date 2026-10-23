import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
	MemoryRouter,
	Route,
	Routes,
} from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/Sidebar";
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
