import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  type FormEvent,
} from "react";
import { useParams, Link } from "react-router-dom";
import { createProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import type { MembershipRole } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Folder } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlert } from "lucide-react";
import { useOrganizationProjects } from "../../hooks/useOrganizationProjects";

export function ProjectsPage() {
  const { organizationId } = useParams();
  if (!organizationId) return <p>Missing organization.</p>;
  return <OrganizationProjects key={organizationId} organizationId={organizationId} />;
}

function OrganizationProjects({ organizationId }: { organizationId: string }) {
  const { projects, isLoading: projectsLoading, error: projectsError } =
    useOrganizationProjects(organizationId);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const createPending = useRef(false);
  const active = useRef(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<MembershipRole | null>(
    null,
  );

  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  useEffect(() => {
    setCurrentUserRole(null);
    setRoleError(null);
    setRoleLoading(true);
    let isStale = false;
    getOrganization(organizationId)
      .then((organization) => {
        if (isStale) {
          return;
        }
        setCurrentUserRole(organization.currentUserRole);
      })
      .catch((error) => {
        if (isStale) {
          return;
        }
        if (error instanceof Error) {
          setRoleError(error.message);
        } else {
          setRoleError("Failed to load organization.");
        }
      })
      .finally(() => {
        if (!isStale) {
          setRoleLoading(false);
        }
      });
    return () => {
      isStale = true;
    };
  }, [organizationId]);
  const isLoading = roleLoading || projectsLoading;
  const loadError = roleError ?? projectsError;

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!active.current || createPending.current || newProjectName.trim() === "" ||
        (currentUserRole !== "OWNER" && currentUserRole !== "ADMIN")) {
      return;
    }
    setCreateError(null);
    createPending.current = true;
    setIsCreating(true);
    try {
      await createProject(organizationId, {
        name: newProjectName,
        description: newProjectDescription || undefined,
      });
      // The successful API write refreshes both the page and sidebar.
      // Do not append here as well: the refreshed list already includes the item.
      if (!active.current) return;
      setNewProjectName("");
      setNewProjectDescription("");
    } catch (err) {
      if (active.current) {
        setCreateError(err instanceof Error ? err.message : "Failed to create project.");
      }
    } finally {
      createPending.current = false;
      if (active.current) setIsCreating(false);
    }
  }
  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
        <CircleAlert className="h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-xl font-semibold">Loading error</p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          Something went wrong while loading this page. Please try again.
        </p>
      </div>
    );
  }
  if (isLoading) {
    return (
      <>
        <div className="flex flex-col gap-2 max-w-md mx-auto">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold max-w-md mx-auto">Projects</h1>

      {(currentUserRole === "OWNER" || currentUserRole === "ADMIN") && (
        <Card className="mb-6 max-w-md mx-auto rounded-lg">
          <CardHeader>
            <CardTitle>Create a project</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="project-name">Project name</Label>
                <Input
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    setCreateError(null);
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="project-description">Description (optional)</Label>
                <Input
                  id="project-description"
                  value={newProjectDescription}
                  onChange={(e) => setNewProjectDescription(e.target.value)}
                  />
              </div>
              <Button className="rounded-lg" type="submit" disabled={isCreating}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
              {createError && (
                <p className="text-sm text-destructive">{createError}</p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <p className="text-muted-foreground max-w-md mx-auto">
          No projects yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-w-md mx-auto grid grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/organizations/${organizationId}/projects/${project.id}`}
              className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted transition-colors"
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{project.name}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
