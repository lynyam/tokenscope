import { render, screen } from "@testing-library/react";
import {
	MemoryRouter,
	Route,
	Routes,
} from "react-router-dom";
import { expect, it, vi } from "vitest";
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
