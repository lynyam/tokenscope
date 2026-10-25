import { useEffect, useState } from "react";
import { subscribeToProjectChanges } from "../api/project-events";

/** True once this project is archived from this browser tab. */
export function useProjectArchived(organizationId: string, projectId: string): boolean {
  const [archived, setArchived] = useState(false);
  useEffect(() => {
    setArchived(false);
    return subscribeToProjectChanges(change => {
      if (change.organizationId !== organizationId) return;
      if (change.kind === "archive" && change.projectId === projectId) setArchived(true);
      if (change.kind === "upsert" && change.project.id === projectId && change.project.archivedAt) setArchived(true);
    });
  }, [organizationId, projectId]);
  return archived;
}
