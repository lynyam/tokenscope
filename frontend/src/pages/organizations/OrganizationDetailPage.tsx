import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { getOrganization, updateOrganization } from "../../api/organizations.api";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom"

export function OrganizationDetailPage() {
    const { organizationId } = useParams();

    const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [isEditing, setIsEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

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
                setNameDraft(data.name);
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

    function handleRenameSubmit(event: FormEvent) {
        event.preventDefault();
        if (!organizationId || isSaving) {
            return;
        }
        setSaveError(null);
        setIsSaving(true);
        updateOrganization(organizationId, { name: nameDraft })
            .then((updated) => {
                setOrganization(updated);
                setIsEditing(false);
                setIsSaving(false);
            })
            .catch((err) => {
                setSaveError(err instanceof Error ? err.message : "Failed to rename organization.");
                setIsSaving(false);
            });
    }

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

            {isEditing ? (
                <form onSubmit={handleRenameSubmit}>
                    <label htmlFor="org-name">Name</label>
                    <input
                        id="org-name"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        disabled={isSaving}
                    />
                    <button type="submit" disabled={isSaving}>
                        {isSaving ? "Saving..." : "Save"}
                    </button>
                    <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => {
                            setIsEditing(false);
                            setNameDraft(organization.name);
                            setSaveError(null);
                        }}
                    >
                        Cancel
                    </button>
                    {saveError && <p>{saveError}</p>}
                </form>
            ) : (
                <p>
                    Name: {organization.name}
                    {organization.currentUserRole === "OWNER" && (
                        <button onClick={() => setIsEditing(true)}>Rename</button>
                    )}
                </p>
            )}

            <p>Slug: {organization.slug}</p>
            <p>Your role: {organization.currentUserRole}</p>
        </div>
    );
}