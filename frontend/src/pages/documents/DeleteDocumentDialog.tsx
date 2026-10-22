import { useEffect, useRef, useState } from "react";
import { isAbortError } from "../../api/http-client";
import { deleteDocument } from "../../api/documents.api";
import type { DocumentSummary } from "../../types/document.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { documentErrorMessage } from "./document-file";

interface DeleteDialogProps {
  organizationId: string;
  projectId: string;
  isCurrent: () => boolean;
  document: DocumentSummary | null;
  onClose: () => void;
  /** Called once on 204. The page removes the row and reconciles the list. */
  onDeleted: (document: DocumentSummary) => void;
  onFailure: (error: unknown, document: DocumentSummary) => void;
}

/** Render with key={document?.id ?? "none"} so that pending state, errors and the lock reset per document. */
export function DeleteDocumentDialog({ organizationId, projectId, isCurrent, document, onClose, onDeleted, onFailure }: DeleteDialogProps) {
  const lock = useRef(false);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  async function confirm() {
    // A synchronous lock: a disabled button alone cannot stop two quick clicks.
    if (lock.current || !active.current || !isCurrent() || !document) return;
    lock.current = true;
    const request = new AbortController();
    controller.current = request;
    setIsPending(true);
    setError(null);
    try {
      await deleteDocument(organizationId, projectId, document.id, request.signal);
      if (active.current && !request.signal.aborted && isCurrent()) onDeleted(document);
    } catch (failure) {
      if (!active.current || !isCurrent() || request.signal.aborted || isAbortError(failure)) return;
      setError(documentErrorMessage(failure, "delete"));
      onFailure(failure, document);
    } finally {
      lock.current = false;
      controller.current = null;
      if (active.current && isCurrent()) setIsPending(false);
    }
  }

  return (
    // The dialog cannot be dismissed while the request is pending, as on the project page.
    <Dialog open={document !== null} onOpenChange={open => { if (!open && !isPending) onClose(); }}>
      {document && (
        <DialogContent className="rounded-lg" showCloseButton={!isPending}>
          <DialogHeader>
            <DialogTitle>Delete document</DialogTitle>
            <DialogDescription>
              Delete this document? It will no longer be available in this project. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <p className="break-words rounded-md border p-3 text-sm font-medium">{document.originalName}</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={isPending} onClick={onClose}>Cancel</Button>
            <Button variant="destructive" disabled={isPending} onClick={confirm}>
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
