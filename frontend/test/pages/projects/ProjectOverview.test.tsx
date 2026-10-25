import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
import { ProjectSettingsPage } from "@/pages/projects/ProjectSettingsPage";
import { saveAccessToken, getAccessToken } from "@/api/auth-session";
import * as projectEvents from "@/api/project-events";

vi.mock("@/api/projects.api", () => ({ getOrganizationProject: vi.fn(), updateProject: vi.fn(), archiveProject: vi.fn() }));
vi.mock("@/api/organizations.api", () => ({ getOrganization: vi.fn() }));
vi.mock("@/pages/projects/ProjectDashboard", () => ({
  ProjectDashboard: ({ onUnavailable }: { onUnavailable: () => void }) => <button onClick={onUnavailable}>Simulate access loss</button>,
}));
import { getOrganization } from "@/api/organizations.api";
import { getOrganizationProject } from "@/api/projects.api";

beforeEach(() => {
  saveAccessToken("current");
  vi.mocked(getOrganizationProject).mockResolvedValue({
    id: "p", organizationId: "o", name: "Support", slug: "support", description: null,
    archivedAt: null, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
  });
});
it.each(["OWNER", "ADMIN", "MEMBER"] as const)("%s clears the project on access loss", async role => {
  const notify = vi.spyOn(projectEvents, "notifyProjectsChanged");
  vi.mocked(getOrganization).mockResolvedValue({ id: "o", name: "Org", slug: "org", createdAt: "", updatedAt: "", currentUserRole: role });
  render(<MemoryRouter initialEntries={["/organizations/o/projects/p"]}>
    <Routes><Route path="/organizations/:organizationId/projects/:projectId" element={<ProjectDetailPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Support" });
  expect(screen.getByText("Description: No description yet.")).toBeInTheDocument();
  expect(screen.getByText("Status: Active")).toBeInTheDocument();
  // Edit and archive moved to the settings page.
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Archive project" })).not.toBeInTheDocument();
  // Project navigation lives in the sidebar (see Sidebar.test.tsx), not in the page.
  expect(screen.queryByRole("navigation", { name: "Project sections" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Simulate access loss" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Support" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(getAccessToken()).toBe("current");
  expect(vi.mocked(getOrganizationProject).mock.calls.at(-1)![2]?.aborted).toBe(true);
  expect(notify).toHaveBeenCalledWith({ organizationId: "o", projectId: "p", kind: "unavailable" });
});

it.each([["OWNER", true], ["ADMIN", true], ["MEMBER", false]] as const)("%s on the settings page: edit and archive available = %s", async (role, allowed) => {
  vi.mocked(getOrganization).mockResolvedValue({ id: "o", name: "Org", slug: "org", createdAt: "", updatedAt: "", currentUserRole: role });
  render(<MemoryRouter initialEntries={["/organizations/o/projects/p/settings"]}>
    <Routes><Route path="/organizations/:organizationId/projects/:projectId/settings" element={<ProjectSettingsPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Settings" });
  expect(Boolean(screen.queryByRole("button", { name: "Edit" }))).toBe(allowed);
  expect(Boolean(screen.queryByRole("button", { name: "Archive project" }))).toBe(allowed);
  expect(Boolean(screen.queryByText(/Only organization owners and admins/))).toBe(!allowed);
  expect(screen.queryByText("Simulate access loss")).not.toBeInTheDocument();
});
