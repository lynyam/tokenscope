import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiKeysPage } from "@/pages/projects/ApiKeysPage";
import { saveAccessToken } from "@/api/auth-session";
import type { ApiKeySummary, CreatedApiKey } from "@/types/api-key.types";
import type { MembershipRole, Project } from "@/types/workspace.types";

const org = "00000000-0000-4000-8000-000000000001";
const otherOrg = "00000000-0000-4000-8000-000000000003";

const project: Project = {
  id: "00000000-0000-4000-8000-000000000002",
  organizationId: org,
  name: "Support",
  slug: "support",
  description: null,
  archivedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const other: Project = {
  ...project,
  id: "00000000-0000-4000-8000-000000000004",
  organizationId: otherOrg,
  name: "Other project",
};

const summary: ApiKeySummary = {
  id: "00000000-0000-4000-8000-000000000010",
  projectId: project.id,
  name: "CI",
  keyPrefix: "ts_test_ab",
  createdAt: "2026-09-01T00:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
};
// Obviously fake: never use a real key in tests.
const created: CreatedApiKey = {
  ...summary,
  id: "00000000-0000-4000-8000-000000000011",
  name: "New key",
  keyPrefix: "ts_test_cd",
  key: "ts_test_PLACEHOLDER_NOT_A_REAL_KEY",
};
const { key: _secret, ...createdSummary } = created;

const keysPath = "/organizations/" + org + "/projects/" + project.id + "/api-keys";
const otherKeysPath = "/organizations/" + otherOrg + "/projects/" + other.id + "/api-keys";
const projectUrl = "/api/v1/organizations/" + org + "/projects/" + project.id;
const otherProjectUrl = "/api/v1/organizations/" + otherOrg + "/projects/" + other.id;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fetchMock = vi.fn<typeof fetch>();
let role: MembershipRole;
let keys: ApiKeySummary[];
let archived: boolean;
let write: (url: RequestInfo | URL, options?: RequestInit) => Promise<Response>;

function view(path = keysPath) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Link to={otherKeysPath}>Open other project</Link>
      <Routes>
        <Route
          path="/organizations/:organizationId/projects/:projectId/api-keys"
          element={<ApiKeysPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

const writes = () => fetchMock.mock.calls.filter(([, options]) => options?.method !== "GET");
const listCalls = () =>
  fetchMock.mock.calls.filter(([url]) => url === projectUrl + "/api-keys");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

async function openCreate() {
  fireEvent.click(await screen.findByRole("button", { name: "Create API key" }));
  return screen.findByLabelText("Name");
}

function submitName(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  role = "OWNER";
  keys = [summary];
  archived = false;
  write = async () => { throw new Error("Unexpected write"); };

  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, options) => {
    if (options?.method !== "GET") return write(url, options);

    if (url === projectUrl) {
      return json({ ...project, archivedAt: archived ? "2026-09-02T00:00:00.000Z" : null });
    }
    if (url === projectUrl + "/api-keys") return json(keys);
    if (url === otherProjectUrl) return json(other);
    if (url === otherProjectUrl + "/api-keys") return json([]);

    if (url === "/api/v1/organizations/" + org || url === "/api/v1/organizations/" + otherOrg) {
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
  saveAccessToken("api-keys-ui-token");
});

it.each(["OWNER", "ADMIN"] as const)("%s sees the key list without any secret", async value => {
  role = value;
  view();

  expect(await screen.findByText("CI")).toBeInTheDocument();
  expect(screen.getByText("ts_test_ab…")).toBeInTheDocument();
  expect(screen.getByText("No recorded use.")).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create API key" })).toBeInTheDocument();
});

it("denies a MEMBER and never requests the list", async () => {
  role = "MEMBER";
  view();

  expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
  expect(listCalls()).toHaveLength(0);
});

it("shows an archived project without requesting the list", async () => {
  archived = true;
  view();

  expect(await screen.findByText(/project is archived/)).toBeInTheDocument();
  expect(listCalls()).toHaveLength(0);
});

it.each(["", "   ", "x".repeat(65)])("rejects the invalid name %j without any request", async value => {
  view();
  const input = await openCreate();

  submitName(input, value);

  expect(await screen.findByText("Use a name of 1–64 characters.")).toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});

it("creates once, trims the name and reveals the key only in the dialog", async () => {
  let finish!: (response: Response) => void;
  write = () => new Promise(resolve => { finish = resolve; });
  view();
  const input = await openCreate();

  act(() => {
    submitName(input, "  New key  ");
    fireEvent.submit(input.closest("form")!);
  });

  expect(writes()).toHaveLength(1);
  expect(JSON.parse(writes()[0][1]?.body as string)).toEqual({ name: "New key" });
  expect(input).toBeDisabled();

  keys = [createdSummary, summary];
  await act(async () => { finish(json(created, 201)); });

  expect(await screen.findByRole("textbox", { name: "API key" })).toHaveValue(created.key);
  expect(screen.getByText("Copy your new API key")).toBeInTheDocument();
});

it("shows Copied only after the clipboard accepted the key", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  stubClipboard(writeText);
  write = async () => { keys = [createdSummary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");

  fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

  expect(await screen.findByText("Copied to clipboard.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith(created.key);
});

it("offers manual copy when the clipboard refuses", async () => {
  stubClipboard(vi.fn().mockRejectedValue(new Error("denied")));
  write = async () => { keys = [createdSummary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");

  fireEvent.click(await screen.findByRole("button", { name: "Copy" }));

  expect(await screen.findByText(/Copy failed/)).toBeInTheDocument();
  expect(screen.queryByText("Copied to clipboard.")).toBeNull();
});

it("removes the secret from the page when the dialog is closed", async () => {
  write = async () => { keys = [createdSummary, summary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");
  await screen.findByRole("textbox", { name: "API key" });

  fireEvent.click(screen.getByRole("button", { name: "I have saved this key" }));

  await waitFor(() => expect(screen.queryByRole("textbox", { name: "API key" })).toBeNull());
  expect(document.body.textContent).not.toContain(created.key);
  expect(await screen.findByText("ts_test_cd…")).toBeInTheDocument();
});

it("cancels a revocation without sending anything", async () => {
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  expect(await screen.findByText("Revoke this key?")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  await waitFor(() => expect(screen.queryByText("Revoke this key?")).toBeNull());
  expect(writes()).toHaveLength(0);
});

it("revokes once even with a double click and shows the key as revoked", async () => {
  let finish!: (response: Response) => void;
  write = () => new Promise(resolve => { finish = resolve; });
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  const confirm = await screen.findByRole("button", { name: "Revoke key" });

  fireEvent.click(confirm);
  fireEvent.click(confirm);

  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]?.method).toBe("DELETE");
  expect(writes()[0][0]).toBe(projectUrl + "/api-keys/" + summary.id);

  keys = [{ ...summary, revokedAt: "2026-09-02T00:00:00.000Z" }];
  await act(async () => { finish(new Response(null, { status: 204 })); });

  expect(await screen.findByText(/^Revoked/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
});

it("closes the dialog and refreshes the list when the key no longer exists", async () => {
  write = async () => {
    keys = [];
    return json({ code: "API_KEY_NOT_FOUND", message: "API key not found." }, 404);
  };
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));

  expect(await screen.findByText(/no longer exists for this project/)).toBeInTheDocument();
  expect(screen.queryByText("Revoke this key?")).toBeNull();
  expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
  expect(listCalls().length).toBeGreaterThanOrEqual(2);
});

it("keeps the revoke dialog open on a rate limit and does not retry", async () => {
  write = async () => json({ code: "RATE_LIMITED", message: "Slow down." }, 429);
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));

  expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  expect(screen.getByText("Revoke this key?")).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
});

it("clears the secret and the controls when the role is lost during creation", async () => {
  write = async () => {
    role = "MEMBER";
    return json({ code: "INSUFFICIENT_ORGANIZATION_ROLE", message: "Forbidden." }, 403);
  };
  view();
  submitName(await openCreate(), "New key");

  expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "API key" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Create API key" })).toBeNull();
});

it("never repeats the POST after a lost response and refreshes the list", async () => {
  write = async () => { throw new TypeError("offline"); };
  view();
  submitName(await openCreate(), "New key");

  expect(await screen.findByText(/may or may not have been created/)).toBeInTheDocument();
  expect(writes()).toHaveLength(1);
  await waitFor(() => expect(listCalls().length).toBeGreaterThanOrEqual(2));
});

it("ignores a creation response that arrives after switching project", async () => {
  let finish!: (response: Response) => void;
  write = () => new Promise(resolve => { finish = resolve; });
  view();
  submitName(await openCreate(), "New key");

  fireEvent.click(screen.getByRole("link", { name: "Open other project", hidden: true }));
  expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();

  await act(async () => { finish(json(created, 201)); });

  expect(screen.queryByRole("textbox", { name: "API key" })).toBeNull();
  expect(document.body.textContent).not.toContain(created.key);
});

it("explains how to use a key without ever showing a real one", async () => {
  view();

  expect(await screen.findByRole("heading", { name: "Use a key" })).toBeInTheDocument();
  expect(screen.getByText(/browser JWT/)).toBeInTheDocument();
  expect(screen.getByText(/<PROJECT_API_KEY>/)).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "Public API documentation" });
  expect(link).toHaveAttribute("href", expect.stringContaining("docs/API.md"));
  expect(document.body.textContent).not.toContain("tsk_");
});

it("does not show the usage guidance to a MEMBER", async () => {
  role = "MEMBER";
  view();

  expect(await screen.findByText(/do not have permission/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Use a key" })).toBeNull();
});

it("keeps the draft and the dialog when the server rejects the name", async () => {
  write = async () => json({ code: "VALIDATION_ERROR", message: "Invalid request." }, 400);
  view();
  const input = await openCreate();

  submitName(input, "Draft name");

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveValue("Draft name");
  expect(writes()).toHaveLength(1);
});

it("shows loading, not an empty list, until the first answer arrives", async () => {
  const original = fetchMock.getMockImplementation()!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  fetchMock.mockImplementation(async (url, options) => {
    if (url === projectUrl + "/api-keys" && options?.method === "GET") await gate;
    return original(url, options);
  });
  keys = [];
  view();

  expect(await screen.findByText("Loading API keys…")).toBeInTheDocument();
  expect(screen.queryByText("No API keys yet.")).toBeNull();

  await act(async () => { release(); });
  expect(await screen.findByText("No API keys yet.")).toBeInTheDocument();
});

it("never turns a failed list request into an empty list, and Retry recovers", async () => {
  const original = fetchMock.getMockImplementation()!;
  let failing = true;
  fetchMock.mockImplementation(async (url, options) => {
    if (failing && url === projectUrl + "/api-keys" && options?.method === "GET") {
      return json({ code: "INTERNAL_ERROR", message: "Server error." }, 500);
    }
    return original(url, options);
  });
  view();

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("No API keys yet.")).toBeNull();

  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("CI")).toBeInTheDocument();
});

it("keeps the revoke dialog open on a server error and retries only on a deliberate click", async () => {
  let attempts = 0;
  write = async () => {
    attempts += 1;
    if (attempts === 1) return json({ code: "INTERNAL_ERROR", message: "Server error." }, 500);
    keys = [{ ...summary, revokedAt: "2026-09-02T00:00:00.000Z" }];
    return new Response(null, { status: 204 });
  };
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Revoke this key?")).toBeInTheDocument();
  expect(writes()).toHaveLength(1);

  fireEvent.click(screen.getByRole("button", { name: "Revoke key" }));
  expect(await screen.findByText(/^Revoked/)).toBeInTheDocument();
  expect(writes()).toHaveLength(2);
});

it("keeps the key as revoked when the refresh after a confirmed revocation fails", async () => {
  const original = fetchMock.getMockImplementation()!;
  let failList = false;
  fetchMock.mockImplementation(async (url, options) => {
    if (failList && url === projectUrl + "/api-keys" && options?.method === "GET") {
      return json({ code: "INTERNAL_ERROR", message: "Server error." }, 500);
    }
    return original(url, options);
  });
  write = async () => {
    failList = true;
    return new Response(null, { status: 204 });
  };
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
  fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));

  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByText("Revoked")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
});

it("clears the page and offers navigation when the project disappears during creation", async () => {
  write = async () => json({ code: "PROJECT_NOT_FOUND", message: "Project not found." }, 404);
  view();
  submitName(await openCreate(), "Gone");

  expect(await screen.findByText("Project not found.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Back to projects" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "API key" })).toBeNull();
  expect(screen.queryByText("CI")).toBeNull();
});

it("asks for confirmation instead of discarding the secret on Escape", async () => {
  write = async () => { keys = [createdSummary, summary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");
  const field = await screen.findByRole("textbox", { name: "API key" });

  fireEvent.keyDown(field, { key: "Escape" });

  expect(await screen.findByText("Close without saving?")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "API key" })).toBeInTheDocument();
});

it("goes back to the key when Escape is pressed again during the confirmation", async () => {
  write = async () => { keys = [createdSummary, summary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");
  const field = await screen.findByRole("textbox", { name: "API key" });
  fireEvent.keyDown(field, { key: "Escape" });
  await screen.findByText("Close without saving?");

  fireEvent.keyDown(screen.getByRole("button", { name: "Keep key visible" }), { key: "Escape" });

  await waitFor(() => expect(screen.queryByText("Close without saving?")).toBeNull());
  expect(screen.getByRole("textbox", { name: "API key" })).toBeInTheDocument();
});

it("keeps the secret visible when the user chooses to keep it", async () => {
  write = async () => { keys = [createdSummary, summary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");
  const field = await screen.findByRole("textbox", { name: "API key" });
  fireEvent.keyDown(field, { key: "Escape" });

  fireEvent.click(await screen.findByRole("button", { name: "Keep key visible" }));

  await waitFor(() => expect(screen.queryByText("Close without saving?")).toBeNull());
  expect(screen.getByRole("textbox", { name: "API key" })).toHaveFocus();
});

it("discards the secret only after an explicit confirmation", async () => {
  write = async () => { keys = [createdSummary, summary]; return json(created, 201); };
  view();
  submitName(await openCreate(), "New key");
  const field = await screen.findByRole("textbox", { name: "API key" });
  fireEvent.keyDown(field, { key: "Escape" });

  fireEvent.click(await screen.findByRole("button", { name: "Close and discard" }));

  await waitFor(() => expect(screen.queryByRole("textbox", { name: "API key" })).toBeNull());
  expect(screen.queryByDisplayValue(created.key)).toBeNull();
});
