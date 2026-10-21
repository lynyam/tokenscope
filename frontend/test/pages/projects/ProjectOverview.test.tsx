import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
import { saveAccessToken, getAccessToken } from "@/api/auth-session";

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
it.each(["OWNER", "ADMIN", "MEMBER"] as const)("%s keeps the existing project navigation and clears it on access loss", async role => {
  vi.mocked(getOrganization).mockResolvedValue({ id: "o", name: "Org", slug: "org", createdAt: "", updatedAt: "", currentUserRole: role });
  render(<MemoryRouter initialEntries={["/organizations/o/projects/p"]}>
    <Routes><Route path="/organizations/:organizationId/projects/:projectId" element={<ProjectDetailPage />} /></Routes>
  </MemoryRouter>);
  await screen.findByRole("heading", { name: "Support" });
  expect(screen.getByRole("link", { name: "Traces" })).toBeInTheDocument();
  expect(Boolean(screen.queryByRole("link", { name: "API keys" }))).toBe(role !== "MEMBER");
  fireEvent.click(screen.getByRole("button", { name: "Simulate access loss" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Support" })).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
  expect(getAccessToken()).toBe("current");
  expect(vi.mocked(getOrganizationProject).mock.calls.at(-1)![2]?.aborted).toBe(true);
});
