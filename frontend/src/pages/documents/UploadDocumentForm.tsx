import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { ApiError, isAbortError, type UploadProgress } from "../../api/http-client";
import { uploadDocument } from "../../api/documents.api";
import type { DocumentSummary } from "../../types/document.types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FILE_INPUT_ACCEPT, documentErrorMessage, formatBytes, validateDocumentFile } from "./document-file";

interface UploadFormProps {
  organizationId: string;
  projectId: string;
  /** Called only after the backend returned 201. */
  onUploaded: (document: DocumentSummary) => void;
  /** Cancelled or connection lost: the file may or may not have been stored, so the page reconciles the list. */
  onUncertain: () => void;
  onFailure: (error: unknown) => void;
}

type Phase = "idle" | "transferring" | "processing";
type Feedback = { kind: "error" | "info"; text: string };

export const CANCELLED_MESSAGE =
  "Upload cancelled. If the server had already finished saving the file, it may still appear in the list.";
const CONNECTION_LOST_MESSAGE =
  "The connection was lost during the upload. The file may or may not have been saved: check the list before trying again.";

export function UploadDocumentForm({ organizationId, projectId, onUploaded, onUncertain, onFailure }: UploadFormProps) {
  const inputId = useId();
  const messageId = useId();
  const lock = useRef(false);
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    active.current = true;
    // Leaving the page (or losing the management role) aborts the transfer without any follow-up refresh.
    return () => { active.current = false; controller.current?.abort(); };
  }, []);

  const isBusy = phase !== "idle";

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    if (lock.current) return;
    const files = event.target.files;
    setFeedback(null);
    if (!files || files.length === 0) { setFile(null); setValidation(null); return; }
    if (files.length !== 1) { setFile(null); setValidation("Select exactly one file."); return; }
    setFile(files[0]);
    setValidation(validateDocumentFile(files[0]));
  }

  async function submit() {
    // Ref lock first: React state updates are asynchronous, so rapid clicks could otherwise upload twice.
    if (lock.current || !active.current || !file) return;
    const problem = validateDocumentFile(file);
    if (problem) { setValidation(problem); return; }
    lock.current = true;
    const request = new AbortController();
    controller.current = request;
    setPhase("transferring");
    setProgress({ loaded: 0 });
    setFeedback(null);
    try {
      const document = await uploadDocument(organizationId, projectId, file, {
        signal: request.signal,
        onProgress: next => {
          if (!active.current || request.signal.aborted) return;
          setProgress(next);
          // Bytes are sent; the backend is still validating and storing. Success waits for 201.
          if (next.total !== undefined && next.loaded >= next.total) setPhase("processing");
        },
      });
      if (!active.current) return;
      setFile(null);
      setValidation(null);
      setInputKey(key => key + 1);
      onUploaded(document);
    } catch (error) {
      if (!active.current) return;
      if (isAbortError(error)) {
        setFeedback({ kind: "info", text: CANCELLED_MESSAGE });
        onUncertain();
      } else if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
        setFeedback({ kind: "error", text: CONNECTION_LOST_MESSAGE });
        onUncertain();
      } else {
        setFeedback({ kind: "error", text: documentErrorMessage(error, "upload") });
        onFailure(error);
      }
    } finally {
      lock.current = false;
      controller.current = null;
      if (active.current) { setPhase("idle"); setProgress(null); }
    }
  }

  const percent = progress?.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : null;
  const message = validation ?? feedback?.text ?? null;

  return (
    <form className="space-y-3 rounded-lg border p-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <h2 className="font-semibold">Upload a document</h2>
      <div className="space-y-1">
        <Label htmlFor={inputId}>Document (PDF, TXT or Markdown, up to 10 MiB)</Label>
        <input
          key={inputKey} id={inputId} type="file" accept={FILE_INPUT_ACCEPT}
          disabled={isBusy} onChange={handleChange}
          aria-invalid={validation !== null} aria-describedby={message ? messageId : undefined}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:px-3 file:py-1.5"
        />
      </div>
      {file && <p className="break-words text-sm">Selected: {file.name} ({formatBytes(file.size)})</p>}
      {message && (
        <p id={messageId} role={validation || feedback?.kind === "error" ? "alert" : "status"}
          className={validation || feedback?.kind === "error" ? "text-sm text-destructive" : "text-sm"}>
          {message}
        </p>
      )}

      {isBusy && (
        <div className="space-y-1">
          {/* One polite status per phase; percentages are not announced. */}
          <p role="status" className="text-sm">
            {phase === "processing" ? "Processing file…" : `Uploading ${file?.name ?? "file"}…`}
          </p>
          <progress aria-label="Upload progress" className="h-2 w-full"
            max={100} {...(phase === "processing" || percent === null ? {} : { value: percent })} />
          {phase === "transferring" && percent !== null && <p aria-hidden="true" className="text-xs">{percent}%</p>}
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isBusy || !file || validation !== null}>Upload</Button>
        {isBusy && <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>Cancel upload</Button>}
      </div>
    </form>
  );
}
