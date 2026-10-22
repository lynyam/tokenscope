// The legacy build is used on purpose: the default build of pdfjs-dist 6 needs very recent JavaScript
// features (Map.getOrInsertComputed) that Chrome/Firefox/Edge versions in use today may lack.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
// Bundled locally by Vite: no CDN, viewer or worker is ever loaded from a third party.
import pdfWorkerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const MAX_PDF_CANVAS_SIDE = 1_600;

export interface PdfPreview {
  /** Resolves with the page count once page 1 is drawn; rejects with an AbortError after destroy(). */
  pageCount: Promise<number>;
  /** Cancels pending work, destroys PDF.js resources and clears the canvas. Safe to call repeatedly. */
  destroy: () => Promise<void>;
}

function isCancellation(error: unknown): boolean {
  return error instanceof pdfjs.RenderingCancelledException ||
    (typeof error === "object" && error !== null && "name" in error &&
      (error.name === "RenderingCancelledException" || error.name === "AbortException"));
}

/** Starts rendering the first page into the canvas. Returns immediately so callers can cancel at any stage. */
export function startPdfPreview(data: ArrayBuffer, canvas: HTMLCanvasElement): PdfPreview {
  // The loading task owns this copy of the bytes it transfers to the worker.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    enableXfa: false,       // No XFA forms.
    useWorkerFetch: false,  // No network access from the worker.
    verbosity: 0,
  });
  let renderTask: { cancel: () => void } | null = null;
  let destroyed = false;

  const destroy = async () => {
    if (destroyed) return;
    destroyed = true;
    renderTask?.cancel();
    canvas.width = 0;
    canvas.height = 0;
    try { await loadingTask.destroy(); } catch { /* Already torn down. */ }
  };
  const aborted = () => new DOMException("The preview was closed.", "AbortError");

  const pageCount = (async () => {
    try {
      const pdf = await loadingTask.promise;
      if (destroyed) throw aborted();
      const page = await pdf.getPage(1);
      if (destroyed) throw aborted();

      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_PDF_CANVAS_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      const task = page.render({ canvas, viewport });
      renderTask = task;
      await task.promise;
      if (destroyed) throw aborted();
      return pdf.numPages;
    } catch (error) {
      const wasDestroyed = destroyed;
      await destroy();
      if (wasDestroyed || isCancellation(error)) throw aborted();
      throw error;
    }
  })();

  // Destroying before completion rejects pageCount on purpose; callers handle it, but never leave it unobserved.
  pageCount.catch(() => undefined);
  return { pageCount, destroy };
}
