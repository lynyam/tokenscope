import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, isAbortError } from "../../api/http-client";
import { getAccessToken, getAuthSessionSnapshot, isAuthSessionCurrent, subscribeToAuthInvalidation } from "../../api/auth-session";
import { getOrganization } from "../../api/organizations.api";
import { getOrganizationProject } from "../../api/projects.api";
import { getDocumentContent, listDocuments } from "../../api/documents.api";
import type { DocumentListResponse, DocumentSummary } from "../../types/document.types";
import type { MembershipRole, Project } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { DocumentPreviewDialog } from "./DocumentPreviewDialog";
import { UploadDocumentForm } from "./UploadDocumentForm";
import { SCOPE_STATEMENT, documentErrorMessage, formatBytes, formatDateTime, isApiError, mediaTypeLabel } from "./document-file";

import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useProjectArchived } from "../../hooks/useProjectArchived";
import { useProjectRealtime } from "../../hooks/useProjectRealtime";

const PAGE_SIZE = 25;
const DOWNLOAD_CLEANUP_MS = 1_000;

type Access =
  | { status: "loading" }
  | { status: "ready"; project: Project }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };
type ListStatus = "loading" | "refreshing" | "idle" | "error";

export function DocumentsPage() {
  const { organizationId, projectId } = useParams();
  const { user, isLoading } = useCurrentUser();
  const currentSession = getAuthSessionSnapshot();
  // A new epoch remounts the page and discards everything it held. Without a token there is nothing to
  // remount for: ProtectedRoute leaves this route, and a tokenless remount would only trigger more 401s.
  const [epoch, setEpoch] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const sessionChanged = () => { if (getAccessToken()) setEpoch(value => value + 1); else setSignedOut(true); };
  useEffect(() => subscribeToAuthInvalidation(() => setSignedOut(true)), []);
  if (signedOut || isLoading || !user || !currentSession.token) return null;
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  return <Documents key={`${organizationId}/${projectId}/${currentSession.revision}/${epoch}`}
    organizationId={organizationId} projectId={projectId} onSessionChanged={sessionChanged} />;
}

