import { useState, useEffect, type FormEvent  } from "react";
import type { Project, CreateProjectInput } from "../../types/workspace.types";
import { useParams, Link } from "react-router-dom";
import { getOrganizationProjects, createProject } from "../../api/projects.api";
import { getOrganization } from "../../api/organizations.api";
import type { MembershipRole } from "../../types/workspace.types";

export function ProjectsPage() {
    const { organizationId } = useParams();
    const [projects, setProjects] = useState<Project[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [newProjectName, setNewProjectName] = useState("");
    const [currentUserRole, setCurrentUserRole] = useState<MembershipRole | null>(null);

    useEffect(() => {
        if (!organizationId) {
            return;
        }
        setProjects([]);
        setCurrentUserRole(null);
        setLoadError(null);
        setCreateError(null);
        setNewProjectName("");
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
        createProject(organizationId, { name: newProjectName })
            .then((newProject) => {
                setProjects((currentProjects) => [
                    ...currentProjects,
                    newProject,
                ]);
                setNewProjectName("");
            })
            .catch((err) => {
                setCreateError(err instanceof Error ? err.message : "Failed to create project.");
            });
    }
    if (loadError) {
        return <p>{loadError}</p>;
    }
    if (isLoading) {
        return <p>Loading...</p>;
    }
    return (
        <div>
            <h1>Projects</h1>
            {(currentUserRole === "OWNER" || currentUserRole === "ADMIN") && (
                <form onSubmit={handleCreate}>
                <label htmlFor="project-name">Project name </label>
                <input
                    id="project-name"
                    value={newProjectName}
                    onChange={(e) => {
                        setNewProjectName(e.target.value);
                        setCreateError(null);
            }}
            />
            <button type="submit">Create</button>
        </form>
    )}
    {createError && <p>{createError}</p>}
    {projects.length === 0 ? (
        <p>No projects yet.</p>
    ) : (
        <ul>
            {projects.map((project) => (
                <li key={project.id}>
                    <Link to={`/organizations/${organizationId}/projects/${project.id}`}>
                        {project.name}
                    </Link>
                </li>
                ))}
        </ul>
        )}
        </div>
    );
}
