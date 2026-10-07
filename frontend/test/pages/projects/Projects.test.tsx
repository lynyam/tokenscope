import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
  } from "@testing-library/react";
  import userEvent from "@testing-library/user-event";
  import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
  import { beforeEach, expect, it, vi } from "vitest";
  import { ProjectsPage } from "@/pages/projects/ProjectsPage";
  import { ProjectDetailPage } from "@/pages/projects/ProjectDetailPage";
  import { useOrganizationProjects } from "@/hooks/useOrganizationProjects";
  import {
	archiveProject,
	createProject,
	updateProject,
  } from "@/api/projects.api";
  import { getAccessToken, saveAccessToken } from "@/api/auth-session";
  import type { MembershipRole, Project } from "@/types/workspace.types";

  const org = "00000000-0000-4000-8000-000000000001";
  const otherOrg = "00000000-0000-4000-8000-000000000003";

  const project: Project = {
	id: "00000000-0000-4000-8000-000000000002",
	organizationId: org,
	name: "Support",
	slug: "support",
	description: "Original description",
	archivedAt: null,
	createdAt: "2026-09-01T00:00:00.000Z",
	updatedAt: "2026-09-01T00:00:00.000Z",
  };

  const other = {
	...project,
	id: "00000000-0000-4000-8000-000000000004",
	organizationId: otherOrg,
	name: "Other project",
  };

  const listPath = "/organizations/" + org + "/projects";
  const detailPath = listPath + "/" + project.id;
  const otherPath =
	"/organizations/" + otherOrg + "/projects/" + other.id;

  const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
	  status,
	  headers: { "Content-Type": "application/json" },
	});

  const fetchMock = vi.fn<typeof fetch>();
  let role: MembershipRole;
  let items: Project[];
  let offline: boolean;
  let write: (
	url: RequestInfo | URL,
	options?: RequestInit,
  ) => Promise<Response>;

  function view(path = listPath) {
	return render(
	  <MemoryRouter initialEntries={[path]}>
		<Link to={otherPath}>Open other project</Link>
		<Routes>
		  <Route
			path="/organizations/:organizationId/projects"
			element={<ProjectsPage />}
		  />
		  <Route
			path="/organizations/:organizationId/projects/:projectId"
			element={<ProjectDetailPage />}
		  />
		</Routes>
	  </MemoryRouter>,
	);
  }

  const writes = () =>
	fetchMock.mock.calls.filter(([, options]) => options?.method !== "GET");

  beforeEach(() => {
	role = "OWNER";
	items = [project];
	offline = false;
	write = async () => { throw new Error("Unexpected write"); };

	fetchMock.mockReset();
	fetchMock.mockImplementation(async (url, options) => {
	  if (offline) throw new TypeError("offline");
	  if (options?.method !== "GET") return write(url, options);

	  if (url === "/api/v1" + listPath) return json(items);
	  if (url === "/api/v1" + detailPath) return json(project);
	  if (url === "/api/v1" + otherPath) return json(other);

	  if (
		url === "/api/v1/organizations/" + otherOrg + "/projects"
	  ) return json([other]);

	  if (
		url === "/api/v1/organizations/" + org ||
		url === "/api/v1/organizations/" + otherOrg
	  ) {
		return json({
		  id: url.toString().split("/").at(-1),
		  name: "Organization",
		  slug: "organization",
		  currentUserRole: role,
		  createdAt: project.createdAt,
		  updatedAt: project.updatedAt,
		});
	  }

	  throw new Error("Unexpected URL: " + url);
	});

	vi.stubGlobal("fetch", fetchMock);
	saveAccessToken("project-ui-token");
  });

  it.each(["OWNER", "ADMIN"] as const)(
	"%s creates once and sees the returned project immediately",
	async value => {
	  role = value;
	  let finish!: (response: Response) => void;
	  write = () => new Promise(resolve => { finish = resolve; });

	  const created = { ...project, id: other.id, name: "New project" };
	  view();

	  await screen.findByRole("button", { name: "Create" });
	  const input = screen.getByLabelText("Project name");

	  fireEvent.change(input, { target: { value: "  New project  " } });
	  fireEvent.change(screen.getByLabelText("Description (optional)"), {
		target: { value: " Details " },
	  });

	  act(() => {
		fireEvent.submit(input.closest("form")!);
		fireEvent.submit(input.closest("form")!);
	  });

	  expect(writes()).toHaveLength(1);
	  expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({
		name: "New project",
		description: "Details",
	  });
	  expect(input).toBeDisabled();

	  await act(async () => { finish(json(created, 201)); });

	  expect(
		await screen.findByRole("link", { name: "New project" }),
	  ).toHaveAttribute("href", listPath + "/" + created.id);

	  expect(input).toHaveValue("");
	  expect(screen.getByLabelText("Description (optional)"))
		.toHaveValue("");
	  expect(screen.getByRole("link", { name: project.name }))
		.toBeInTheDocument();
	},
  );

  it.each([listPath, detailPath])(
	"MEMBER has no project mutation controls at %s",
	async path => {
	  role = "MEMBER";
	  view(path);

	  await screen.findByText(project.name);
	  expect(screen.queryByRole("button", { name: "Create" }))
		.not.toBeInTheDocument();
	  expect(screen.queryByRole("button", { name: "Edit" }))
		.not.toBeInTheDocument();
	  expect(screen.queryByRole("button", { name: "Archive project" }))
		.not.toBeInTheDocument();
	},
  );

  it("distinguishes loading, failure and an empty list, with session-preserving Retry", async () => {
	offline = true;
	items = [];

	const user = userEvent.setup();
	view();

	expect(screen.getByRole("status")).toHaveTextContent("Loading projects");
	expect(await screen.findByRole("alert"))
	  .toHaveTextContent("Unable to reach the server");
	expect(screen.queryByText("No projects yet.")).not.toBeInTheDocument();

	offline = false;
	await user.click(screen.getByRole("button", { name: "Retry" }));

	expect(await screen.findByText("No projects yet.")).toBeInTheDocument();
	expect(getAccessToken()).toBe("project-ui-token");
  });

  it("rejects whitespace-only creation without a request", async () => {
	view();
	await screen.findByRole("button", { name: "Create" });

	const input = screen.getByLabelText("Project name");
	fireEvent.change(input, { target: { value: "   " } });
	fireEvent.submit(input.closest("form")!);

	expect(await screen.findByRole("alert")).toHaveTextContent("1–100");
	expect(writes()).toHaveLength(0);
  });

  it.each([400, 403, 404, 409, 503])(
	"preserves creation input and existing projects after %i",
	async status => {
	  write = async () => json({
		code: "REJECTED",
		message: "Request rejected.",
		details: status === 400
		  ? [{ field: "name", messages: ["Name was rejected."] }]
		  : undefined,
	  }, status);

	  const user = userEvent.setup();
	  view();

	  await screen.findByRole("button", { name: "Create" });
	  const input = screen.getByLabelText("Project name");
	  fireEvent.change(input, { target: { value: "Kept draft" } });

	  await user.click(screen.getByRole("button", { name: "Create" }));

	  expect(await screen.findByRole("alert")).toHaveTextContent(
		status === 400 ? "Name was rejected." : "Request rejected.",
	  );
	  expect(input).toHaveValue("Kept draft");
	  expect(screen.getByRole("link", { name: project.name }))
		.toBeInTheDocument();
	  expect(getAccessToken()).toBe("project-ui-token");
	},
  );

  it.each(["OWNER", "ADMIN"] as const)(
	"%s updates once and keeps the original slug",
	async value => {
	  role = value;
	  let finish!: (response: Response) => void;
	  write = () => new Promise(resolve => { finish = resolve; });

	  const user = userEvent.setup();
	  view(detailPath);

	  await user.click(await screen.findByRole("button", { name: "Edit" }));
	  const input = screen.getByLabelText("Name");
	  expect(input).toHaveValue(project.name);

	  fireEvent.change(input, { target: { value: " Renamed " } });
	  fireEvent.change(screen.getByLabelText("Description"), {
		target: { value: " New description " },
	  });

	  act(() => {
		fireEvent.submit(input.closest("form")!);
		fireEvent.submit(input.closest("form")!);
	  });

	  expect(writes()).toHaveLength(1);
	  expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({
		name: "Renamed",
		description: "New description",
	  });
	  expect(input).toBeDisabled();

	  await act(async () => {
		finish(json({
		  ...project,
		  name: "Renamed",
		  description: "New description",
		}));
	  });

	  await waitFor(() =>
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	  );
	  expect(screen.getByRole("heading", { name: "Renamed" }))
		.toBeInTheDocument();
	  expect(screen.getByText(project.slug)).toBeInTheDocument();
	},
  );

  it("rejects an unchanged edit, resets cancelled drafts and sends null to clear description", async () => {
	write = async () => json({ ...project, description: null });

	const user = userEvent.setup();
	view(detailPath);

	await user.click(await screen.findByRole("button", { name: "Edit" }));
	await user.click(screen.getByRole("button", { name: "Save" }));

	expect(await screen.findByRole("alert"))
	  .toHaveTextContent("Change the name or description");
	expect(writes()).toHaveLength(0);

	fireEvent.change(screen.getByLabelText("Name"), {
	  target: { value: "Discard" },
	});
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	await waitFor(() =>
	  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);

	await user.click(screen.getByRole("button", { name: "Edit" }));
	expect(screen.getByLabelText("Name")).toHaveValue(project.name);

	fireEvent.change(screen.getByLabelText("Description"), {
	  target: { value: "" },
	});
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
	  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
	);

	expect(JSON.parse(writes()[0][1]?.body as string))
	  .toEqual({ description: null });
	expect(screen.getByText(/No description yet/)).toBeInTheDocument();
  });

  it.each([400, 403, 404, 503])(
	"preserves the editor, original project and session after update %i",
	async status => {
	  write = async () => json({
		code: "REJECTED",
		message: "Update rejected.",
	  }, status);

	  const user = userEvent.setup();
	  view(detailPath);

	  await user.click(await screen.findByRole("button", { name: "Edit" }));
	  fireEvent.change(screen.getByLabelText("Name"), {
		target: { value: "Kept draft" },
	  });
	  await user.click(screen.getByRole("button", { name: "Save" }));

	  expect(await screen.findByRole("alert"))
		.toHaveTextContent("Update rejected.");
	  expect(screen.getByLabelText("Name")).toHaveValue("Kept draft");
	  expect(
		screen.getByRole("heading", {
		  name: project.name,
		  hidden: true,
		}),
	  ).toBeInTheDocument();
	  expect(getAccessToken()).toBe("project-ui-token");
	},
  );

  it.each(["OWNER", "ADMIN"] as const)(
	"%s archives only after confirmation and leaves the detail route",
	async value => {
	  role = value;
	  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
	  write = async () => {
		items = [];
		return new Response(null, { status: 204 });
	  };

	  const user = userEvent.setup();
	  view(detailPath);

	  await user.click(
		await screen.findByRole("button", { name: "Archive project" }),
	  );
	  expect(writes()).toHaveLength(0);

	  confirm.mockReturnValue(true);
	  await user.click(
		screen.getByRole("button", { name: "Archive project" }),
	  );

	  expect(await screen.findByText("No projects yet."))
		.toBeInTheDocument();
	  expect(writes()[0][0]).toBe("/api/v1" + detailPath);
	  expect(writes()[0][1]?.method).toBe("DELETE");
	},
  );

  it.each([403, 404, 503])(
	"keeps the project visible after archive %i",
	async status => {
	  vi.spyOn(window, "confirm").mockReturnValue(true);
	  write = async () => json({
		code: "REJECTED",
		message: "Archive rejected.",
	  }, status);

	  const user = userEvent.setup();
	  view(detailPath);

	  await user.click(
		await screen.findByRole("button", { name: "Archive project" }),
	  );

	  expect(await screen.findByRole("alert"))
		.toHaveTextContent("Archive rejected.");
	  expect(screen.getByRole("heading", { name: project.name }))
		.toBeInTheDocument();
	  expect(getAccessToken()).toBe("project-ui-token");
	},
  );

  it("shows a concealed detail 404 without logging out", async () => {
	const respond = fetchMock.getMockImplementation()!;
	fetchMock.mockImplementation((url, options) =>
	  url === "/api/v1" + detailPath
		? Promise.resolve(json({
			code: "PROJECT_NOT_FOUND",
			message: "Project not found.",
		  }, 404))
		: respond(url, options),
	);

	view(detailPath);

	expect(await screen.findByRole("alert"))
	  .toHaveTextContent("Project not found.");
	expect(screen.queryByRole("button", { name: "Edit" }))
	  .not.toBeInTheDocument();
	expect(getAccessToken()).toBe("project-ui-token");
  });

  it.each(["update", "archive"] as const)(
	"ignores a late %s after navigation to another organization",
	async operation => {
	  let finish!: (response: Response) => void;
	  write = () => new Promise(resolve => { finish = resolve; });
	  vi.spyOn(window, "confirm").mockReturnValue(true);

	  const user = userEvent.setup();
	  view(detailPath);

	  if (operation === "update") {
		await user.click(
		  await screen.findByRole("button", { name: "Edit" }),
		);
		fireEvent.change(screen.getByLabelText("Name"), {
		  target: { value: "Old renamed" },
		});
		await user.click(screen.getByRole("button", { name: "Save" }));
	  } else {
		await user.click(
		  await screen.findByRole("button", { name: "Archive project" }),
		);
	  }

	  const signal = writes()[0][1]?.signal;

	  // Simulate a route change even while the editing dialog is open.
	  fireEvent.click(screen.getByText("Open other project"));
	  await screen.findByRole("heading", { name: other.name });
	  expect(signal?.aborted).toBe(true);

	  await act(async () => {
		finish(
		  operation === "archive"
			? new Response(null, { status: 204 })
			: json({ ...project, name: "Old renamed" }),
		);
	  });

	  expect(screen.getByRole("heading", { name: other.name }))
		.toBeInTheDocument();
	  expect(screen.queryByRole("heading", { name: "Projects" }))
		.not.toBeInTheDocument();
	},
  );

  it("keeps page/sidebar subscribers synchronized and rejects a read older than a write", async () => {
	const { result } = renderHook(() => [
	  useOrganizationProjects(org),
	  useOrganizationProjects(org),
	]);

	await waitFor(() =>
	  expect(result.current.every(state => state.hasLoaded)).toBe(true),
	);

	let finish!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
	  () => new Promise(resolve => { finish = resolve; }),
	);

	act(() => result.current[0].reload());
	const signal = fetchMock.mock.calls.at(-1)![1]?.signal;

	const created = { ...project, id: other.id, name: "Created" };
	write = async () => json(created, 201);

	await act(async () => {
	  await createProject(org, { name: created.name });
	});

	expect(signal?.aborted).toBe(true);
	for (const state of result.current) {
	  expect(state.projects).toHaveLength(2);
	}

	await act(async () => { finish(json([])); });

	for (const state of result.current) {
	  expect(state.projects).toHaveLength(2);
	}

	write = async () => json({ ...created, name: "Renamed" });
	await act(async () => {
	  await updateProject(org, created.id, { name: "Renamed" });
	});

	for (const state of result.current) {
	  expect(state.projects.some(item => item.name === "Renamed"))
		.toBe(true);
	}

	write = async () => new Response(null, { status: 204 });
	await act(async () => {
	  await archiveProject(org, created.id);
	});

	for (const state of result.current) {
	  expect(state.projects).toEqual([project]);
	}
  });

  it("does not expose the old organization's list during or after a route change", async () => {
	let finish!: (response: Response) => void;
	fetchMock.mockImplementationOnce(
	  () => new Promise(resolve => { finish = resolve; }),
	);

	const { result, rerender } = renderHook(
	  ({ id }) => useOrganizationProjects(id),
	  { initialProps: { id: org } },
	);

	const signal = fetchMock.mock.calls[0][1]?.signal;

	rerender({ id: otherOrg });
	expect(result.current.projects).toEqual([]);

	await waitFor(() =>
	  expect(result.current.projects).toEqual([other]),
	);
	expect(signal?.aborted).toBe(true);

	await act(async () => { finish(json([project])); });

	expect(result.current.projects).toEqual([other]);
  });
  it("clears the projects page with a link back when creation returns ORGANIZATION_NOT_FOUND", async () => {
  	write = async () => json({
    	code: "ORGANIZATION_NOT_FOUND",
    	message: "Organization not found.",
  	}, 404);

  	const user = userEvent.setup();
  	view();

  	await user.type(await screen.findByLabelText("Project name"), "New project");
  	await user.click(screen.getByRole("button", { name: "Create" }));

  	expect(await screen.findByRole("alert")).toHaveTextContent("Organization not found.");
  	expect(screen.getByRole("link", { name: "Back to organizations" }))
    	.toHaveAttribute("href", "/organizations");
  	expect(screen.queryByLabelText("Project name")).not.toBeInTheDocument();
  	expect(screen.queryByText(project.name)).not.toBeInTheDocument();
  	expect(getAccessToken()).not.toBeNull();
});
