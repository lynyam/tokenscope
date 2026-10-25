import { parseTraceSearchParams } from "../../api/trace-filters";
import type { AppliedSelection, DashboardFilters } from "../../types/analytics.types";
import type { DashboardPeriod } from "./dashboardPeriod";

/** What the user typed or picked in the filter controls, before it is validated. */
export interface FilterDraft {
  q: string;
  provider: string;
  model: string;
  workflow: string;
  status: string;
}

export const EMPTY_FILTER_DRAFT: FilterDraft = { q: "", provider: "", model: "", workflow: "", status: "" };

export type SelectionResult =
  | { ok: true; selection: AppliedSelection }
  | { ok: false; errors: string[] };

/**
 * Turns the period and the draft filters into THE applied selection.
 * Validation and normalization are the ones of the Trace Explorer (shared module): an invalid
 * value is reported, never replaced by a default, and no request is made for it.
 */
export function buildAppliedSelection(
  organizationId: string,
  projectId: string,
  period: DashboardPeriod,
  draft: FilterDraft,
): SelectionResult {
  const params = new URLSearchParams({ from: period.from, to: period.to });
  // Empty controls mean "no filter". Anything else goes through the shared validation.
  if (draft.q.trim() !== "") params.set("q", draft.q);
  if (draft.provider !== "") params.set("provider", draft.provider);
  if (draft.model !== "") params.set("model", draft.model);
  if (draft.workflow.trim() !== "") params.set("workflow", draft.workflow);
  if (draft.status !== "") params.set("status", draft.status);

  const parsed = parseTraceSearchParams(params);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { q, provider, model, workflow, status } = parsed.query;
  const filters: DashboardFilters = {};
  if (q !== undefined) filters.q = q;
  if (provider !== undefined) filters.provider = provider;
  if (model !== undefined) filters.model = model;
  if (workflow !== undefined) filters.workflow = workflow;
  if (status !== undefined) filters.status = status;

  return {
    ok: true,
    selection: { organizationId, projectId, from: parsed.query.from, to: parsed.query.to, filters },
  };
}
