import { useState, useEffect } from "react";
import { getOrganizations } from "../../api/organizations.api";
import { OrganizationSummary } from "../../types/workspace.types";

export function OrganizationsPage() {
    const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        getOrganizations()
            .then((data) => {
                setOrganizations(data);
                setIsLoading(false);
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to load organizations.");
                setIsLoading(false);
            });
    }, []);

    return (
        <div>
            <h1>Organizations</h1>
            {error ? (
                <p>{error}</p>
            ) : isLoading ? (
                <p>Loading...</p>
            ) : organizations.length === 0 ? (
                <p>No organizations yet.</p>
            ) : (
                <ul>
                    {organizations.map((org) => (
                        <li key={org.id}>{org.name} — {org.currentUserRole}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}