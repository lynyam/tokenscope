import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getOrganization } from "../../api/organizations.api";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom"

export function OrganizationDetailPage() {
    const { organizationId } = useParams();

    const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!organizationId) {
            return;
        }
        let isStale = false;
        setOrganization(null);
        setError(null);
        setIsLoading(true);
        getOrganization(organizationId)
            .then((data) => {
                if (isStale) {
                    return;
                }
                setOrganization(data);
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
    }, [organizationId]);
    if (!organizationId) {
        return <p>Missing organization.</p>
    }
    if (isLoading) {
        return <p>Loading...</p>;
    }
    if (error) {
        return <p>{error}</p>;
    }
    if (!organization) {
        return <p>Organization not found.</p>;
    }
    return (
        <div>
            <h1>Detail of {organizationId}</h1>
            <p>
                <Link to={`/organizations/${organizationId}/projects`}>Projects</Link>
            </p>
            <p>
                <Link to={`/organizations/${organizationId}/members`}>Members</Link>
            </p>
            <p>Name: {organization.name}</p>
            <p>Slug: {organization.slug}</p>
            <p>Your role: {organization.currentUserRole}</p>
        </div>
    );
}
