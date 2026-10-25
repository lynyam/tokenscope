import { normalizeFilters } from "./assistant.api";
import type { AssistantFilters } from "../types/assistant.types";

export type AssistantScope = {
  organizationId: string;
  projectId: string;
  from: string;
  to: string;
  filters: AssistantFilters;
};

// Same instant written differently ("...00Z" vs "...00.000Z") gives the same text.
function canonicalInstant(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

// Identity of what the assistant is talking about.
// Built ONLY from ids, exact dates and normalized filters:
// never from object identity or from a dashboard snapshotId.
export function assistantScopeKey(scope: AssistantScope): string {
  const filters = normalizeFilters(scope.filters);
  return JSON.stringify([
    scope.organizationId,
    scope.projectId,
    canonicalInstant(scope.from),
    canonicalInstant(scope.to),
    // Fixed key order, so the order the filters were set in does not matter.
    filters.q ?? null,
    filters.provider ?? null,
    filters.model ?? null,
    filters.workflow ?? null,
    filters.status ?? null,
  ]);
}