import { useState, useEffect, type FormEvent  } from "react";
import { getOrganizations, createOrganization } from "../../api/organizations.api";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom";

export function OrganizationsPage() {
    const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);
    const [newOrgName, setNewOrgName] = useState("");

    useEffect(() => {
        getOrganizations()
            .then((data) => {
                setOrganizations(data);
                setIsLoading(false);
            })
            .catch((err) => {
                setLoadError(err instanceof Error ? err.message : "Failed to load organizations.");
                setIsLoading(false);
            });
    }, []);

    function handleCreate(event: FormEvent) {
        event.preventDefault();
        if (newOrgName.trim() === "") {
            return;
        }
        setCreateError(null);
        createOrganization({ name: newOrgName })
            .then((newOrg) => {
                setOrganizations((currentOrganizations) => [
                    ...currentOrganizations,
                    newOrg,
                ]);
                setNewOrgName("");
            })
            .catch((err) => {
                setCreateError(err instanceof Error ? err.message : "Failed to create organization.");
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
            <h1>Organizations</h1>

            <form onSubmit={handleCreate}>
            <label htmlFor="org-name">Organization name </label>
            <input
                id="org-name"
                value={newOrgName}
                onChange={(e) => {
                    setNewOrgName(e.target.value);
                    setCreateError(null);
            }}
            />
            <button type="submit">Create</button>
            </form>
            {createError && <p>{createError}</p>}
            {organizations.length === 0 ? (
                <p>No organizations yet.</p>
            ) : (
                <ul>
                    {organizations.map((org) => (
                        <li key={org.id}>
                            <Link to={`/organizations/${org.id}`}>{org.name}</Link> — {org.currentUserRole}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

