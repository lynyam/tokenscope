import { useState, useEffect, type FormEvent  } from "react";
import { getOrganizations, createOrganization } from "../../api/organizations.api";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";


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
                toast.error(err instanceof Error ? err.message : "Failed to create organization.");
            });
    }
    if (loadError) {
        return <p>{loadError}</p>;
    }
    if (isLoading) {
        return (
            <>
            <Skeleton className="h-8 w-48 mx-auto mb-6" />
                <div className="flex flex-col gap-2 max-w-md mx-auto">
                    {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                    ))}
                </div>
            </>
        );
    }
    return (
    <>
        <h1 className="mb-6 text-2xl font-bold max-w-md mx-auto">Organizations</h1>

        <Card className="mb-6 max-w-md mx-auto rounded-lg">
        <CardHeader>
            <CardTitle>Create an organization</CardTitle>
        </CardHeader>
        <CardContent>
            <form onSubmit={handleCreate} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="org-name">Organization name</Label>
                    <Input
                    id="org-name"
                    value={newOrgName}
                    onChange={(e) => {
                        setNewOrgName(e.target.value);
                        setCreateError(null);
                    }}
                    />
                </div>
                <Button className="rounded-lg" type="submit">Create</Button>
                {createError && <p className="text-sm text-destructive">{createError}</p>}
            </form>
        </CardContent>
        </Card>
        {organizations.length === 0 ? (
        <p className="text-muted-foreground max-w-md mx-auto">No organizations yet.</p>
        ) : (
        <div className="flex flex-col gap-2 max-w-md mx-auto">
            {organizations.map((org) => (
            <Link
                key={org.id}
                to={`/organizations/${org.id}`}
                className="flex w-full items-center justify-between rounded-lg border p-4 hover:bg-muted transition-colors animate-in fade-in duration-300"
            >
                <span className="font-medium">{org.name}</span>
                <Badge variant="secondary">{org.currentUserRole}</Badge>
            </Link>
            ))}
        </div>
        )}
    </>
    );
}