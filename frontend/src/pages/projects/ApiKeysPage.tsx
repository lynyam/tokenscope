import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getOrganization } from "../../api/organizations.api";
import { getOrganizationProject } from "../../api/projects.api";
import { listProjectApiKeys } from "../../api/api-keys.api";
import { ApiError, getApiErrorMessage, isAbortError } from "../../api/http-client";
import type { ApiKeySummary } from "../../types/api-key.types";
import type { MembershipRole, Project } from "../../types/workspace.types";
import { Button } from "@/components/ui/button";

export function ApiKeysPage() {
  const { organizationId, projectId } = useParams();
  if (!organizationId || !projectId) return <p role="alert">Missing organization or project.</p>;
  // The key resets every piece of state when the route target changes.
  return <ApiKeys key={organizationId + "/" + projectId}
    organizationId={organizationId} projectId={projectId} />;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function ApiKeys({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const projectPath = "/organizations/" + encodeURIComponent(organizationId)
    + "/projects/" + encodeURIComponent(projectId);

  // Phase 1: who am I here, and does this project exist for me?
  const [contextAttempt, setContextAttempt] = useState(0);
  const [role, setRole] = useState<MembershipRole | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [contextLoading, setContextLoading] = useState(true);
  const [contextError, setContextError] = useState<string | null>(null);

  // Phase 2: the key list, only for OWNER/ADMIN.
  const [listAttempt, setListAttempt] = useState(0);
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const canManage = project !== null && project.archivedAt === null
    && (role === "OWNER" || role === "ADMIN");

  useEffect(() => {
    const controller = new AbortController();
    setRole(null);
    setProject(null);
    setKeys(null);
    setContextError(null);
    setContextLoading(true);
    Promise.all([
      getOrganization(organizationId, controller.signal),
      getOrganizationProject(organizationId, projectId, controller.signal),
    ])
      .then(([organization, result]) => {
        if (controller.signal.aborted) return;
        setRole(organization.currentUserRole);
        setProject(result);
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // Do not reveal whether an inaccessible project exists.
        setContextError(failure instanceof ApiError && failure.statusCode === 404
          ? "Project not found."
          : getApiErrorMessage(failure, "Failed to load project."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setContextLoading(false);
      });
    return () => controller.abort();
  }, [organizationId, projectId, contextAttempt]);

  useEffect(() => {
    if (!canManage) {
      setKeys(null);
      return;
    }
    const controller = new AbortController();
    setListError(null);
    setListLoading(true);
    listProjectApiKeys(organizationId, projectId, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setKeys(result);
      })
      .catch(failure => {
        if (controller.signal.aborted || isAbortError(failure)) return;
        // A failure is never turned into an empty list.
        setListError(getApiErrorMessage(failure, "Failed to load API keys."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setListLoading(false);
      });
    return () => controller.abort();
  }, [canManage, organizationId, projectId, listAttempt]);

  if (contextLoading) return <p>Loading…</p>;

  if (contextError || !project || !role) {
    return (
      <section>
        <p role="alert">{contextError ?? "Project not found."}</p>
        {contextError !== "Project not found." && (
          <Button type="button" onClick={() => setContextAttempt(n => n + 1)}>Retry</Button>
        )}
        <p><Link to={"/organizations/" + encodeURIComponent(organizationId) + "/projects"}>
          Back to projects
        </Link></p>
      </section>
    );
  }

  if (project.archivedAt !== null) {
    return (
      <section>
        <p role="alert">This project is archived. API keys are not available.</p>
        <p><Link to={projectPath}>Back to project</Link></p>
      </section>
    );
  }

  if (role === "MEMBER") {
    return (
      <section>
        <h1>API keys</h1>
        <p role="alert">You do not have permission to manage API keys for this project.</p>
        <p><Link to={projectPath}>Back to project</Link></p>
      </section>
    );
  }

  return (
    <section>
      <p><Link to={projectPath}>← {project.name}</Link></p>
      <h1>API keys</h1>

      {listLoading && keys === null && <p>Loading API keys…</p>}

      {listError && (
        <div role="alert">
          <p>{listError}</p>
          <Button type="button" onClick={() => setListAttempt(n => n + 1)}>Retry</Button>
        </div>
      )}

      {keys !== null && keys.length === 0 && <p>No API keys yet.</p>}

      {keys !== null && keys.length > 0 && (
        <ul aria-label="API keys">
          {keys.map(apiKey => (
            <li key={apiKey.id}>
              <strong>{apiKey.name}</strong>{" "}
              <code>{apiKey.keyPrefix}…</code>
              <div>Created {formatDate(apiKey.createdAt)}</div>
              <div>
                {apiKey.lastUsedAt ? "Last used " + formatDate(apiKey.lastUsedAt) : "No recorded use."}
              </div>
              <div>{apiKey.revokedAt ? "Revoked " + formatDate(apiKey.revokedAt) : "Active"}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}