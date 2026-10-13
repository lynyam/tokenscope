import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { getOrganization } from "../../api/organizations.api";
import { getOrganizationProject } from "../../api/projects.api";
import { createProjectApiKey, listProjectApiKeys, revokeProjectApiKey } from "../../api/api-keys.api";
import { ApiError, getApiErrorMessage, isAbortError } from "../../api/http-client";
import type { ApiKeySummary } from "../../types/api-key.types";
import type { MembershipRole, Project } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlert, FolderX, ArrowLeft, Key, Plus } from "lucide-react";
import { ApiKeySecretDialog, type RevealedApiKey } from "./ApiKeySecretDialog";

export function ApiKeysPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  // The key resets every piece of state, including any secret, when the route target changes.
  return <ApiKeys key={organizationId + "/" + projectId}
    organizationId={organizationId} projectId={projectId} />;
}

// Published location of the public API contract.
const PUBLIC_API_DOCS_URL =
  "https://github.com/lynyam/tokenscope/blob/develop/docs/API.md#api-keys--tse-67--tse-74";
// Placeholder only: the page never builds a command containing a real key.
const CURL_TEMPLATE = 'curl "$TOKENSCOPE_ORIGIN/api/v1/public/traces" \\\n  -H "X-API-Key: <PROJECT_API_KEY>"';

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

// Message for failures that do not change what the screen shows.
function describeFailure(failure: unknown, fallback: string) {
  if (failure instanceof ApiError) {
    if (failure.statusCode === undefined) {
      return "Unable to reach the server. Check your connection and try again.";
    }
    if (failure.statusCode === 429) {
      return "Too many requests. Wait a moment, then try again.";
    }
  }
  return getApiErrorMessage(failure, fallback);
}

