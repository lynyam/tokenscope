import { useEffect, useRef, useState } from "react";
import { isAbortError } from "../../api/http-client";
import { getDocumentContent } from "../../api/documents.api";
import type { DocumentSummary } from "../../types/document.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MAX_DOCUMENT_BYTES, blobMatchesMediaType, documentErrorMessage, formatBytes, mediaTypeLabel, readPreviewText,
} from "./document-file";

interface PreviewDialogProps {
  organizationId: string;
  projectId: string;
  isCurrent: () => boolean;
  downloadError?: string;
  /** The selected list row: there is no document-detail endpoint. */
  document: DocumentSummary | null;
  onClose: () => void;
  onDownload: (document: DocumentSummary) => void;
  isDownloading: boolean;
  /** Lets the page react to 403/404 without the dialog knowing the page's access rules. */
  onFailure: (error: unknown, document: DocumentSummary) => void;
}

type View =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "text"; text: string; truncated: boolean }
  | { status: "pdf"; data: ArrayBuffer };

export function DocumentPreviewDialog({ document, onClose, ...rest }: PreviewDialogProps) {
  return (
    <Dialog open={document !== null} onOpenChange={open => { if (!open) onClose(); }}>
      {document && (
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden rounded-lg">
          {/* Keyed by document: switching or closing unmounts the body, which runs every cleanup. */}
          <PreviewBody key={document.id} document={document} {...rest} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function PreviewBody({ organizationId, projectId, document, isCurrent, onDownload, isDownloading, downloadError, onFailure }:
  Omit<PreviewDialogProps, "onClose" | "document"> & { document: DocumentSummary }) {
  const [view, setView] = useState<View>({ status: "loading" });
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isCurrentRef = useRef(isCurrent);
  isCurrentRef.current = isCurrent;
  const onFailureRef = useRef(onFailure);
  onFailureRef.current = onFailure;

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const canApply = () => current && isCurrentRef.current();
    (async () => {
      try {
        const blob = await getDocumentContent(organizationId, projectId, document.id, { signal: controller.signal });
        if (!canApply()) return;
        if (!blobMatchesMediaType(blob, document.mediaType)) {
          setView({ status: "error", message: "The server returned an unexpected file type, so it was not displayed." });
          return;
        }
        if (blob.size > MAX_DOCUMENT_BYTES) {
          setView({ status: "error", message: "The server returned an unexpectedly large file, so it was not displayed." });
          return;
        }
        if (document.mediaType === "application/pdf") {
          const data = await blob.arrayBuffer();
          if (canApply()) setView({ status: "pdf", data });
          return;
        }
        let preview;
        try {
          preview = await readPreviewText(blob);
        } catch (error) {
          if (!canApply()) return;
          if (error instanceof TypeError) {
            setView({ status: "error", message: "This file is not valid UTF-8 text and cannot be previewed. Download it instead." });
            return;
          }
          throw error;
        }
        if (canApply()) setView({ status: "text", ...preview });
      } catch (error) {
        // Closing, switching document or leaving the page aborts silently.
        if (!canApply() || isAbortError(error)) return;
        setView({ status: "error", message: documentErrorMessage(error, "preview") });
        onFailureRef.current(error, document);
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [organizationId, projectId, document]);

  const pdfData = view.status === "pdf" ? view.data : null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdfData || !canvas) return;
    let current = true;
    const canApply = () => current && isCurrentRef.current();
    let preview: { destroy: () => Promise<void> } | null = null;
    setPageCount(null);
    setRenderError(null);
    import("./pdf-preview")
      .then(async module => {
        if (!canApply()) return;
        const started = module.startPdfPreview(pdfData, canvas);
        preview = started;
        const count = await started.pageCount;
        if (canApply()) setPageCount(count);
      })
      .catch(error => {
        if (!canApply() || isAbortError(error)) return;
        setRenderError("This PDF could not be displayed. You can still download it.");
      });
    return () => {
      current = false;
      void preview?.destroy().catch(() => undefined);
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [pdfData]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="break-words">{document.originalName}</DialogTitle>
        <DialogDescription>
          {mediaTypeLabel(document.mediaType)} · {formatBytes(document.sizeBytes)}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-24 min-w-0">
        {view.status === "loading" && <p role="status">Loading preview…</p>}
        {view.status === "error" && <p role="alert" className="text-sm text-destructive">{view.message}</p>}
        {view.status === "text" && (
          <>
            {view.truncated && <p role="status" className="mb-2 text-sm">Preview truncated. Download the file to read it completely.</p>}
            {/* Escaped plain text only: no HTML, no Markdown conversion, no links. */}
            <pre tabIndex={0} aria-label={`Contents of ${document.originalName}`}
              className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-sm">{view.text}</pre>
          </>
        )}
        {view.status === "pdf" && (
          <div className="space-y-2">
            {renderError ? <p role="alert" className="text-sm text-destructive">{renderError}</p>
              : pageCount === null ? <p role="status">Rendering preview…</p>
              : <p role="status" className="text-sm">Page 1 of {pageCount}</p>}
            <div className="max-h-[60vh] overflow-auto rounded-md border">
              <canvas ref={canvasRef} aria-label={`First page of ${document.originalName}`} className="mx-auto h-auto max-w-full" />
            </div>
          </div>
        )}
      </div>

      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={isDownloading} onClick={() => onDownload(document)}>
          {isDownloading ? "Downloading…" : "Download"}
        </Button>
      </DialogFooter>
    </>
  );
}
