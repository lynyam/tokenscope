import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState, type FormEvent } from "react";
import { getOrganizationProject, updateProject, archiveProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import type { Project, MembershipRole } from "../../types/workspace.types";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProjectDetailPage() {
  const { organizationId, projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<MembershipRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId || !projectId) {
      return;
    }
    let isStale = false;
    setProject(null);
    setCurrentUserRole(null);
    setError(null);
    setIsLoading(true);
    Promise.all([
      getOrganization(organizationId),
      getOrganizationProject(organizationId, projectId),
    ])
      .then(([organization, projectData]) => {
        if (isStale) {
          return;
        }
        setCurrentUserRole(organization.currentUserRole);
        setProject(projectData);
        setNameDraft(projectData.name);
        setDescriptionDraft(projectData.description ?? "");
        setIsLoading(false);
      })
      .catch((err) => {
        if (isStale) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load project.");
        setIsLoading(false);
      });
    return () => {
      isStale = true;
    };
  }, [organizationId, projectId]);

  function handleUpdateSubmit(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !projectId || !project || isSaving) {
      return;
    }
    const nameChanged = nameDraft.trim() !== project.name;
    const descriptionChanged = descriptionDraft !== (project.description ?? "");
    if (!nameChanged && !descriptionChanged) {
      setIsEditing(false);
      return;
    }
    setSaveError(null);
    setIsSaving(true);
    updateProject(organizationId, projectId, {
      name: nameChanged ? nameDraft : undefined,
      description: descriptionChanged ? (descriptionDraft.trim() === "" ? null : descriptionDraft) : undefined,
    })
      .then((updated) => {
        setProject(updated);
        setNameDraft(updated.name);
        setDescriptionDraft(updated.description ?? "");
        setIsEditing(false);
        setIsSaving(false);
      })
      .catch((err) => {
        setSaveError(err instanceof Error ? err.message : "Failed to update project.");
        setIsSaving(false);
      });
  }

  function handleArchive() {
    if (!organizationId || !projectId || isArchiving) {
      return;
    }
    const confirmed = window.confirm("Archive this project? It will no longer appear in the active project list.");
    if (!confirmed) {
      return;
    }
    setArchiveError(null);
    setIsArchiving(true);
    archiveProject(organizationId, projectId)
      .then(() => {
        navigate(`/organizations/${organizationId}/projects`);
      })
      .catch((err) => {
        setArchiveError(err instanceof Error ? err.message : "Failed to archive project.");
        setIsArchiving(false);
      });
  }

  if (!organizationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Missing organization.</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Organization id not found.</p>
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Missing project.</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Project id not found.</p>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 max-w-md mx-auto">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">An unexpected error occurred</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Project not found</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          This project doesn't exist or you don't have access to it.
        </p>
      </div>
    );
  }

  const canManage = 
    (currentUserRole === "OWNER" || currentUserRole === "ADMIN") && !project.archivedAt;

  return (
    <div className="p-6 space-y-6 max-w-md mx-auto">
      <p>
        <Link to={`/organizations/${organizationId}/projects`}>← Back to projects</Link>
      </p>

      {isEditing ? (
        <form onSubmit={handleUpdateSubmit} className="space-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Input
              id="edit-description"
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              disabled={isSaving}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => {
                setIsEditing(false);
                setNameDraft(project.name);
                setDescriptionDraft(project.description ?? "");
                setSaveError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        </form>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{project.slug}</p>
        </div>
      )}

      <div className="rounded-lg border border-border p-4 space-y-2 text-sm">
        <p>
          <span className="font-medium">Description:</span>{" "}
          {project.description ?? "No description yet."}
        </p>
        <p>
          <span className="font-medium">Status:</span>{" "}
          {project.archivedAt ? "Archived" : "Active"}
        </p>
        <p>
          <span className="font-medium">Created at:</span> {project.createdAt}
        </p>
        <p>
          <span className="font-medium">Updated at:</span> {project.updatedAt}
        </p>
      </div>

      {canManage && (
        <div className="space-y-2">
          <Button variant="destructive" onClick={handleArchive} disabled={isArchiving}>
            {isArchiving ? "Archiving..." : "Archive project"}
          </Button>
          {archiveError && <p className="text-sm text-destructive">{archiveError}</p>}
        </div>
      )}

      <div className="rounded-lg border border-border p-4 space-y-1">
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">API keys coming in M2.</p>
        <p className="text-sm text-muted-foreground">Traces coming in M2.</p>
        <p className="text-sm text-muted-foreground">Cost dashboard coming later.</p>
      </div>
    </div>
  );
}