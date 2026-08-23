import { useParams } from "react-router-dom";
import { getOrganizations } from "../../api/organizations.api";
import { getMembershipForOrganization } from "../../api/memberships.api";
import { useEffect, useState } from "react";
import { Organization, Membership } from "../../types/workspace.types";

export function OrganizationDetail() {
    const { organizationId } = useParams();

    const [ organization, setOrganization ] = useState<Organization | null>(null);
    const [ membership, setMembership] = useState<Membership | null>(null);
    const [ isLoading, setIsLoading ] = useState(true);

    useEffect(() => {
        getOrganizations()
        .then((data) => {
            const found = data.find((org) => org.id === organizationId);
            setOrganization(found ?? null);

            if (organizationId) {
                getMembershipForOrganization(organizationId).then((m) => {
                    setMembership(m ?? null);
                    setIsLoading(false);
                });
            }
        });
    }, [organizationId]);
    return (
        <div>
            <h1>Detail of {organizationId}</h1>
            { isLoading ? (
                <p>Loading...</p>
            ) : !organization ? (
                <p>Organization not found.</p> 
            ) : !membership ? (
                <p>Access denied. You are not a member of this organization.</p>
            ) : (
                <div>
                    <p>Name: {organization?.name}</p>
                    <p>Slug: {organization?.slug}</p>
                    <p>Your role: {membership?.role}</p>
                </div>
            )}
        </div>)
}