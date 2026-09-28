import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  getOrganizationProject,
  updateProject,
  archiveProject,
} from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import type { Project, MembershipRole } from "../../types/workspace.types";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditProjectForm } from "./EditProjectForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ProjectDetailPage() {
  const { organizationId, projectId } = useParams();

  // A different URL gets fresh state, including editor drafts and pending flags.
  return (
    <ProjectDetail
      key={`${organizationId}/${projectId}`}
      organizationId={organizationId}
      projectId={projectId}
    />
  );
}

function ProjectDetail({ organizationId, projectId }: {
  organizationId?: string;
  projectId?: string;
}) {
  const navigate = useNavigate();
  const active = useRef(false);
  const mutationPending = useRef(false);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      // Updating local state is not the only risk: an old archive must not redirect.
      active.current = false;
    };
  }, []);

  const [project, setProject] = useState<Project | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<MembershipRole | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const canManage =
    project !== null && project.archivedAt === null &&
    (currentUserRole === "OWNER" || currentUserRole === "ADMIN");
  const isMutating = isSaving || isArchiving;

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
        // Read the HTTP status without depending on the mock error class.
        // A future API error should expose the same documented statusCode.
        const notFound = typeof err === "object" && err !== null &&
          "statusCode" in err && err.statusCode === 404;
        if (!notFound) {
          setError(err instanceof Error ? err.message : "Failed to load project.");
        }
        setIsLoading(false);
      });
  }, [organizationId, projectId]);

  async function handleUpdateSubmit(event: FormEvent) {
    event.preventDefault();
    if (!active.current || mutationPending.current || !canManage ||
        !organizationId || !projectId || !project) {
      return;
    }
    const nameChanged = nameDraft.trim() !== project.name;
    const descriptionChanged = descriptionDraft !== (project.description ?? "");
    if (!nameChanged && !descriptionChanged) {
      setIsEditing(false);
      return;
    }
    setSaveError(null);
    // The ref blocks a second event immediately, before React rerenders.
    // Save and archive share the lock so they cannot run together.
    mutationPending.current = true;
    setIsSaving(true);
    try {
      const updated = await updateProject(organizationId, projectId, {
      name: nameChanged ? nameDraft : undefined,
      description: descriptionChanged
        ? descriptionDraft.trim() === ""
          ? null
          : descriptionDraft
        : undefined,
      });
      if (!active.current) return;
        setProject(updated);
        setNameDraft(updated.name);
        setDescriptionDraft(updated.description ?? "");
        setIsEditing(false);
      } catch (err) {
      if (active.current) {
        setSaveError(
          err instanceof Error ? err.message : "Failed to update project.",
        );
      }
    } finally {
      mutationPending.current = false;
      if (active.current) setIsSaving(false);
    }
  }

  async function handleArchive() {
    if (!active.current || mutationPending.current || !canManage ||
        !organizationId || !projectId) {
      return;
    }
    const confirmed = window.confirm(
      "Archive this project? It will no longer appear in the active project list.",
    );
    if (!confirmed) {
      return;
    }
    setArchiveError(null);
    mutationPending.current = true;
    setIsArchiving(true);

    try {
      await archiveProject(organizationId, projectId);
      if (active.current) {
        navigate(`/organizations/${organizationId}/projects`);
      }
    } catch (err) {
      if (active.current) {
        setArchiveError(
          err instanceof Error ? err.message : "Failed to archive project.",
        );
      }
    } finally {
      mutationPending.current = false;
      if (active.current) setIsArchiving(false);
    }
  }

  function handleEditingChange(open: boolean) {
    if (mutationPending.current) return;
    setIsEditing(open);
    if (!open && project) {
      setNameDraft(project.name);
      setDescriptionDraft(project.description ?? "");
      setSaveError(null);
    }
  }

  if (!organizationId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Missing organization.</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Organization id not found.
        </p>
      </div>
    );
  }
  if (!projectId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Missing project.</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Project id not found.
        </p>
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
        <p className="mt-4 text-xl font-semibold">
          An unexpected error occurred
        </p>
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

  return (
    <div className="p-6 space-y-6 max-w-md mx-auto">
      <p>
        <Link to={`/organizations/${organizationId}/projects`}>
          ← Back to projects
        </Link>
      </p>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
      </div>
      <p className="text-sm text-muted-foreground">{project.slug}</p>

      <Dialog open={isEditing} onOpenChange={handleEditingChange}>
        <DialogContent className="rounded-lg">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>
          <EditProjectForm
            nameDraft={nameDraft}
            setNameDraft={setNameDraft}
            descriptionDraft={descriptionDraft}
            setDescriptionDraft={setDescriptionDraft}
            isSaving={isSaving}
            saveError={saveError}
            onSubmit={handleUpdateSubmit}
            onCancel={() => handleEditingChange(false)}
          />
        </DialogContent>
      </Dialog>

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
      <div className="rounded-lg border border-border p-4 space-y-1">
        <h2 className="text-lg font-semibold">Coming soon</h2>
        <p className="text-sm text-muted-foreground">API keys coming in M2.</p>
        <p className="text-sm text-muted-foreground">Traces coming in M2.</p>
        <p className="text-sm text-muted-foreground">
          Cost dashboard coming later.
        </p>
      </div>
      <div className="flex items-center gap-2">
        {canManage && (
          <Button
            className="rounded-lg"
            size="sm"
            variant="outline"
            onClick={() => handleEditingChange(true)}
            disabled={isMutating}
          >
            Edit
          </Button>
        )}
        {canManage && (
          <div className="space-y-2">
            <Button
              className="rounded-lg"
              variant="destructive"
              onClick={handleArchive}
              disabled={isMutating}
            >
              {isArchiving ? "Archiving..." : "Archive project"}
            </Button>
            {archiveError && (
              <p className="text-sm text-destructive">{archiveError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
