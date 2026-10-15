import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/documents.api");
vi.mock("@/api/organizations.api");
vi.mock("@/api/projects.api");

import { ApiError } from "@/api/http-client";
import { clearAuthSession, saveAccessToken } from "@/api/auth-session";
import { deleteDocument, getDocumentContent, listDocuments, uploadDocument } from "@/api/documents.api";
import { getOrganization } from "@/api/organizations.api";
import { getOrganizationProject } from "@/api/projects.api";
import { DocumentsPage } from "@/pages/documents/DocumentsPage";
import { MAX_DOCUMENT_BYTES } from "@/pages/documents/document-file";
import type { DocumentListResponse, DocumentSummary } from "@/types/document.types";
import type { MembershipRole, Project } from "@/types/workspace.types";

const org = "org-1", proj = "proj-1", otherProj = "proj-2";
const path = (id = proj) => `/organizations/${org}/projects/${id}/documents`;

const project = (id: string, extra: Partial<Project> = {}): Project => ({
  id, organizationId: org, name: `Project ${id}`, slug: id, description: null, archivedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", ...extra,
});
const doc = (id: string, name = `${id}.pdf`, extra: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id, projectId: proj, originalName: name, mediaType: "application/pdf", sizeBytes: 2048,
  createdAt: "2026-10-01T10:00:00.000Z", ...extra,
});
const page = (items: DocumentSummary[], extra: Partial<DocumentListResponse> = {}): DocumentListResponse => ({
  items, page: 1, pageSize: 25, total: items.length, totalPages: items.length ? 1 : 0, ...extra,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const apiError = (status: number, code: string) => new ApiError(status, code, "Server said no.");

const list = vi.mocked(listDocuments);
const upload = vi.mocked(uploadDocument);
const remove = vi.mocked(deleteDocument);
const content = vi.mocked(getDocumentContent);
const organization = vi.mocked(getOrganization);
const projectApi = vi.mocked(getOrganizationProject);

let role: MembershipRole;

function setRole(next: MembershipRole) {
  role = next;
  organization.mockImplementation(async () => ({
    id: org, name: "Org", slug: "org", createdAt: "", updatedAt: "", currentUserRole: role,
  }));
}

function view(initial = path()) {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Link to={path(otherProj)}>Open other project</Link>
      <Routes>
        <Route path="/organizations/:organizationId/projects/:projectId/documents" element={<DocumentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function choose(file: File) {
  fireEvent.change(screen.getByLabelText(/Document \(PDF, TXT or Markdown/), { target: { files: [file] } });
}
const pdf = (name = "brief.pdf", size = 1024) => {
  const file = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  Object.defineProperty(file, "size", { value: size });
  return file;
};

beforeEach(() => {
  vi.resetAllMocks();
  saveAccessToken("alice-token");
  setRole("OWNER");
  projectApi.mockImplementation(async (_org, id) => project(id));
  list.mockResolvedValue(page([doc("d1", "first.pdf"), doc("d2", "second.pdf")]));
});

describe("list states", () => {
  it("shows loading, then rows with type, size, date and actions; never 'No documents' before a response", async () => {
    const pending = deferred<DocumentListResponse>();
    list.mockReturnValue(pending.promise);
    view();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1)); // Access resolved; the list is now pending.
    expect(screen.getByText("Loading documents…")).toBeInTheDocument();
    expect(screen.queryByText(/No documents/)).not.toBeInTheDocument();
    await act(async () => pending.resolve(page([doc("d1", "first.pdf")])));
    expect(await screen.findByText("first.pdf")).toBeInTheDocument();
    expect(screen.getByText("PDF")).toBeInTheDocument();
    expect(screen.getByText("2 KiB")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Preview first\.pdf/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Download first\.pdf/ })).toBeInTheDocument();
    expect(screen.getByText(/not used by the assistant/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(org, proj, { page: 1, pageSize: 25 }, expect.any(AbortSignal));
  });

  it("shows the empty state only after a successful empty response", async () => {
    list.mockResolvedValue(page([]));
    view();
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });

  it("shows a retryable error instead of a false empty state", async () => {
    list.mockRejectedValueOnce(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unable to reach the server/);
    expect(screen.queryByText(/No documents/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("first.pdf")).toBeInTheDocument();
  });

  it("keeps existing rows visible with an explicit error when a refresh fails", async () => {
    view();
    await screen.findByText("first.pdf");
    list.mockRejectedValueOnce(apiError(503, "STORAGE_UNAVAILABLE"));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
    expect(screen.getByText("first.pdf")).toBeInTheDocument();
  });

  it("paginates with the backend's page numbers", async () => {
    list.mockResolvedValueOnce(page([doc("d1")], { total: 30, totalPages: 2 }));
    view();
    await screen.findByText("Page 1 of 2");
    list.mockResolvedValueOnce(page([doc("d26", "late.pdf")], { page: 2, total: 30, totalPages: 2 }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("late.pdf")).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(org, proj, { page: 2, pageSize: 25 }, expect.any(AbortSignal));
  });

  it.each([
    ["project 404", apiError(404, "PROJECT_NOT_FOUND")],
  ])("shows an unavailable state without logging out: %s", async (_name, failure) => {
    list.mockRejectedValue(failure);
    view();
    expect(await screen.findByText("This project is no longer available.")).toBeInTheDocument();
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
    expect(localStorage.getItem("tokenscope.accessToken")).toBe("alice-token");
  });

  it("shows an unavailable state for an archived project and never lists documents", async () => {
    projectApi.mockResolvedValue(project(proj, { archivedAt: "2026-10-02T00:00:00.000Z" }));
    view();
    expect(await screen.findByText("This project is archived.")).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("roles", () => {
  it.each(["OWNER", "ADMIN"] as const)("%s sees upload and delete controls", async next => {
    setRole(next);
    view();
    await screen.findByText("first.pdf");
    expect(screen.getByLabelText(/Document \(PDF/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Delete / })).toHaveLength(2);
  });

  it("MEMBER can preview and download but sees no management controls", async () => {
    setRole("MEMBER");
    view();
    await screen.findByText("first.pdf");
    expect(screen.queryByLabelText(/Document \(PDF/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Preview first/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Download first/ })).toBeInTheDocument();
  });

  it("waits for the access result: nothing is requested or shown while the role is unknown", async () => {
    const pending = deferred<never>();
    organization.mockReturnValue(pending.promise);
    view();
    expect(await screen.findByText("Loading documents…")).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/Document \(PDF/)).not.toBeInTheDocument();
  });

  it("403 removes management controls, refreshes the role and keeps read access", async () => {
    view();
    await screen.findByText("first.pdf");
    upload.mockRejectedValue(apiError(403, "INSUFFICIENT_ORGANIZATION_ROLE"));
    choose(pdf());
    setRole("MEMBER"); // The backend now reports the downgraded role.
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.queryByLabelText(/Document \(PDF/)).not.toBeInTheDocument());
    expect(organization).toHaveBeenCalledTimes(2);
    expect(screen.getByText("first.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(localStorage.getItem("tokenscope.accessToken")).toBe("alice-token");
  });
});

describe("upload", () => {
  it.each([
    ["notes.exe", 10, /PDF, TXT or Markdown/],
    ["empty.txt", 0, /empty/],
    ["huge.pdf", MAX_DOCUMENT_BYTES + 1, /10 MiB/],
  ])("rejects %s locally without any request", async (name, size, message) => {
    view();
    await screen.findByText("first.pdf");
    choose(pdf(name, size));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("selecting a file does not start the upload", async () => {
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    expect(screen.getByText(/Selected: brief\.pdf/)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("rapid double submission produces exactly one upload", async () => {
    const pending = deferred<DocumentSummary>();
    upload.mockReturnValue(pending.promise);
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    const button = screen.getByRole("button", { name: "Upload" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(button.closest("form")!);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Document \(PDF/)).toBeDisabled(); // The selection cannot be replaced mid-upload.
    await act(async () => pending.resolve(doc("d9", "brief.pdf")));
  });

  it("shows real progress, then Processing at 100% until the backend answers 201", async () => {
    const pending = deferred<DocumentSummary>();
    let onProgress!: (p: { loaded: number; total?: number }) => void;
    upload.mockImplementation((_o, _p, _f, options) => { onProgress = options!.onProgress!; return pending.promise; });
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));

    act(() => onProgress({ loaded: 25, total: 100 }));
    expect(screen.getByRole("progressbar", { name: "Upload progress" })).toHaveAttribute("value", "25");
    expect(screen.getByText("Uploading brief.pdf…")).toBeInTheDocument();

    act(() => onProgress({ loaded: 100, total: 100 }));
    expect(screen.getByText("Processing file…")).toBeInTheDocument();
    expect(screen.queryByText(/was uploaded/)).not.toBeInTheDocument(); // 100% is not success.

    list.mockResolvedValueOnce(page([doc("d9", "brief.pdf")]));
    await act(async () => pending.resolve(doc("d9", "brief.pdf")));
    expect(await screen.findByText('"brief.pdf" was uploaded.')).toBeInTheDocument();
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(org, proj, { page: 1, pageSize: 25 }, expect.any(AbortSignal));
  });

  it("shows indeterminate progress when the total is unknown", async () => {
    let onProgress!: (p: { loaded: number; total?: number }) => void;
    upload.mockImplementation((_o, _p, _f, options) => { onProgress = options!.onProgress!; return new Promise(() => undefined); });
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    act(() => onProgress({ loaded: 4096 }));
    const bar = screen.getByRole("progressbar", { name: "Upload progress" });
    expect(bar).not.toHaveAttribute("value");
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("keeps the upload marked successful, and offers list Retry, when the refresh after 201 fails", async () => {
    upload.mockResolvedValue(doc("d9", "brief.pdf"));
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    list.mockRejectedValueOnce(apiError(503, "STORAGE_UNAVAILABLE"));
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText('"brief.pdf" was uploaded.')).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    list.mockResolvedValueOnce(page([doc("d9", "brief.pdf")]));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("brief.pdf")).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1); // Never encourages or performs a second upload.
  });

  it("Cancel aborts the request, explains the uncertain outcome and reconciles the list without re-uploading", async () => {
    let signal!: AbortSignal;
    upload.mockImplementation((_o, _p, _f, options) => {
      signal = options!.signal!;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    const before = list.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Cancel upload" }));
    expect(signal.aborted).toBe(true);
    expect(await screen.findByText(/Upload cancelled\. If the server had already finished saving/)).toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBe(before + 1));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Upload" })).toBeEnabled(); // A deliberate new attempt is possible.
  });

  it("a network failure reconciles the list and never resubmits automatically", async () => {
    upload.mockRejectedValue(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    const before = list.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText(/may or may not have been saved/)).toBeInTheDocument();
    await waitFor(() => expect(list.mock.calls.length).toBe(before + 1));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it.each([
    [413, "PAYLOAD_TOO_LARGE", /10 MiB/],
    [415, "UNSUPPORTED_MEDIA_TYPE", /PDF, TXT and Markdown/],
    [422, "INVALID_DOCUMENT_CONTENT", /could not be read/],
    [429, "RATE_LIMITED", /Too many uploads/],
    [503, "STORAGE_UNAVAILABLE", /temporarily unavailable/],
  ])("explains HTTP %i without leaving the session", async (status, code, message) => {
    upload.mockRejectedValue(apiError(status, code));
    view();
    await screen.findByText("first.pdf");
    choose(pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText("Server said no.")).not.toBeInTheDocument();
    expect(localStorage.getItem("tokenscope.accessToken")).toBe("alice-token");
  });

  it("unmounting aborts the transfer without refreshing the page being left", async () => {
    let signal!: AbortSignal;
    upload.mockImplementation((_o, _p, _f, options) => {
      signal = options!.signal!;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
    });
    const { unmount } = view();
    await screen.findByText("first.pdf");
    choose(pdf());
    await userEvent.click(screen.getByRole("button", { name: "Upload" }));
    const before = list.mock.calls.length;
    unmount();
    await act(async () => undefined);
    expect(signal.aborted).toBe(true);
    expect(list.mock.calls.length).toBe(before);
  });
});

describe("deletion", () => {
  async function openDelete(name = "first.pdf") {
    await screen.findByText(name);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^Delete ${name.replace(".", "\\.")}`) }));
    return screen.getByRole("dialog");
  }

  it("shows the filename and the required explanation; Cancel sends no request", async () => {
    view();
    const dialog = await openDelete();
    expect(within(dialog).getByText(/Delete this document\? It will no longer be available in this project\. This action cannot be undone\./)).toBeInTheDocument();
    expect(within(dialog).getByText("first.pdf")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("confirmation sends one DELETE even if clicked repeatedly, then removes the row and refetches", async () => {
    const pending = deferred<void>();
    remove.mockReturnValue(pending.promise);
    view();
    const dialog = await openDelete();
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(org, proj, "d1", expect.any(AbortSignal));
    expect(within(dialog).getByRole("button", { name: "Deleting…" })).toBeDisabled();

    list.mockResolvedValueOnce(page([doc("d2", "second.pdf")]));
    await act(async () => pending.resolve());
    await waitFor(() => expect(screen.queryByText("first.pdf")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("second.pdf")).toBeInTheDocument();
  });

  it("keeps the dialog and shows the error when deletion fails", async () => {
    remove.mockRejectedValue(apiError(503, "STORAGE_UNAVAILABLE"));
    view();
    const dialog = await openDelete();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("first.pdf").length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" })); // Deliberate retry is possible.
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("does not restore the row nor call the deletion failed when the refresh after 204 fails", async () => {
    remove.mockResolvedValue(undefined);
    view();
    const dialog = await openDelete();
    list.mockRejectedValueOnce(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Unable to reach/);
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
    expect(screen.getByText('"first.pdf" was deleted.')).toBeInTheDocument();
  });

  it("moves to the last valid page once after deleting the last row of the current page", async () => {
    list.mockResolvedValueOnce(page([doc("d26", "only-on-page-2.pdf")], { page: 2, total: 26, totalPages: 2 }));
    remove.mockResolvedValue(undefined);
    view();
    const dialog = await openDelete("only-on-page-2.pdf");
    list
      .mockResolvedValueOnce(page([], { page: 2, total: 25, totalPages: 1 })) // Page 2 no longer exists.
      .mockResolvedValueOnce(page([doc("d1", "first.pdf")], { page: 1, total: 25, totalPages: 1 }));
    const before = list.mock.calls.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("first.pdf")).toBeInTheDocument();
    expect(list.mock.calls.length).toBe(before + 2); // Original page, then one correction: no loop.
    expect(list).toHaveBeenLastCalledWith(org, proj, { page: 1, pageSize: 25 }, expect.any(AbortSignal));
  });

  it("404 DOCUMENT_NOT_FOUND closes the dialog, explains and reconciles while the project stays accessible", async () => {
    remove.mockRejectedValue(apiError(404, "DOCUMENT_NOT_FOUND"));
    view();
    const dialog = await openDelete();
    list.mockResolvedValueOnce(page([doc("d2", "second.pdf")]));
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/no longer available\. The list has been refreshed/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(await screen.findByText("second.pdf")).toBeInTheDocument();
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
  });

  it("404 PROJECT_NOT_FOUND clears every protected row and closes dialogs", async () => {
    remove.mockRejectedValue(apiError(404, "PROJECT_NOT_FOUND"));
    view();
    const dialog = await openDelete();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("This project is no longer available.")).toBeInTheDocument();
    expect(screen.queryByText("second.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("lifecycle: late responses", () => {
  it("an old project's list response cannot update the new project's view", async () => {
    const oldList = deferred<DocumentListResponse>();
    list.mockReturnValueOnce(oldList.promise);
    view();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    list.mockResolvedValueOnce(page([doc("n1", "new-project.pdf")]));
    await userEvent.click(screen.getByRole("link", { name: "Open other project" }));
    expect(await screen.findByText("new-project.pdf")).toBeInTheDocument();
    await act(async () => oldList.resolve(page([doc("o1", "old-project.pdf")])));
    expect(screen.queryByText("old-project.pdf")).not.toBeInTheDocument();
  });

  it("clears the previous project's rows immediately on project change", async () => {
    view();
    await screen.findByText("first.pdf");
    list.mockReturnValueOnce(new Promise(() => undefined));
    await userEvent.click(screen.getByRole("link", { name: "Open other project" }));
    expect(screen.queryByText("first.pdf")).not.toBeInTheDocument();
  });

  it("signing out discards all rows without any further request or remount loop", async () => {
    view();
    await screen.findByText("first.pdf");
    const before = list.mock.calls.length;
    act(() => clearAuthSession());
    await waitFor(() => expect(screen.queryByText("first.pdf")).not.toBeInTheDocument());
    expect(localStorage.getItem("tokenscope.accessToken")).toBeNull();
    expect(list.mock.calls.length).toBe(before);
    expect(organization).toHaveBeenCalledTimes(1);
  });

  it("an old session's late list response is ignored once another login replaced the session", async () => {
    const late = deferred<DocumentListResponse>();
    list.mockReturnValueOnce(late.promise);
    view();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    saveAccessToken("bob-token");
    list.mockResolvedValueOnce(page([doc("b1", "bob-view.pdf")]));
    await act(async () => late.resolve(page([doc("a1", "alice-view.pdf")])));
    expect(screen.queryByText("alice-view.pdf")).not.toBeInTheDocument();
    expect(await screen.findByText("bob-view.pdf")).toBeInTheDocument();
  });
});

describe("download", () => {
  let clicked: Array<{ download: string; href: string }>;
  beforeEach(() => {
    clicked = [];
    URL.createObjectURL = vi.fn(() => "blob:fake-url");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
  });

  it("requests download=true through the Blob helper and clicks a temporary object URL with the known filename", async () => {
    content.mockResolvedValue(new Blob(["bytes"], { type: "application/pdf" }));
    view();
    await screen.findByText("first.pdf");
    const timers = vi.spyOn(globalThis, "setTimeout");
    await userEvent.click(screen.getByRole("button", { name: /^Download first\.pdf/ }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    expect(content).toHaveBeenCalledWith(org, proj, "d1", { download: true, signal: expect.any(AbortSignal) });
    expect(clicked[0]).toEqual({ download: "first.pdf", href: "blob:fake-url" });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    // After the browser had its chance to start the download the URL and element are released.
    const release = timers.mock.calls.find(call => call[1] === 1000)![0] as () => void;
    release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("allows only one active download per document", async () => {
    const pending = deferred<Blob>();
    content.mockReturnValue(pending.promise);
    view();
    await screen.findByText("first.pdf");
    const button = screen.getByRole("button", { name: /^Download first\.pdf/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(content).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => pending.resolve(new Blob(["x"])));
  });

  it("a stale response never starts a download after the page was left", async () => {
    const pending = deferred<Blob>();
    content.mockReturnValue(pending.promise);
    const { unmount } = view();
    await screen.findByText("first.pdf");
    await userEvent.click(screen.getByRole("button", { name: /^Download first\.pdf/ }));
    unmount();
    await act(async () => pending.resolve(new Blob(["late"])));
    expect(clicked).toHaveLength(0);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("unmounting releases an object URL that is still waiting for its timer", async () => {
    content.mockResolvedValue(new Blob(["x"]));
    const { unmount } = view();
    await screen.findByText("first.pdf");
    await userEvent.click(screen.getByRole("button", { name: /^Download first\.pdf/ }));
    await waitFor(() => expect(clicked).toHaveLength(1));
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("shows a retrieval failure beside the row and never downloads an error body", async () => {
    content.mockRejectedValue(apiError(503, "STORAGE_UNAVAILABLE"));
    view();
    await screen.findByText("first.pdf");
    await userEvent.click(screen.getByRole("button", { name: /^Download first\.pdf/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/);
    expect(clicked).toHaveLength(0);
  });
});

describe("preview entry point", () => {
  it("opens the preview dialog only when Preview is selected", async () => {
    content.mockResolvedValue(new Blob(["hello"], { type: "text/plain" }));
    list.mockResolvedValue(page([doc("t1", "note.txt", { mediaType: "text/plain" })]));
    view();
    await screen.findByText("note.txt");
    expect(content).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^Preview note\.txt/ }));
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(content).toHaveBeenCalledWith(org, proj, "t1", { signal: expect.any(AbortSignal) });
  });

  it("closes the preview and reconciles the list when its document is gone", async () => {
    list.mockResolvedValueOnce(page([doc("t1", "note.txt", { mediaType: "text/plain" })]));
    content.mockRejectedValue(apiError(404, "DOCUMENT_NOT_FOUND"));
    view();
    await screen.findByText("note.txt");
    list.mockResolvedValueOnce(page([]));
    await userEvent.click(screen.getByRole("button", { name: /^Preview note\.txt/ }));
    expect(await screen.findByText(/no longer available\. The list has been refreshed/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("note.txt")).not.toBeInTheDocument());
  });
});