function ApiKeys({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const projectPath = "/organizations/" + encodeURIComponent(organizationId)
    + "/projects/" + encodeURIComponent(projectId);

  // Phase 1: who am I here, and does this project exist for me?
  const [contextAttempt, setContextAttempt] = useState(0);
  const [role, setRole] = useState<MembershipRole | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  // Phase 2: the key list, only for OWNER/ADMIN.
  const [listAttempt, setListAttempt] = useState(0);
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Creation and one-time disclosure.
  const mutation = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedApiKey | null>(null);

  // Revocation.
  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  // Keys the server confirmed as revoked (204) even if the refresh fails afterwards.
  const [confirmedRevoked, setConfirmedRevoked] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = project !== null && project.archivedAt === null
    && (role === "OWNER" || role === "ADMIN");

  useEffect(() => {
    const controller = new AbortController();
    mutation.current = controller;
    // A response arriving after leaving this page is ignored: aborted signal.
    return () => {
      controller.abort();
      mutation.current = null;
    };
  }, []);

  useEffect(() => {
    // Losing permission clears the secret and the dialogs.
    if (!canManage) {
      setRevealed(null);
      setCreateOpen(false);
      setRevokeTarget(null);
    }
  }, [canManage]);

  useEffect(() => {
    const controller = new AbortController();
    setRole(null);
    setProject(null);
    setKeys(null);
    setContextError(null);
    setContextLoading(true);
    Promise.all([
      getOrganization(organizationId, controller.signal),
      getOrganizationProject(organizationId, projectId, controller.signal),
    ])
      .then(([organization, result]) => {
        if (controller.signal.aborted) return;
        setRole(organization.currentUserRole);
        setProject(result);
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // Do not reveal whether an inaccessible project exists.
        setContextError(failure instanceof ApiError && failure.statusCode === 404
          ? "Project not found."
          : describeFailure(failure, "Failed to load project."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, projectId, contextAttempt]);

  useEffect(() => {
    if (!canManage) {
      setKeys(null);
      return;
    }
    const controller = new AbortController();
    setListError(null);
    setListLoading(true);
    listProjectApiKeys(organizationId, projectId, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setKeys(result);
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        if (handleSharedFailure(failure)) return;
        // A failure is never turned into an empty list.
        setListError(describeFailure(failure, "Failed to load API keys."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [canManage, organizationId, projectId, listAttempt]);

  function dropContent() {
    setRevealed(null); // the plaintext never survives a permission or project change
    setCreateOpen(false);
    setRevokeTarget(null);
    setKeys(null);
  }

  // Failures that change what the whole screen may show. Returns true if handled.
  function handleSharedFailure(failure: unknown): boolean {
    if (!(failure instanceof ApiError)) return false;
    if (failure.statusCode === 403 && failure.code === "INSUFFICIENT_ORGANIZATION_ROLE") {
      dropContent();
      setContextAttempt(value => value + 1); // re-read the role; the screen follows it
      return true;
    }
    if (failure.statusCode === 404
      && (failure.code === "PROJECT_NOT_FOUND" || failure.code === "ORGANIZATION_NOT_FOUND")) {
      dropContent();
      setRole(null);
      setProject(null);
      setContextError("Project not found.");
      return true;
    }
    return false;
  }

  function handleCreateOpenChange(open: boolean) {
    if (pending.current) return;
    setCreateError(null);
    if (open) setNameDraft("");
    setCreateOpen(open);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const signal = mutation.current?.signal;
    if (pending.current || !canManage || !signal || signal.aborted) return;

    const name = nameDraft.trim();
    if (name.length < 1 || name.length > 64) {
      setCreateError("Use a name of 1–64 characters.");
      return;
    }

    setNotice(null);
    pending.current = true;
    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await createProjectApiKey(organizationId, projectId, { name }, signal);
      if (signal.aborted) return;
      // The secret goes to the disclosure state only; the list gets the summary.
      const { key, ...summary } = created;
      setKeys(current => (current ? [summary, ...current] : current));
      setRevealed({ name: summary.name, keyPrefix: summary.keyPrefix, key });
      setCreateOpen(false);
      setNameDraft("");
      setListAttempt(value => value + 1); // reconcile with the server
    } catch (failure) {
      if (signal.aborted || isAbortError(failure)) return;
      if (handleSharedFailure(failure)) return;
      if (failure instanceof ApiError && failure.statusCode !== undefined) {
        const details = failure.details?.flatMap(detail => detail.messages).join(" ");
        setCreateError(details || describeFailure(failure, "Failed to create API key."));
      } else {
        // No HTTP answer (network cut): the key may exist. Never repeat the POST automatically.
        setCreateError(
          "The request did not complete, so the key may or may not have been created. "
          + "Check the list below before trying again: revoke an unwanted key or create another.",
        );
        setListAttempt(value => value + 1);
      }
    } finally {
      pending.current = false;
      if (!signal.aborted) setIsCreating(false);
    }
  }

  function handleRevokeOpenChange(open: boolean) {
    if (pending.current || open) return; // only closing is handled here
    setRevokeError(null);
    setRevokeTarget(null);
  }

  async function handleRevoke() {
    const signal = mutation.current?.signal;
    if (!revokeTarget || pending.current || !canManage || !signal || signal.aborted) return;

    const target = revokeTarget;
    setNotice(null);
    pending.current = true;
    setIsRevoking(true);
    setRevokeError(null);
    try {
      await revokeProjectApiKey(organizationId, projectId, target.id, signal);
      if (signal.aborted) return;
      setConfirmedRevoked(current => new Set(current).add(target.id));
      setRevokeTarget(null);
      setListAttempt(value => value + 1); // the server decides revokedAt
    } catch (failure) {
      if (signal.aborted || isAbortError(failure)) return;
      if (handleSharedFailure(failure)) return;
      if (failure instanceof ApiError && failure.statusCode === 404 && failure.code === "API_KEY_NOT_FOUND") {
        // Already gone: nothing left to revoke. Close and reload the list only.
        setRevokeError(null);
        setRevokeTarget(null);
        setNotice("This key no longer exists for this project. The list has been refreshed.");
        setListAttempt(value => value + 1);
        return;
      }
      // The dialog stays open: pressing Revoke again is the retry.
      setRevokeError(describeFailure(failure, "Failed to revoke the API key."));
    } finally {
      pending.current = false;
      if (!signal.aborted) setIsRevoking(false);
    }
  }

  if (contextLoading) {
    return (
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        <Skeleton className="h-8 w-48 mb-4" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (contextError || !project || !role) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <FolderX className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">
          {contextError ?? "Project not found."}
        </p>
        <div className="mt-5 flex gap-2">
          {contextError !== "Project not found." && (
            <Button variant="outline" className="rounded-lg" onClick={() => setContextAttempt(n => n + 1)}>
              Retry
            </Button>
          )}
          <Link
            to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  if (project.archivedAt !== null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Project archived</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          API keys are not available for archived projects.
        </p>
        <Link
          to={projectPath}
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
      </div>
    );
  }

  if (role === "MEMBER") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">API keys</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          You do not have permission to manage API keys for this project.
        </p>
        <Link
          to={projectPath}
          className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto">
      <Link to={projectPath} className="text-sm text-muted-foreground hover:text-foreground">
        ← {project.name}
      </Link>

      <div className="mt-2 mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">API keys</h1>
        <Button className="rounded-lg" onClick={() => handleCreateOpenChange(true)}>
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </div>

      {notice && (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent className="rounded-lg" showCloseButton={!isCreating}>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Name the key after the application that will use it.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                disabled={isCreating}
                autoComplete="off"
                autoFocus
              />
            </div>
            {createError && <p role="alert" className="text-sm text-destructive">{createError}</p>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="rounded-lg" disabled={isCreating}
                onClick={() => handleCreateOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-lg" disabled={isCreating}>
                {isCreating ? "Creating…" : "Create key"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {revealed && <ApiKeySecretDialog revealed={revealed} onClose={() => setRevealed(null)} />}

      <Dialog open={revokeTarget !== null} onOpenChange={handleRevokeOpenChange}>
        <DialogContent className="rounded-lg" showCloseButton={!isRevoking}>
          <DialogHeader>
            <DialogTitle>Revoke this key?</DialogTitle>
            <DialogDescription>
              Future requests using it will be rejected. Applications using this key will need a new one.
            </DialogDescription>
          </DialogHeader>
          {revokeTarget && (
            <p className="text-sm">
              <strong>{revokeTarget.name}</strong>{" "}
              <code className="text-muted-foreground">{revokeTarget.keyPrefix}…</code>
            </p>
          )}
          {revokeError && <p role="alert" className="text-sm text-destructive">{revokeError}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="rounded-lg" disabled={isRevoking}
              onClick={() => handleRevokeOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" className="rounded-lg" disabled={isRevoking} onClick={handleRevoke}>
              {isRevoking ? "Revoking…" : "Revoke key"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {listLoading && keys === null && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      )}

      {listError && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm text-destructive">{listError}</p>
          <Button variant="outline" className="rounded-lg" onClick={() => setListAttempt(n => n + 1)}>
            Retry
          </Button>
        </div>
      )}

      {keys !== null && keys.length === 0 && (
        <p className="text-muted-foreground">No API keys yet.</p>
      )}

      {keys !== null && keys.length > 0 && (
        <ul aria-label="API keys" className="flex flex-col gap-2">
          {keys.map((apiKey) => (
            <li key={apiKey.id} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{apiKey.name}</span>
                </div>
                {!apiKey.revokedAt && !confirmedRevoked.has(apiKey.id) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    disabled={isRevoking || isCreating}
                    onClick={() => {
                      setRevokeError(null);
                      setRevokeTarget(apiKey);
                    }}
                  >
                    Revoke
                  </Button>
                )}
              </div>
              <code className="text-sm text-muted-foreground">{apiKey.keyPrefix}…</code>
              <div className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span>Created {formatDate(apiKey.createdAt)}</span>
                <span>
                  {apiKey.lastUsedAt ? "Last used " + formatDate(apiKey.lastUsedAt) : "No recorded use."}
                </span>
                <span>
                  {apiKey.revokedAt
                    ? "Revoked " + formatDate(apiKey.revokedAt)
                    : confirmedRevoked.has(apiKey.id) ? "Revoked" : "Active"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-8 rounded-lg">
        <CardHeader>
          <CardTitle className="text-lg">Use a key</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            This page and the other management pages use your signed-in session (a browser JWT).
            Public trace endpoints use the project key in the <code>X-API-Key</code> header.
            Never send your browser token in place of a project key.
          </p>
          <pre className="overflow-x-auto rounded-md border p-3 text-sm"><code>{CURL_TEMPLATE}</code></pre>
          <a href={PUBLIC_API_DOCS_URL} target="_blank" rel="noreferrer" className="text-sm underline">
            Public API documentation
          </a>
        </CardContent>
      </Card>
    </div>
  );
}