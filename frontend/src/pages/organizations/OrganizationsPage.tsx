import { useState, useEffect } from "react";
import { getOrganizations, createOrganization } from "../../api/organizations.api";
import { OrganizationSummary } from "../../types/workspace.types";

export function OrganizationsPage() {
    const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [newOrgName, setNewOrgName] = useState("");

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

    function handleCreate() {
        if (newOrgName.trim() === "") {
            return;
        }
        createOrganization({ name: newOrgName })
            .then((newOrg) => {
                setOrganizations([...organizations, newOrg]);
                setNewOrgName("");
            })
            .catch((err) => {
                setError(err instanceof Error ? err.message : "Failed to create organization.");
            });
    }

    if (error) {
        return <p>{error}</p>;
    }

    if (isLoading) {
        return <p>Loading...</p>;
    }

    return (
        <div>
            <h1>Organizations</h1>

            <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            <button onClick={handleCreate}>Create</button>

            {organizations.length === 0 ? (
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