import { Link, useNavigate, useParams } from "react-router-dom";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { archiveProject, getOrganizationProject, updateProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import { ApiError, getApiErrorMessage, isAbortError } from "../../api/http-client";
import type { MembershipRole, Project, UpdateProjectInput } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditProjectForm } from "./EditProjectForm";

export function ProjectDetailPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  return <ProjectDetail key={organizationId + "/" + projectId}
    organizationId={organizationId} projectId={projectId} />;
}

function ProjectDetail({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const navigate = useNavigate();
  const listPath = "/organizations/" + encodeURIComponent(organizationId) + "/projects";
  const requests = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const active = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [role, setRole] = useState<MembershipRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useLayoutEffect(() => {
    active.current = true;
    // An old archive must not redirect after this route has been left.
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setProject(null);
    setRole(null);
    setLoadError(null);
    setIsLoading(true);
    Promise.all([
      getOrganization(organizationId, controller.signal),
      getOrganizationProject(organizationId, projectId, controller.signal),
    ])
      .then(([organization, result]) => {
        if (controller.signal.aborted) return;
        setRole(organization.currentUserRole);
        setProject(result);
        setNameDraft(result.name);
        setDescriptionDraft(result.description ?? "");
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // Do not reveal whether an inaccessible project exists.
        setLoadError(failure instanceof ApiError && failure.statusCode === 404
          ? "Project not found."
          : getApiErrorMessage(failure, "Failed to load project."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, projectId, attempt]);

  const canManage = project?.archivedAt === null && (role === "OWNER" || role === "ADMIN");
  const isMutating = isSaving || isArchiving;

  async function handleUpdateSubmit(event: FormEvent) {
    event.preventDefault();
    const signal = requests.current?.signal;
    if (!active.current || pending.current || !canManage || !project || !signal || signal.aborted) return;

    const name = nameDraft.trim();
    const description = descriptionDraft.trim() || null;
    if (!name || name.length > 100 || (description?.length ?? 0) > 2000) {
      setSaveError("Use a name of 1–100 characters and a description of at most 2,000 characters.");
      return;
    }

    const input: UpdateProjectInput = {};
    if (name !== project.name) input.name = name;
    if (description !== project.description) input.description = description;
    if (Object.keys(input).length === 0) {
      setSaveError("Change the name or description before saving.");
      return;
    }

    // Save and archive share one immediate lock.
    pending.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      const updated = await updateProject(organizationId, projectId, input, signal);
      if (!active.current || signal.aborted) return;
      setProject(updated); // Includes the unchanged server-owned slug.
      setNameDraft(updated.name);
      setDescriptionDraft(updated.description ?? "");
      setIsEditing(false);
    } catch (failure) {
      if (!active.current || signal.aborted || isAbortError(failure)) return;
      const details = failure instanceof ApiError
        ? failure.details?.flatMap(detail => detail.messages).join(" ")
        : undefined;
      setSaveError(details || getApiErrorMessage(failure, "Failed to update project."));
    } finally {
      pending.current = false;
      if (active.current && !signal.aborted) setIsSaving(false);
    }
  }

  async function handleArchive() {
    const signal = requests.current?.signal;
    if (!active.current || pending.current || !canManage || !signal || signal.aborted) return;
    if (!window.confirm("Archive this project? It will no longer appear in the active project list.")) return;

    pending.current = true;
    setIsArchiving(true);
    setArchiveError(null);
    try {
      await archiveProject(organizationId, projectId, signal);
      if (active.current && !signal.aborted) navigate(listPath, { replace: true });
    } catch (failure) {
      if (!active.current || signal.aborted || isAbortError(failure)) return;
      setArchiveError(getApiErrorMessage(failure, "Failed to archive project."));
    } finally {
      pending.current = false;
      if (active.current && !signal.aborted) setIsArchiving(false);
    }
  }

  function handleEditingChange(open: boolean) {
    if (pending.current) return;
    // Reopen and Cancel both start from the last successful backend result.
    if (project) {
      setNameDraft(project.name);
      setDescriptionDraft(project.description ?? "");
    }
    setSaveError(null);
    setIsEditing(open);
  }

  if (isLoading) return <p role="status">Loading project…</p>;
  if (loadError) return (
    <section>
      <p role="alert">{loadError}</p>
      <Button onClick={() => setAttempt(value => value + 1)}>Retry</Button>
      <Link to={listPath}>Back to projects</Link>
    </section>
  );
  if (!project) return <p role="alert">Project not found.</p>;

  return (
    <section className="mx-auto max-w-md space-y-6 p-6">
      <Link to={listPath}>← Back to projects</Link>
      <h1 className="text-2xl font-semibold">{project.name}</h1>
      <p className="text-sm text-muted-foreground">{project.slug}</p>
      <div className="rounded-lg border p-4 space-y-2 text-sm">
        <p>Description: {project.description ?? "No description yet."}</p>
        <p>Status: {project.archivedAt ? "Archived" : "Active"}</p>
        <p>Created at: {project.createdAt}</p>
        <p>Updated at: {project.updatedAt}</p>
      </div>
      {canManage && (
        <>
          <Dialog open={isEditing} onOpenChange={handleEditingChange}>
            <DialogContent className="rounded-lg" showCloseButton={!isMutating}>
              <DialogHeader>
                <DialogTitle>Edit project</DialogTitle>
                <DialogDescription>Update the project name or description.</DialogDescription>
              </DialogHeader>
              <EditProjectForm
                nameDraft={nameDraft} setNameDraft={setNameDraft}
                descriptionDraft={descriptionDraft} setDescriptionDraft={setDescriptionDraft}
                isSaving={isMutating} saveError={saveError}
                onSubmit={handleUpdateSubmit} onCancel={() => handleEditingChange(false)}
              />
            </DialogContent>
          </Dialog>
          <div className="flex gap-2">
            <Button variant="outline" disabled={isMutating} onClick={() => handleEditingChange(true)}>Edit</Button>
            <Button variant="destructive" disabled={isMutating} onClick={handleArchive}>
              {isArchiving ? "Archiving…" : "Archive project"}
            </Button>
          </div>
          {archiveError && <p role="alert" className="text-sm text-destructive">{archiveError}</p>}
        </>
      )}
      <div className="rounded-lg border p-4">
        <h2 className="font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">API keys, traces, and cost analytics.</p>
      </div>
    </section>
  );
}
