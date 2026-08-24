import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getOrganization } from "../../api/organizations.api";
import { OrganizationSummary } from "../../types/workspace.types";

export function OrganizationDetailPage() {
    const { organizationId } = useParams();

    const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!organizationId) {
            return;
        }
        getOrganization(organizationId)
            .then((data) => {
                setOrganization(data);
                setIsLoading(false);
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to load organization.");
                setIsLoading(false);
            });
    }, [organizationId]);

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
            <p>Name: {organization.name}</p>
            <p>Slug: {organization.slug}</p>
            <p>Your role: {organization.currentUserRole}</p>
        </div>
    );
}