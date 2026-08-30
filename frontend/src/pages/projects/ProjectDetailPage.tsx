import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getOrganizationProject } from "../../api/projects.api";
import type { Project } from "../../types/workspace.types";

export function ProjectDetailPage() {
    const { organizationId, projectId } = useParams();
    const [project, setProject] = useState<Project | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!organizationId || !projectId) {
            return;
        }
        let isStale = false;
        setProject(null);
        setError(null);
        setIsLoading(true);
        getOrganizationProject(organizationId, projectId)
            .then((data) => {
                if (isStale) {
                    return;
                }
                setProject(data);
                setIsLoading(false);
            })
            .catch((err) => {
                if (isStale) {
                    return;
                }
                setError(err instanceof Error ? err.message : "Failed to load organization.");
                setIsLoading(false);
            });
            return () => {
                isStale = true;
            };
    }, [organizationId, projectId]);
    if (!projectId) {
        return <p>Missing organization.</p>
    }
    if (isLoading) {
        return <p>Loading...</p>;
    }
    if (error) {
        return <p>{error}</p>;
    }
    if (!project) {
        return <p>Project not found.</p>;
    }
    return (
        <div>
            <h1>Detail of {projectId}</h1>
            <p>
                <Link to={`/organizations/${organizationId}/projects`}> ← Back to projects</Link>
            </p>
            <p>Name: {project.name}</p>
            <p>Slug: {project.slug}</p>
            <p>Description: {project.description ?? "No description yet."}</p>
            <h2>Coming soon</h2>
            <p>API keys coming in M2.</p>
            <p>Traces coming in M2.</p>
            <p>Cost dashboard coming later.</p>
        </div>
    );
}