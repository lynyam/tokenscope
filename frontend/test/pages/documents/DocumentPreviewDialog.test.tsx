import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/documents.api");
vi.mock("@/pages/documents/pdf-preview");

import { ApiError } from "@/api/http-client";
import { getDocumentContent } from "@/api/documents.api";
import { startPdfPreview } from "@/pages/documents/pdf-preview";
import { DocumentPreviewDialog } from "@/pages/documents/DocumentPreviewDialog";
import { MAX_DOCUMENT_BYTES, PREVIEW_TEXT_BYTES } from "@/pages/documents/document-file";
import type { DocumentSummary } from "@/types/document.types";

const content = vi.mocked(getDocumentContent);
const startPdf = vi.mocked(startPdfPreview);

const textDoc: DocumentSummary = {
  id: "t1", projectId: "p", originalName: "note.txt", mediaType: "text/plain", sizeBytes: 20, createdAt: "2026-10-01T10:00:00.000Z",
};
const mdDoc: DocumentSummary = { ...textDoc, id: "m1", originalName: "guide.md", mediaType: "text/markdown" };
const pdfDoc: DocumentSummary = { ...textDoc, id: "p1", originalName: "brief.pdf", mediaType: "application/pdf" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function open(document: DocumentSummary | null, extra: Partial<Parameters<typeof DocumentPreviewDialog>[0]> = {}) {
  const props = {
    organizationId: "o", projectId: "p", document, onClose: vi.fn(), onDownload: vi.fn(), isDownloading: false,
    onFailure: vi.fn(), ...extra,
  };
  const view = render(<DocumentPreviewDialog {...props} />);
  return { ...view, props, rerenderWith: (next: DocumentSummary | null) => view.rerender(<DocumentPreviewDialog {...props} document={next} />) };
}

/** A PDF.js boundary double whose completion and destruction the test controls. */
function pdfDouble() {
  const pageCount = deferred<number>();
  const destroy = vi.fn(async () => undefined);
  startPdf.mockReturnValue({ pageCount: pageCount.promise, destroy });
  return { pageCount, destroy };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("text and Markdown preview", () => {
  it("shows HTML-like and Markdown content as escaped plain text", async () => {
    const source = '# Title\n<img src=x onerror="alert(1)">\n<script>window.pwned = 1</script>\n[link](https://evil.test)';
    content.mockResolvedValue(new Blob([source], { type: "text/markdown; charset=utf-8" }));
    open(mdDoc);
    const pre = await screen.findByLabelText("Contents of guide.md");
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toBe(source);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
    expect(pre.querySelector("a")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("requests the content without download and passes an abort signal", async () => {
    content.mockResolvedValue(new Blob(["hi"], { type: "text/plain" }));
    open(textDoc);
    await screen.findByText("hi");
    expect(content).toHaveBeenCalledWith("o", "p", "t1", { signal: expect.any(AbortSignal) });
  });

  it("truncates to the first 100 KiB with the documented notice, without a broken trailing character", async () => {
    content.mockResolvedValue(new Blob(["a" + "é".repeat(PREVIEW_TEXT_BYTES)], { type: "text/plain" }));
    open(textDoc);
    const pre = await screen.findByLabelText("Contents of note.txt");
    expect(screen.getByText("Preview truncated. Download the file to read it completely.")).toBeInTheDocument();
    expect(pre.textContent).not.toContain("�");
    expect(new TextEncoder().encode(pre.textContent ?? "").length).toBeLessThanOrEqual(PREVIEW_TEXT_BYTES);
  });

  it("does not claim truncation for a small file", async () => {
    content.mockResolvedValue(new Blob(["small"], { type: "text/plain" }));
    open(textDoc);
    await screen.findByText("small");
    expect(screen.queryByText(/Preview truncated/)).not.toBeInTheDocument();
  });

  it("reports genuinely invalid UTF-8 as a preview error while keeping Download", async () => {
    content.mockResolvedValue(new Blob([new Uint8Array([0x61, 0xff, 0xfe])], { type: "text/plain" }));
    const { props } = open(textDoc);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid UTF-8/);
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(props.onDownload).toHaveBeenCalledWith(textDoc);
  });

  it("rejects a Blob whose media type differs from the selected document", async () => {
    content.mockResolvedValue(new Blob(["<html>login</html>"], { type: "text/html" }));
    open(textDoc);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unexpected file type/);
    expect(screen.queryByText("<html>login</html>")).not.toBeInTheDocument();
  });

  it("rejects an unexpectedly oversized Blob before rendering", async () => {
    const big = new Blob(["x"], { type: "text/plain" });
    Object.defineProperty(big, "size", { value: MAX_DOCUMENT_BYTES + 1 });
    content.mockResolvedValue(big);
    open(textDoc);
    expect(await screen.findByRole("alert")).toHaveTextContent(/unexpectedly large/);
  });

  it("keeps retrieval errors visible inside the dialog and reports them to the page", async () => {
    const failure = new ApiError(404, "DOCUMENT_NOT_FOUND", "gone");
    content.mockRejectedValue(failure);
    const { props } = open(textDoc);
    expect(await screen.findByRole("alert")).toHaveTextContent("This document is no longer available.");
    expect(props.onFailure).toHaveBeenCalledWith(failure, textDoc);
  });
});

describe("lifecycle", () => {
  it("aborts the pending retrieval when the dialog closes and ignores the late response", async () => {
    const pending = deferred<Blob>();
    let signal!: AbortSignal;
    content.mockImplementation((_o, _p, _d, options) => { signal = options!.signal!; return pending.promise; });
    const { rerenderWith, props } = open(textDoc);
    await waitFor(() => expect(content).toHaveBeenCalled());
    rerenderWith(null);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(new Blob(["late"], { type: "text/plain" })));
    expect(screen.queryByText("late")).not.toBeInTheDocument();
    expect(props.onFailure).not.toHaveBeenCalled();
  });

  it("an intentional abort never surfaces as an error or an unhandled rejection", async () => {
    // Vitest fails the whole run on any unhandled rejection, so reaching the end proves there was none.
    content.mockImplementation((_o, _p, _d, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const { rerenderWith, props } = open(textDoc);
    await waitFor(() => expect(content).toHaveBeenCalled());
    rerenderWith(null);
    await act(async () => undefined);
    expect(props.onFailure).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("switching documents ignores the previous document's late response", async () => {
    const first = deferred<Blob>();
    content.mockReturnValueOnce(first.promise).mockResolvedValueOnce(new Blob(["second doc"], { type: "text/markdown" }));
    const { rerenderWith } = open(textDoc);
    await waitFor(() => expect(content).toHaveBeenCalledTimes(1));
    rerenderWith(mdDoc);
    expect(await screen.findByText("second doc")).toBeInTheDocument();
    await act(async () => first.resolve(new Blob(["first doc"], { type: "text/plain" })));
    expect(screen.queryByText("first doc")).not.toBeInTheDocument();
  });

  it("closing and reopening a preview works", async () => {
    content.mockResolvedValue(new Blob(["again"], { type: "text/plain" }));
    const { rerenderWith } = open(textDoc);
    await screen.findByText("again");
    rerenderWith(null);
    await waitFor(() => expect(screen.queryByText("again")).not.toBeInTheDocument());
    rerenderWith(textDoc);
    expect(await screen.findByText("again")).toBeInTheDocument();
    expect(content).toHaveBeenCalledTimes(2);
  });

  it("Escape asks the page to close the dialog", async () => {
    content.mockResolvedValue(new Blob(["x"], { type: "text/plain" }));
    const { props } = open(textDoc);
    await screen.findByText("x");
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("PDF preview", () => {
  const pdfBlob = () => new Blob(["%PDF-1.4"], { type: "application/pdf" });

  it("renders page 1 through the PDF.js boundary and shows 'Page 1 of N'", async () => {
    content.mockResolvedValue(pdfBlob());
    const { pageCount } = pdfDouble();
    open(pdfDoc);
    expect(await screen.findByText("Rendering preview…")).toBeInTheDocument();
    await act(async () => pageCount.resolve(7));
    expect(await screen.findByText("Page 1 of 7")).toBeInTheDocument();
    const [data, canvas] = startPdf.mock.calls[0];
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
  });

  it("destroys PDF resources and clears the canvas when the dialog closes", async () => {
    content.mockResolvedValue(pdfBlob());
    const { pageCount, destroy } = pdfDouble();
    const { rerenderWith } = open(pdfDoc);
    await act(async () => pageCount.resolve(1));
    await screen.findByText("Page 1 of 1");
    const canvas = startPdf.mock.calls[0][1];
    canvas.width = 300;
    rerenderWith(null);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(canvas.width).toBe(0);
  });

  it("cancels rendering that is still in progress when the dialog closes, without an unhandled rejection", async () => {
    // Vitest fails the whole run on any unhandled rejection, so reaching the end proves there was none.
    content.mockResolvedValue(pdfBlob());
    const pageCount = deferred<number>();
    const destroy = vi.fn(async () => undefined);
    startPdf.mockReturnValue({ pageCount: pageCount.promise, destroy });
    const { rerenderWith } = open(pdfDoc);
    await screen.findByText("Rendering preview…");
    rerenderWith(null);
    expect(destroy).toHaveBeenCalledTimes(1);
    await act(async () => pageCount.reject(new DOMException("closed", "AbortError")));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a clear error and retains Download when rendering fails", async () => {
    content.mockResolvedValue(pdfBlob());
    const { pageCount } = pdfDouble();
    const { props } = open(pdfDoc);
    await screen.findByText("Rendering preview…");
    await act(async () => pageCount.reject(new Error("Invalid PDF structure")));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This PDF could not be displayed. You can still download it.");
    expect(alert).not.toHaveTextContent("Invalid PDF structure");
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(props.onDownload).toHaveBeenCalledWith(pdfDoc);
  });

  it("never exposes an object URL or raw API URL to the renderer", async () => {
    const createObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    content.mockResolvedValue(pdfBlob());
    pdfDouble();
    open(pdfDoc);
    await screen.findByText("Rendering preview…");
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector("iframe, embed, object, img")).toBeNull();
  });

  it("does not start PDF rendering for a response that arrived after the dialog was closed", async () => {
    const pending = deferred<Blob>();
    content.mockReturnValue(pending.promise);
    pdfDouble();
    const { rerenderWith } = open(pdfDoc);
    await waitFor(() => expect(content).toHaveBeenCalled());
    rerenderWith(null);
    await act(async () => pending.resolve(pdfBlob()));
    expect(startPdf).not.toHaveBeenCalled();
  });
});
