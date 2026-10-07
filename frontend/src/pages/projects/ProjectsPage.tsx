import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Link, useParams } from "react-router-dom";
import { createProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import {
  ApiError,
  getApiErrorMessage,
  isAbortError,
} from "../../api/http-client";
import { useOrganizationProjects } from "../../hooks/useOrganizationProjects";
import type { MembershipRole } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Folder } from "lucide-react";

export function ProjectsPage() {
  const { organizationId } = useParams();

  if (!organizationId) return <p role="alert">Missing organization.</p>;

  return (
    <OrganizationProjects
      key={organizationId}
      organizationId={organizationId}
    />
  );
}

function OrganizationProjects({
  organizationId,
}: {
  organizationId: string;
}) {
  const {
    projects,
    hasLoaded,
    isLoading,
    error,
    reload,
  } = useOrganizationProjects(organizationId);

  const [role, setRole] = useState<MembershipRole | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [accessLost, setAccessLost] = useState(false);

  const requests = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const active = useRef(false);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;

    setRole(null);
    setRoleError(null);

    getOrganization(organizationId, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setRole(result.currentUserRole);
        }
      })
      .catch(failure => {
        if (!controller.signal.aborted && !isAbortError(failure)) {
          setRoleError(
            getApiErrorMessage(failure, "Failed to load organization."),
          );
        }
      });

    // Reads and creation share this screen's lifetime.
    return () => controller.abort();
  }, [organizationId, attempt]);

  function retry() {
    setAttempt(value => value + 1);
    reload();
  }

  const canManage = role === "OWNER" || role === "ADMIN";

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const signal = requests.current?.signal;
    if (
      !active.current ||
      pending.current ||
      !canManage ||
      !signal ||
      signal.aborted
    ) return;

    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (
      !trimmedName ||
      trimmedName.length > 100 ||
      trimmedDescription.length > 2000
    ) {
      setCreateError(
        "Use a name of 1–100 characters and a description of at most 2,000 characters.",
      );
      return;
    }

    pending.current = true;
    setIsCreating(true);
    setCreateError(null);

    try {
      await createProject(
        organizationId,
        {
          name: trimmedName,
          ...(trimmedDescription
            ? { description: trimmedDescription }
            : {}),
        },
        signal,
      );

      if (!active.current || signal.aborted) return;

      // The adapter publishes the returned project to both list subscribers.
      setName("");
      setDescription("");
    } catch (failure) {
      if (
        !active.current ||
        signal.aborted ||
        isAbortError(failure)
      ) return;
      if (failure instanceof ApiError && failure.code === "ORGANIZATION_NOT_FOUND") {
        // The organization was archived or access was lost: clear the page.
        setAccessLost(true);
        return;
      }

      const details = failure instanceof ApiError
        ? failure.details?.flatMap(detail => detail.messages).join(" ")
        : undefined;

      setCreateError(
        details ||
        getApiErrorMessage(failure, "Failed to create project."),
      );
    } finally {
      pending.current = false;
      if (active.current && !signal.aborted) setIsCreating(false);
    }
  }

  const loadError = roleError ?? error;
  if (accessLost) {
    return (
      <section>
        <p role="alert">Organization not found.</p>
        <Link to="/organizations">Back to organizations</Link>
      </section>
    );
  }
  if (roleError || !hasLoaded || role === null) {
    return loadError ? (
      <section>
        <p role="alert">{loadError}</p>
        <Button onClick={retry}>Retry</Button>
        <Link to="/organizations">Back to organizations</Link>
      </section>
    ) : (
      <p role="status">Loading projects…</p>
    );
  }

  return (
    <section className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold">Projects</h1>

      {isLoading && <p role="status">Refreshing projects…</p>}

      {error && (
        <div>
          <p role="alert">{error}</p>
          <Button onClick={reload}>Retry</Button>
        </div>
      )}

      {canManage && (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle>Create a project</CardTitle>
          </CardHeader>

          <CardContent>
            <form
              onSubmit={handleCreate}
              aria-busy={isCreating}
              className="flex flex-col gap-3"
            >
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                required
                maxLength={100}
                disabled={isCreating}
                onChange={event => {
                  setName(event.target.value);
                  setCreateError(null);
                }}
              />

              <Label htmlFor="project-description">
                Description (optional)
              </Label>
              <Input
                id="project-description"
                value={description}
                maxLength={2000}
                disabled={isCreating}
                onChange={event => {
                  setDescription(event.target.value);
                  setCreateError(null);
                }}
              />

              <Button type="submit" disabled={isCreating}>
                {isCreating ? "Creating…" : "Create"}
              </Button>

              {createError && (
                <p role="alert" className="text-sm text-destructive">
                  {createError}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {projects.length === 0 ? (
        <p>No projects yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {projects.map(project => (
            <Link
              key={project.id}
              to={
                "/organizations/" +
                encodeURIComponent(organizationId) +
                "/projects/" +
                encodeURIComponent(project.id)
              }
              className="flex items-center gap-3 rounded-lg border p-4 hover:bg-muted"
            >
              <Folder className="h-4 w-4" />
              <span className="font-medium">{project.name}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
