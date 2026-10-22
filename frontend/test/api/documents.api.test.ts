import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/http-client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/api/http-client")>();
  return {
    ...actual,
    apiGet: vi.fn(),
    apiDelete: vi.fn(),
    requestBlob: vi.fn(),
    uploadMultipart: vi.fn(),
  };
});

import { ApiError, apiDelete, apiGet, requestBlob, uploadMultipart } from "@/api/http-client";
import { deleteDocument, getDocumentContent, listDocuments, uploadDocument } from "@/api/documents.api";
import type { DocumentSummary } from "@/types/document.types";

const get = vi.mocked(apiGet);
const del = vi.mocked(apiDelete);
const blob = vi.mocked(requestBlob);
const upload = vi.mocked(uploadMultipart);

const summary: DocumentSummary = {
  id: "d1", projectId: "p1", originalName: "brief.pdf", mediaType: "application/pdf",
  sizeBytes: 12, createdAt: "2026-10-01T10:00:00.000Z",
};
const list = { items: [summary], page: 1, pageSize: 25, total: 1, totalPages: 1 };
// Identifiers that need encoding: a slash, a space and a query separator.
const org = "org/1", project = "proj 2?x", doc = "doc#3";
const base = "/organizations/org%2F1/projects/proj%202%3Fx/documents";

beforeEach(() => { vi.resetAllMocks(); });

describe("documents adapter", () => {
  it("encodes every route identifier for the list", async () => {
    get.mockResolvedValue(list);
    await listDocuments(org, project);
    expect(get).toHaveBeenCalledWith(base, { signal: undefined });
  });

  it("serializes only the supported pagination parameters and forwards the signal", async () => {
    get.mockResolvedValue(list);
    const controller = new AbortController();
    await listDocuments(org, project, { page: 2, pageSize: 50, sort: "name" } as never, controller.signal);
    expect(get).toHaveBeenCalledWith(base + "?page=2&pageSize=50", { signal: controller.signal });
  });

  it.each([
    ["missing items", { ...list, items: undefined }],
    ["unknown media type", { ...list, items: [{ ...summary, mediaType: "text/html" }] }],
    ["negative total", { ...list, total: -1 }],
    ["not an object", []],
  ])("rejects an invalid list response: %s", async (_name, body) => {
    get.mockResolvedValue(body);
    await expect(listDocuments(org, project)).rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("sends exactly one multipart field named file, without a manual content type", async () => {
    upload.mockResolvedValue(summary);
    const file = new File(["%PDF-1.4"], "brief.pdf", { type: "application/pdf" });
    const onProgress = vi.fn();
    const controller = new AbortController();
    await expect(uploadDocument(org, project, file, { signal: controller.signal, onProgress })).resolves.toEqual(summary);

    const [path, body, options] = upload.mock.calls[0];
    expect(path).toBe(base);
    expect(body).toBeInstanceOf(FormData);
    expect([...(body as FormData).keys()]).toEqual(["file"]);
    expect((body as FormData).get("file")).toBeInstanceOf(File);
    expect(options).toEqual({ signal: controller.signal, onProgress });
    expect(options).not.toHaveProperty("headers");
  });

  it("rejects an upload response that is not a document summary", async () => {
    upload.mockResolvedValue({ id: 1 });
    await expect(uploadDocument(org, project, new File(["x"], "a.txt")))
      .rejects.toMatchObject({ code: "INVALID_API_RESPONSE" });
  });

  it("uses download=false for preview and download=true for download", async () => {
    blob.mockResolvedValue(new Blob(["x"]));
    const controller = new AbortController();
    await getDocumentContent(org, project, doc, { signal: controller.signal });
    await getDocumentContent(org, project, doc, { download: true });
    expect(blob.mock.calls[0]).toEqual([`${base}/doc%233/content?download=false`, { signal: controller.signal }]);
    expect(blob.mock.calls[1]).toEqual([`${base}/doc%233/content?download=true`, { signal: undefined }]);
  });

  it("deletes without a body and resolves on 204", async () => {
    del.mockResolvedValue(undefined);
    const controller = new AbortController();
    await expect(deleteDocument(org, project, doc, controller.signal)).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith(`${base}/doc%233`, { signal: controller.signal });
  });

  it("propagates API errors unchanged, with no logout logic of its own", async () => {
    const failure = new ApiError(403, "INSUFFICIENT_ORGANIZATION_ROLE", "Forbidden.");
    get.mockRejectedValue(failure);
    upload.mockRejectedValue(failure);
    blob.mockRejectedValue(failure);
    del.mockRejectedValue(failure);
    await expect(listDocuments(org, project)).rejects.toBe(failure);
    await expect(uploadDocument(org, project, new File(["x"], "a.txt"))).rejects.toBe(failure);
    await expect(getDocumentContent(org, project, doc)).rejects.toBe(failure);
    await expect(deleteDocument(org, project, doc)).rejects.toBe(failure);
  });

  it("never retries automatically", async () => {
    upload.mockRejectedValue(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    del.mockRejectedValue(new ApiError(undefined, "NETWORK_ERROR", "offline"));
    await uploadDocument(org, project, new File(["x"], "a.txt")).catch(() => undefined);
    await deleteDocument(org, project, doc).catch(() => undefined);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });
});
