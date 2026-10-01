import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  archiveProject,
  createProject,
  getOrganizationProject,
  getOrganizationProjects,
  updateProject,
} from "@/api/projects.api";
import { subscribeToProjectChanges } from "@/api/project-events";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import type { Project } from "@/types/workspace.types";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000002",
  organizationId: "00000000-0000-4000-8000-000000000001",
  name: "Support",
  slug: "support",
  description: "Support requests",
  archivedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const base =
  "/api/v1/organizations/" + project.organizationId + "/projects";

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let unsubscribe = () => {};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  saveAccessToken("project-token");
});

afterEach(() => unsubscribe());

it("uses all five endpoints with the shared token and signal; publishes confirmed writes", async () => {
  const listener = vi.fn();
  unsubscribe = subscribeToProjectChanges(listener);

  const controller = new AbortController();
  const updated = { ...project, name: "Renamed", description: null };

  fetchMock
    .mockResolvedValueOnce(json([project]))
    .mockResolvedValueOnce(json(project))
    .mockResolvedValueOnce(json(project, 201))
    .mockResolvedValueOnce(json(updated))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));

  expect(
    await getOrganizationProjects(project.organizationId, controller.signal),
  ).toEqual([project]);

  expect(
    await getOrganizationProject(
      project.organizationId,
      project.id,
      controller.signal,
    ),
  ).toEqual(project);

  expect(
    await createProject(
      project.organizationId,
      { name: project.name },
      controller.signal,
    ),
  ).toEqual(project);

  expect(
    await updateProject(
      project.organizationId,
      project.id,
      { name: "Renamed", description: null },
      controller.signal,
    ),
  ).toEqual(updated);

  await archiveProject(
    project.organizationId,
    project.id,
    controller.signal,
  );

  expect(
    fetchMock.mock.calls.map(([url, options]) => [url, options?.method]),
  ).toEqual([
    [base, "GET"],
    [base + "/" + project.id, "GET"],
    [base, "POST"],
    [base + "/" + project.id, "PATCH"],
    [base + "/" + project.id, "DELETE"],
  ]);

  for (const [, options] of fetchMock.mock.calls) {
    expect(new Headers(options?.headers).get("Authorization"))
      .toBe("Bearer project-token");
    expect(options?.signal).toBe(controller.signal);
  }

  expect(fetchMock.mock.calls[2][1]?.body)
    .toBe(JSON.stringify({ name: project.name }));
  expect(fetchMock.mock.calls[3][1]?.body)
    .toBe(JSON.stringify({ name: "Renamed", description: null }));
  expect(fetchMock.mock.calls[4][1]?.body).toBeUndefined();

  expect(listener.mock.calls.map(([change]) => change)).toEqual([
    { organizationId: project.organizationId, kind: "upsert", project },
    {
      organizationId: project.organizationId,
      kind: "upsert",
      project: updated,
    },
    {
      organizationId: project.organizationId,
      kind: "archive",
      projectId: project.id,
    },
  ]);
});

it("encodes both IDs and sends only allowed fields, preserving omission versus null", async () => {
  const org = "org/with ?#";
  const id = "project/with ?#";

  fetchMock.mockImplementation(async (_url, options) =>
    options?.method === "DELETE"
      ? new Response(null, { status: 204 })
      : json(project),
  );

  await getOrganizationProjects(org);
  await getOrganizationProject(org, id);

  const creation = {
    name: "Support",
    description: "Text",
    slug: "injected",
  };
  const update = {
    description: null,
    archivedAt: "injected",
  };

  await createProject(org, creation);
  await updateProject(org, id, update);
  await archiveProject(org, id);

  const collection =
    "/api/v1/organizations/" + encodeURIComponent(org) + "/projects";

  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    collection,
    collection + "/" + encodeURIComponent(id),
    collection,
    collection + "/" + encodeURIComponent(id),
    collection + "/" + encodeURIComponent(id),
  ]);

  expect(fetchMock.mock.calls[2][1]?.body)
    .toBe(JSON.stringify({ name: "Support", description: "Text" }));
  expect(fetchMock.mock.calls[3][1]?.body)
    .toBe(JSON.stringify({ description: null }));
});

it.each([400, 403, 404, 409, 503])(
  "preserves %i errors and authentication without publishing a write",
  async status => {
    const listener = vi.fn();
    unsubscribe = subscribeToProjectChanges(listener);

    fetchMock.mockResolvedValue(json({
      code: "REJECTED",
      message: "Request rejected.",
      requestId: "project-1",
    }, status));

    await expect(
      createProject(project.organizationId, { name: "Support" }),
    ).rejects.toMatchObject({
      statusCode: status,
      code: "REJECTED",
      requestId: "project-1",
    });

    expect(getAccessToken()).toBe("project-token");
    expect(listener).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  },
);

it("lets the shared client invalidate a protected 401", async () => {
  fetchMock.mockResolvedValue(json({
    code: "ACCESS_TOKEN_EXPIRED",
    message: "Expired.",
  }, 401));

  await expect(
    getOrganizationProjects(project.organizationId),
  ).rejects.toMatchObject({ statusCode: 401 });

  expect(getAccessToken()).toBeNull();
});

it("does not publish a late successful response after cancellation", async () => {
  const listener = vi.fn();
  unsubscribe = subscribeToProjectChanges(listener);

  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () => new Promise(resolve => { finish = resolve; }),
  );

  const controller = new AbortController();
  const result = createProject(
    project.organizationId,
    { name: "Support" },
    controller.signal,
  );

  const assertion = expect(result)
    .rejects.toMatchObject({ name: "AbortError" });

  controller.abort();
  finish(json(project, 201));

  await assertion;
  expect(listener).not.toHaveBeenCalled();
});
