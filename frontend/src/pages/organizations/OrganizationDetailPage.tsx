import { useNavigate, useParams } from "react-router-dom";
import {archiveOrganization, getOrganization, updateOrganization,} from "../../api/organizations.api";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,} from "@/components/ui/dialog";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrganizationSummary } from "../../types/workspace.types";
import { Link } from "react-router-dom"
import { Card } from "@/components/ui/card";
import { Folder, Users, FolderX, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, getApiErrorMessage, isAbortError } from "@/api/http-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OrganizationDetailPage() {
    const { organizationId } = useParams();

    if (!organizationId) {
        return (
            <section>
                <p role="alert">No organization was specified in the URL.</p>
                <Link to="/organizations">Back to organizations</Link>
            </section>
        );
    }

    // Reset state before rendering another organization's URL.
    return (
        <OrganizationDetail
            key={organizationId}
            organizationId={organizationId}
        />
    );
}

function OrganizationDetail({ organizationId, }: {
    organizationId: string;
}) {
    const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const requests = useRef<AbortController | null>(null);
    const saving = useRef(false);
    const navigate = useNavigate();
    const [isArchiveOpen, setIsArchiveOpen] = useState(false);
    const [confirmSlug, setConfirmSlug] = useState("");
    const [isArchiving, setIsArchiving] = useState(false);
    const [archiveError, setArchiveError] = useState<string | null>(null);
    const archiving = useRef(false);

    useEffect(() => {
        const controller = new AbortController();
        requests.current = controller;
        setOrganization(null);
        setError(null);
        setIsLoading(true);

        getOrganization(organizationId, controller.signal)
            .then((data) => {
                if (!controller.signal.aborted) setOrganization(data);
            })
            .catch(failure => {
                if (!controller.signal.aborted && !isAbortError(failure)) {
                    setError(
                        getApiErrorMessage(failure, "Failed to load organization."),
                    );
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setIsLoading(false);
            });
        // Cancel reads and pending renames when leaving this organization.
        // Aborting the browser request cannot undo a committed backend write.
        return () => controller.abort();
    }, [organizationId, retry]);

    async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        // A ref prevents a second submission before React disables the form.
        if (saving.current || archiving.current || organization?.currentUserRole !== "OWNER") return;

        const signal = requests.current?.signal;
        if (!signal || signal.aborted) return;

        const name = nameDraft.trim();

        // Native required validation accepts spaces; validate the trimmed name.
        if (!name) {
            setSaveError("Organization name is required.");
            return;
        }

        if (name.length > 100) {
            setSaveError("Organization name must not exceed 100 characters.");
            return;
        }

        saving.current = true;
        setIsSaving(true);
        setSaveError(null);

        try {
            const updated = await updateOrganization(
                organizationId,
                { name },
                signal,
            );

            if (signal.aborted) return;

            // The backend owns the slug, timestamps, and effective role.
            setOrganization(updated);
            setNameDraft(updated.name);
            setIsEditing(false);
        } catch (failure) {
            if (signal.aborted || isAbortError(failure)) return;

            const nameError = failure instanceof ApiError
                ? failure.details
                    ?.filter(detail => detail.field === "name")
                    .flatMap(detail => detail.messages)
                    .join(" ")
                : undefined;

            // Keep the organization and draft. Only the shared client handles 401.
            setSaveError(
                nameError ||
                getApiErrorMessage(failure, "Failed to rename organization."),
            );
        } finally {
            saving.current = false;
            if (!signal.aborted) setIsSaving(false);
        }
    }
    async function handleArchiveSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        // A ref prevents a second submission before React disables the form.
        if (archiving.current || saving.current || organization?.currentUserRole !== "OWNER") return;

        const signal = requests.current?.signal;
        if (!signal || signal.aborted) return;

        // Exact comparison, like the backend: no trim and no lowercase.
        if (confirmSlug !== organization.slug) return;

        archiving.current = true;
        setIsArchiving(true);
        setArchiveError(null);

        try {
            await archiveOrganization(organizationId, { confirmSlug }, signal);

            if (signal.aborted) return;
            navigate("/organizations", { replace: true });
        } catch (failure) {
            if (signal.aborted || isAbortError(failure)) return;
            if (failure instanceof ApiError && failure.code === "ORGANIZATION_NOT_FOUND") {
                // Already deleted or access lost: show the existing not-found state.
                setIsArchiveOpen(false);
                setOrganization(null);
                return;
            }
            if (failure instanceof ApiError && failure.code === "INSUFFICIENT_ORGANIZATION_ROLE") {
                // The role changed: close the dialog and reload the effective role.
                setIsArchiveOpen(false);
                setConfirmSlug("");
                setRetry(value => value + 1);
                return;
            }

            // Keep the dialog and the typed value so the owner can retry.
            setArchiveError(
                getApiErrorMessage(failure, "Failed to delete organization."),
            );
        } finally {
            archiving.current = false;
            if (!signal.aborted) setIsArchiving(false);
        }
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
    if (error) {
        return (
            <section className="mx-auto flex max-w-md flex-col items-start gap-3">
                <p role="alert">{error}</p>
                <Button onClick={() => setRetry(value => value + 1)}>
                    Retry
                </Button>
                <Link to="/organizations">Back to organizations</Link>
            </section>
        );
    }
    if (!organization) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center mb-6 ">
                <FolderX className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-xl font-semibold">Organization not found</p>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                    This organization doesn't exist or you don't have access to it.
                </p>
                <Link
                    to="/organizations"
                    className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-transparent hover:bg-muted h-10 px-6 text-sm font-medium normal-case transition-all"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back to organizations
                </Link>
            </div>
        );
    }
    return (
        <div>
            <h1 className="mb-6 text-2xl font-bold max-w-md mx-auto" >Detail of {organizationId}</h1>
            <Card className="mb-6 max-w-md mx-auto rounded-lg px-8">
                <div className="flex flex-wrap items-start justify-between gap-3 py-2 border-b">
                    <span className="text-sm text-muted-foreground">Name</span>

                    {isEditing && organization.currentUserRole === "OWNER" ? (
                        <form
                            onSubmit={handleRenameSubmit}
                            aria-busy={isSaving}
                            className="flex w-full flex-col gap-2"
                        >
                            <Label htmlFor="organization-rename-name">
                                Organization name
                            </Label>

                            <Input
                                id="organization-rename-name"
                                value={nameDraft}
                                required
                                maxLength={100}
                                disabled={isSaving}
                                aria-invalid={Boolean(saveError)}
                                aria-describedby={
                                    saveError ? "organization-rename-error" : undefined
                                }
                                onChange={event => {
                                    setNameDraft(event.target.value);
                                    setSaveError(null);
                                }}
                            />

                            <div className="flex gap-2">
                                <Button type="submit" disabled={isSaving}>
                                    {isSaving ? "Saving…" : "Save"}
                                </Button>

                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={isSaving}
                                    onClick={() => {
                                        setIsEditing(false);
                                        setNameDraft(organization.name);
                                        setSaveError(null);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>

                            {saveError && (
                                <p
                                    id="organization-rename-error"
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {saveError}
                                </p>
                            )}
                        </form>
                    ) : (
                        <span className="flex items-center gap-2 text-sm font-medium">
                            {organization.name}

                            {organization.currentUserRole === "OWNER" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={isArchiving}
                                    onClick={() => {
                                        // Always start from the last server-confirmed name.
                                        setNameDraft(organization.name);
                                        setSaveError(null);
                                        setIsEditing(true);
                                    }}
                                >
                                    Rename
                                </Button>
                            )}
                        </span>
                    )}
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
            {organization.currentUserRole === "OWNER" && (
                <div className="mb-6 max-w-md mx-auto">
                    <Button
                        type="button"
                        variant="destructive"
                        disabled={isSaving}
                        onClick={() => {
                            setConfirmSlug("");
                            setArchiveError(null);
                            setIsArchiveOpen(true);
                        }}
                    >
                        Delete organization
                    </Button>
                </div>
            )}
            <Dialog
                open={isArchiveOpen}
                onOpenChange={open => {
                    // The dialog cannot be dismissed while the request is pending.
                    if (!isArchiving) setIsArchiveOpen(open);
                }}
            >
                <DialogContent>
                    <form
                        onSubmit={handleArchiveSubmit}
                        aria-busy={isArchiving}
                        className="flex flex-col gap-3"
                    >
                        <DialogHeader>
                            <DialogTitle>Delete organization</DialogTitle>
                            <DialogDescription>
                                This organization and its contents will become inaccessible. Stored data
                                is retained. Restoration is not available in the application.
                            </DialogDescription>
                            <p className="text-sm">
                                 Organization: <strong>{organization.name}</strong>
                            </p>
                            <p className="text-sm">
                                Type <strong>{organization.slug}</strong> to confirm.
                            </p>
                        </DialogHeader>

                        <Label htmlFor="organization-archive-slug">
                            Organization slug
                        </Label>
                        <Input
                            id="organization-archive-slug"
                            value={confirmSlug}
                            autoComplete="off"
                            disabled={isArchiving}
                            aria-invalid={Boolean(archiveError)}
                            aria-describedby={
                                archiveError ? "organization-archive-error" : undefined
                            }
                            onChange={event => {
                                setConfirmSlug(event.target.value);
                                setArchiveError(null);
                            }}
                        />

                        {archiveError && (
                            <p
                                id="organization-archive-error"
                                role="alert"
                                className="text-sm text-destructive"
                            >
                                {archiveError}
                            </p>
                        )}

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                disabled={isArchiving}
                                onClick={() => setIsArchiveOpen(false)}
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                variant="destructive"
                                disabled={isArchiving || confirmSlug !== organization.slug}
                            >
                                {isArchiving ? "Deleting..." : "Delete organization"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
            <div className="grid grid-cols-2 gap-3 mb-6 max-w-md mx-auto ">
                <Link
                    to={`/organizations/${organizationId}/projects`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 h-10 px-6 text-sm font-medium normal-case transition-all"
                >
                    <Folder className="h-4 w-4" />
                    Projects
                </Link>
                <Link
                    to={`/organizations/${organizationId}/members`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 h-10 px-6 text-sm font-medium normal-case transition-all"
                >
                    <Users className="h-4 w-4" />
                    Members
                </Link>
            </div>
        </div>
    );
}
