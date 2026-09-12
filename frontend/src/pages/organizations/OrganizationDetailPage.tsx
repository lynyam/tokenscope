import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { getOrganization } from "../../api/organizations.api";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Folder, Users } from "lucide-react";

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
            <h1 className="mb-6 text-2xl font-bold max-w-md mx-auto" >Detail of {organizationId}</h1>
            <Card className="mb-6 max-w-md mx-auto rounded-lg px-8">
                <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Name</span>
                    <span className="text-sm font-medium">{organization.name}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Slug</span>
                    <span className="text-sm font-medium">{organization.slug}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                    <span className="text-sm text-muted-foreground">Your role</span>
                    <span className="text-sm font-medium">{organization.currentUserRole}</span>
                </div>
            </Card>
            <div className="grid grid-cols-2 gap-3 mb-6 max-w-md mx-auto ">
                <Button asChild variant="default" className="rounded-lg normal-case">
                    <Link to={`/organizations/${organizationId}/projects`} className="flex items-center justify-center gap-2">
                        <Folder className="h-4 w-4" />
                        Projects
                    </Link>
                    </Button>
                    <Button asChild variant="default" className="rounded-lg normal-case">
                    <Link to={`/organizations/${organizationId}/members`} className="flex items-center justify-center gap-2">
                        <Users className="h-4 w-4" />
                        Members
                    </Link>
                </Button>
            </div>
            {/* <p>
                <Link to={`/organizations/${organizationId}/projects`}>Projects</Link>
            </p>
            <p>
                <Link to={`/organizations/${organizationId}/members`}>Members</Link>
            </p> */}
        </div>
    );
}
