import { useState, useRef, useEffect, type FormEvent } from "react";
import {
  getOrganizations,
  createOrganization,
} from "@/api/organizations.api";
import type { OrganizationSummary } from "@/types/workspace.types";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ApiError,
  getApiErrorMessage,
  isAbortError,
} from "@/api/http-client";

export function OrganizationsPage() {
  const [organizations, setOrganizations] = useState<OrganizationSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [retry, setRetry] = useState(0);

  const requests = useRef<AbortController | null>(null);
  const creating = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    requests.current = controller;
    setOrganizations(null);
    setLoadError(null);

    getOrganizations(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setOrganizations(data);
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) {
          setLoadError(
            getApiErrorMessage(error, "Failed to load organizations."),
          );
        }
      });
    // Also cancels a pending creation when this screen is left.
    // Cancellation stops frontend processing; it cannot undo a committed write.
    return () => controller.abort();
  }, [retry]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A ref closes the interval before React renders the disabled button.
    if (creating.current) return;

    const signal = requests.current?.signal;
    if (!signal || signal.aborted) return;

    const name = newOrgName.trim();

    // Native "required" accepts spaces, so validate the trimmed value.
    if (!name) {
      setCreateError("Organization name is required.");
      return;
    }

    if (name.length > 100) {
      setCreateError("Organization name must not exceed 100 characters.");
      return;
    }

    // Clear previous errors only after local validation succeeds.
    setCreateError(null);

    creating.current = true;
    setIsCreating(true);
    setCreateError(null);

    try {
      const organization = await createOrganization({ name }, signal);
      if (signal.aborted) return;
      // Use server-generated IDs, slug, timestamps and currentUserRole.
      setOrganizations(current =>
        [...(current ?? []), organization].sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id),
        ),
      );
      setNewOrgName("");
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;

      const nameError =
        error instanceof ApiError
          ? error.details
            ?.filter(detail => detail.field === "name")
            .flatMap(detail => detail.messages)
            .join(" ")
          : undefined;

      // A failed mutation keeps both the existing list and the user's input.
      setCreateError(
        nameError ||
        getApiErrorMessage(error, "Failed to create organization."),
      );
    } finally {
      creating.current = false;
      if (!signal.aborted) setIsCreating(false);
    }
  }

  if (loadError) {
    return (
      <section className="mx-auto flex max-w-md flex-col items-start gap-3">
        <h1 className="text-2xl font-bold">Organizations</h1>
        <p role="alert">{loadError}</p>
        <Button onClick={() => setRetry(value => value + 1)}>
          Retry
        </Button>
      </section>
    );
  }

  if (organizations === null) {
    return (
      <div
        role="status"
        aria-label="Loading organizations"
        className="mx-auto flex max-w-md flex-col gap-2"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      <h1 className="mx-auto mb-6 max-w-md text-2xl font-bold">
        Organizations
      </h1>

      <Card className="mx-auto mb-6 max-w-md rounded-lg">
        <CardHeader>
          <CardTitle>Create an organization</CardTitle>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={handleCreate}
            aria-busy={isCreating}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={newOrgName}
                required
                maxLength={100}
                disabled={isCreating}
                aria-invalid={Boolean(createError)}
                aria-describedby={createError ? "org-name-error" : undefined}
                onChange={event => {
                  setNewOrgName(event.target.value);
                  setCreateError(null);
                }}
              />
            </div>

            <Button
              className="rounded-lg"
              type="submit"
              disabled={isCreating}
            >
              {isCreating ? "Creating…" : "Create"}
            </Button>

            {createError && (
              <p
                id="org-name-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {createError}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {organizations.length === 0 ? (
        <p className="mx-auto max-w-md text-muted-foreground">
          No organizations yet.
        </p>
      ) : (
        <div className="mx-auto flex max-w-md flex-col gap-2">
          {organizations.map(organization => (
            <Link
              key={organization.id}
              to={`/organizations/${encodeURIComponent(organization.id)}`}
              className="flex w-full items-center justify-between rounded-lg border p-4 transition-colors hover:bg-muted"
            >
              <span className="font-medium">{organization.name}</span>
              <Badge variant="secondary">
                {organization.currentUserRole}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
/*
- Real network request can remain pending, fail, or finish after navigation.
We handle those cases while keeping load errors separate from creation errors.

- Old toast import is removed because the form now displays its error directly.
*/
