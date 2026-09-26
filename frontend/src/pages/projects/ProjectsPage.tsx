import { useState, useEffect, type FormEvent } from "react";
import type { Project, CreateProjectInput } from "../../types/workspace.types";
import { useParams, Link } from "react-router-dom";
import { getOrganizationProjects, createProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import type { MembershipRole } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Folder } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";

export function ProjectsPage() {
  const { organizationId } = useParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<MembershipRole | null>(
    null,
  );

  useEffect(() => {
    if (!organizationId) {
      return;
    }
    setProjects([]);
    setCurrentUserRole(null);
    setLoadError(null);
    setCreateError(null);
    setNewProjectName("");
    setNewProjectDescription("");
    setIsLoading(true);
    let isStale = false;
    Promise.all([
      getOrganization(organizationId),
      getOrganizationProjects(organizationId),
    ])
      .then(([organization, projects]) => {
        if (isStale) {
          return;
        }
        setCurrentUserRole(organization.currentUserRole);
        setProjects(projects);
      })
      .catch((error) => {
        if (isStale) {
          return;
        }
        if (error instanceof Error) {
          setLoadError(error.message);
        } else {
          setLoadError("Failed to load projects.");
        }
      })
      .finally(() => {
        if (!isStale) {
          setIsLoading(false);
        }
      });
    return () => {
      isStale = true;
    };
  }, [organizationId]);
  function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || newProjectName.trim() === "") {
        return;
    }
    setCreateError(null);
    createProject(organizationId, {
        name: newProjectName,
        description: newProjectDescription || undefined,
    })
        .then((newProject) => {
            setProjects((currentProjects) => [...currentProjects, newProject]);
            setNewProjectName("");
            setNewProjectDescription("");
        })
        .catch((err) => {
            setCreateError(err instanceof Error ? err.message : "Failed to create project.");
        });
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
              <Button className="rounded-lg" type="submit">
                Create
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