function Documents({ organizationId, projectId, onSessionChanged }:
  { organizationId: string; projectId: string; onSessionChanged: () => void }) {
  const projectPath = `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}`;
  const listPath = `/organizations/${encodeURIComponent(organizationId)}/projects`;

  // Scope captured at mount: organization, project (props) and the authentication session.
  const session = useRef(getAuthSessionSnapshot());
  const active = useRef(false);
  const unavailable = useRef(false);
  const archived = useProjectArchived(organizationId, projectId);
  const listController = useRef<AbortController | null>(null);
  const listSeq = useRef(0);
  const accessController = useRef<AbortController | null>(null);
  const roleController = useRef<AbortController | null>(null);
  const downloads = useRef(new Map<string, AbortController>());
  const objectUrlCleanups = useRef(new Set<() => void>());
  const dataRef = useRef<DocumentListResponse | null>(null);
  const pageRef = useRef(1);
  const requestedPage = useRef(1);

  const [attempt, setAttempt] = useState(0);
  const [access, setAccess] = useState<Access>({ status: "loading" });
  const [role, setRole] = useState<MembershipRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [data, setData] = useState<DocumentListResponse | null>(null);
  const [listStatus, setListStatus] = useState<ListStatus>("loading");
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentSummary | null>(null);
  const [downloading, setDownloading] = useState<string[]>([]);
  const [downloadError, setDownloadError] = useState<{ id: string; message: string } | null>(null);

  useLayoutEffect(() => {
    active.current = true;
    const cleanups = objectUrlCleanups.current;
    const pendingDownloads = downloads.current;
    return () => {
      active.current = false;
      listController.current?.abort();
      accessController.current?.abort();
      roleController.current?.abort();
      pendingDownloads.forEach(controller => controller.abort());
      pendingDownloads.clear();
      // Release temporary object URLs and anchors immediately instead of waiting for their timers.
      cleanups.forEach(cleanup => cleanup());
    };
  }, []);

  /** False once the component or the authentication session is no longer the one that started the work. */
  function isCurrent(): boolean {
    if (!active.current || unavailable.current) return false;
    if (!isAuthSessionCurrent(session.current)) {
      // Another login replaced the session: restart from a clean slate and ignore the late response.
      onSessionChanged();
      return false;
    }
    return true;
  }

  function showUnavailable(message: string) {
    unavailable.current = true;
    accessController.current?.abort();
    listSeq.current += 1;
    setRole(null);
    objectUrlCleanups.current.forEach(cleanup => cleanup());
    listController.current?.abort();
    roleController.current?.abort();
    downloads.current.forEach(controller => controller.abort());
    downloads.current.clear();
    dataRef.current = null;
    setData(null);
    setPreviewDocument(null);
    setDeleteTarget(null);
    setNotice(null);
    setDownloading([]);
    setDownloadError(null);
    setAccess({ status: "unavailable", message });
  }

  async function refreshRole(hideManagement = true) {
    if (!isCurrent()) return;
    roleController.current?.abort();
    const controller = new AbortController();
    roleController.current = controller;
    // Management controls stay hidden until the effective role is known again.
    if (hideManagement) {
      setRole(null);
      setDeleteTarget(null);
    }
    setRoleError(null);
    try {
      const [organization] = await Promise.all([
        getOrganization(organizationId, controller.signal),
        getOrganizationProject(organizationId, projectId, controller.signal),
      ]);
      if (controller.signal.aborted || !isCurrent()) return;
      setRole(organization.currentUserRole);
    } catch (error) {
      if (controller.signal.aborted || !isCurrent() || isAbortError(error)) return;
      if (error instanceof ApiError && error.statusCode === 404) showUnavailable("This project is no longer available.");
      else setRoleError("Your permissions could not be refreshed.");
    }
  }

  /** Central reaction to failures that change what the user may see or do. The session is never ended here. */
  function handleFailure(error: unknown, target?: DocumentSummary) {
    if (!isCurrent() || isAbortError(error)) return;
    if (isApiError(error, "PROJECT_NOT_FOUND", 404) || isApiError(error, "ORGANIZATION_NOT_FOUND", 404)) {
      showUnavailable("This project is no longer available.");
    } else if (isApiError(error, "INSUFFICIENT_ORGANIZATION_ROLE", 403)) {
      void refreshRole();
    } else if (target && isApiError(error, "DOCUMENT_NOT_FOUND", 404)) {
      setPreviewDocument(current => (current?.id === target.id ? null : current));
      setDeleteTarget(current => (current?.id === target.id ? null : current));
      downloads.current.get(target.id)?.abort();
      removeVisibleDocument(target);
      setNotice("That document is no longer available.");
      void loadList(pageRef.current);
    }
  }

  async function loadList(targetPage: number, allowCorrection = true): Promise<void> {
    if (!isCurrent()) return;
    requestedPage.current = targetPage;
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const seq = ++listSeq.current;
    setListStatus(dataRef.current ? "refreshing" : "loading");
    setListError(null);
    try {
      const result = await listDocuments(organizationId, projectId, { page: targetPage, pageSize: PAGE_SIZE }, controller.signal);
      // Cancellation alone is not enough: the response may already have resolved.
      if (seq !== listSeq.current || controller.signal.aborted || !isCurrent()) return;
      // The requested page no longer exists (for example after deleting its last row): fetch the last page once.
      const lastPage = Math.max(1, result.totalPages);
      if (allowCorrection && targetPage > lastPage) {
        return loadList(lastPage, false);
      }
      dataRef.current = result;
      pageRef.current = result.page;
      setData(result);
      setListStatus("idle");
    } catch (error) {
      if (seq !== listSeq.current || controller.signal.aborted || !isCurrent() || isAbortError(error)) return;
      handleFailure(error);
      setListError(documentErrorMessage(error, "list"));
      setListStatus("error");
    }
  }

  // Access: server-provided role and the project, loaded before anything document-related is requested.
  useEffect(() => {
    const controller = new AbortController();
    accessController.current = controller;
    setAccess({ status: "loading" });
    setRole(null);
    Promise.all([
      getOrganization(organizationId, controller.signal),
      getOrganizationProject(organizationId, projectId, controller.signal),
    ])
      .then(([organization, project]) => {
        if (controller.signal.aborted || !isCurrent()) return;
        setRole(organization.currentUserRole);
        if (project.archivedAt !== null) {
          setAccess({ status: "unavailable", message: "This project is archived." });
          return;
        }
        setAccess({ status: "ready", project });
        void loadList(1);
      })
      .catch(error => {
        if (controller.signal.aborted || !isCurrent() || isAbortError(error)) return;
        // Do not reveal whether an inaccessible project exists.
        setAccess(error instanceof ApiError && error.statusCode === 404
          ? { status: "unavailable", message: "This project is no longer available." }
          : { status: "error", message: "Failed to load the project." });
      });
    return () => controller.abort();
    // loadList and isCurrent only read refs and constant props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId, attempt]);

  async function download(target: DocumentSummary) {
    if (!isCurrent() || downloads.current.has(target.id)) return; // One active download per document.
    const controller = new AbortController();
    downloads.current.set(target.id, controller);
    setDownloading(ids => [...ids, target.id]);
    setDownloadError(null);
    try {
      const blob = await getDocumentContent(organizationId, projectId, target.id, { download: true, signal: controller.signal });
      if (controller.signal.aborted || !isCurrent()) return; // A stale response never starts a download.
      startBrowserDownload(blob, target.originalName);
    } catch (error) {
      if (controller.signal.aborted || !isCurrent() || isAbortError(error)) return;
      setDownloadError({ id: target.id, message: documentErrorMessage(error, "download") });
      handleFailure(error, target);
    } finally {
      if (downloads.current.get(target.id) === controller) downloads.current.delete(target.id);
      if (isCurrent()) setDownloading(ids => ids.filter(id => id !== target.id));
    }
  }

  function startBrowserDownload(blob: Blob, filename: string) {
    // The object URL exists only for this click; no token or protected URL is ever exposed.
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    window.document.body.appendChild(anchor);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      objectUrlCleanups.current.delete(release);
      URL.revokeObjectURL(url);
      anchor.remove();
    };
    // Give the browser time to start the transfer; this does not mean the file finished saving.
    const timer = setTimeout(release, DOWNLOAD_CLEANUP_MS);
    objectUrlCleanups.current.add(release);
    anchor.click();
  }

  function handleUploaded(uploaded: DocumentSummary) {
    if (!isCurrent()) return;
    setNotice(`"${uploaded.originalName}" was uploaded.`);
    setDownloadError(null);
    pageRef.current = 1;
    void loadList(1);
  }

  function removeVisibleDocument(removed: DocumentSummary) {
    const current = dataRef.current;
    if (!current || !current.items.some(item => item.id === removed.id)) return;
    const total = Math.max(0, current.total - 1);
    const next = {
      ...current,
      items: current.items.filter(item => item.id !== removed.id),
      total,
      totalPages: Math.ceil(total / current.pageSize),
    };
    dataRef.current = next;
    setData(next);
  }

  function handleDeleted(removed: DocumentSummary) {
    if (!isCurrent()) return;
    setDeleteTarget(null);
    setPreviewDocument(current => (current?.id === removed.id ? null : current));
    setNotice(`"${removed.originalName}" was deleted.`);
    // A failed refresh must not restore a confirmed missing document.
    removeVisibleDocument(removed);
    void loadList(pageRef.current);
  }

  useEffect(() => {
    if (archived && isCurrent()) showUnavailable("This project is no longer available.");
  }, [archived]);

  useProjectRealtime(organizationId, projectId, {
    // These events concern traces, not documents.
    onChanged: () => {},
    // Reconnection may follow an access change that happened while offline.
    onSynced: () => { void refreshRole(false); },
    onRevoked: () => { if (isCurrent()) showUnavailable("This project is no longer available."); },
  }, access.status === "ready" && !archived);

  const canManage = access.status === "ready" && (role === "OWNER" || role === "ADMIN");

  if (access.status === "loading") return <p role="status" className="p-6">Loading documents…</p>;
  if (access.status === "error") return (
    <section className="space-y-3 p-6">
      <p role="alert">{access.message}</p>
      <Button onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      <Link to={listPath} className="ml-3 underline">Back to projects</Link>
    </section>
  );
  if (access.status === "unavailable") return (
    <section className="space-y-3 p-6">
      <p role="alert">{access.message}</p>
      <Link to="/organizations" className="underline">Back to organizations</Link>
      <span className="mx-2">·</span>
      <Link to={listPath} className="underline">Back to projects</Link>
    </section>
  );

  const items = data?.items ?? [];
  const busyList = listStatus === "loading" || listStatus === "refreshing";

  return (
    <section className="mx-auto max-w-4xl space-y-6 p-6">
      <Link to={projectPath} className="underline">← Back to {access.project.name}</Link>
      <div>
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-sm text-muted-foreground">{SCOPE_STATEMENT}</p>
      </div>

      {role === null && roleError && (
        <div role="alert" className="text-sm">
          {roleError} <Button size="xs" variant="outline" onClick={() => void refreshRole()}>Retry</Button>
        </div>
      )}

      {canManage && (
        <UploadDocumentForm
          organizationId={organizationId} projectId={projectId}
          isCurrent={isCurrent}
          onUploaded={handleUploaded}
          onUncertain={() => { if (isCurrent()) { setNotice(null); void loadList(pageRef.current); } }}
          onFailure={error => handleFailure(error)}
        />
      )}

      {notice && <p role="status" className="text-sm">{notice}</p>}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Project documents</h2>
          <Button variant="outline" size="xs" disabled={busyList} onClick={() => void loadList(pageRef.current)}>
            {listStatus === "refreshing" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>

        {listStatus === "loading" && <p role="status">Loading documents…</p>}
        {listError && (
          <div role="alert" className="text-sm text-destructive">
            {listError}{" "}
            <Button size="xs" variant="outline" onClick={() => void loadList(requestedPage.current)}>Retry</Button>
          </div>
        )}
        {/* "No documents" only appears after a successful empty response. */}
        {data && data.total === 0 && items.length === 0 && listStatus !== "loading" && (
          <p>No documents yet.{canManage ? " Upload the first one above." : ""}</p>
        )}

        {items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(item => {
                const when = formatDateTime(item.createdAt);
                const label = `${item.originalName}, ${formatBytes(item.sizeBytes)}, uploaded ${when}`;
                const isDownloading = downloading.includes(item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-xs whitespace-normal break-words">{item.originalName}</TableCell>
                    <TableCell>{mediaTypeLabel(item.mediaType)}</TableCell>
                    <TableCell>{formatBytes(item.sizeBytes)}</TableCell>
                    <TableCell>{when}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="xs" variant="outline" aria-label={`Preview ${label}`}
                          onClick={() => setPreviewDocument(item)}>Preview</Button>
                        <Button size="xs" variant="outline" aria-label={`Download ${label}`}
                          disabled={isDownloading} onClick={() => void download(item)}>
                          {isDownloading ? "Downloading…" : "Download"}
                        </Button>
                        {canManage && (
                          <Button size="xs" variant="destructive" aria-label={`Delete ${label}`}
                            onClick={() => setDeleteTarget(item)}>Delete</Button>
                        )}
                      </div>
                      {downloadError?.id === item.id && (
                        <p role="alert" className="mt-1 text-xs text-destructive">{downloadError.message}</p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {data && data.totalPages > 1 && (
          <nav aria-label="Documents pagination" className="flex items-center justify-between text-sm">
            <Button size="xs" variant="outline" disabled={busyList || data.page <= 1}
              onClick={() => void loadList(data.page - 1)}>Previous</Button>
            <span>Page {data.page} of {data.totalPages}</span>
            <Button size="xs" variant="outline" disabled={busyList || data.page >= data.totalPages}
              onClick={() => void loadList(data.page + 1)}>Next</Button>
          </nav>
        )}
      </div>

      <DocumentPreviewDialog
        organizationId={organizationId} projectId={projectId}
        isCurrent={isCurrent}
        downloadError={downloadError?.id === previewDocument?.id ? downloadError?.message : undefined}
        document={previewDocument} onClose={() => setPreviewDocument(null)}
        onDownload={target => void download(target)}
        isDownloading={previewDocument !== null && downloading.includes(previewDocument.id)}
        onFailure={handleFailure}
      />
      {canManage && (
        <DeleteDocumentDialog
          key={deleteTarget?.id ?? "none"}
          organizationId={organizationId} projectId={projectId}
          isCurrent={isCurrent}
          document={deleteTarget} onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted} onFailure={handleFailure}
        />
      )}
    </section>
  );
}
