import type {
  TraceFilters,
  TraceListQuery,
  TraceSortField,
  TraceSortOrder,
  TraceStatus,
} from "../types/trace.types";

/**
 * The one place that normalizes, validates and serializes trace filters.
 * The Trace Explorer URL, the API request and (later) the dashboard share it.
 * Backend rules (TSE-69): from <= occurredAt < to, at most 90 days, filters combine with AND.
 */

export const TRACE_PAGE_SIZES = [25, 50, 100] as const;
export const TRACE_SORT_FIELDS: readonly TraceSortField[] = [
  "occurredAt", "estimatedCostUsd", "latencyMs", "inputTokens", "outputTokens",
];
export const DEFAULT_SORT_BY: TraceSortField = "occurredAt";
export const DEFAULT_SORT_ORDER: TraceSortOrder = "desc";
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PERIOD_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;
const FILTER_KEYS = ["from", "to", "q", "provider", "model", "workflow", "status"] as const;
const QUERY_KEYS = [...FILTER_KEYS, "sortBy", "sortOrder", "page", "pageSize"] as const;

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PROVIDER = /^[a-z0-9][a-z0-9._-]*$/;
const MODEL = /^[a-z0-9][a-z0-9._:/-]*$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

export const LIMITS = { q: 100, provider: 40, model: 100, workflow: 80 } as const;

/** Parses a UTC ISO instant ending in Z; returns epoch milliseconds or null. */
export function parseUtcInstant(value: string): number | null {
  if (!INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  // Reject impossible dates that some engines roll over (for example February 31).
  return new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19) ? ms : null;
}

export function formatUtcInstant(ms: number): string {
  return new Date(ms).toISOString();
}

/** The default period, resolved once to explicit dates: the last seven days ending now. */
export function defaultPeriod(now: Date = new Date()): { from: string; to: string } {
  return {
    from: formatUtcInstant(now.getTime() - 7 * DAY_MS),
    to: formatUtcInstant(now.getTime()),
  };
}

export function defaultTraceQuery(now: Date = new Date()): TraceListQuery {
  return {
    ...defaultPeriod(now),
    sortBy: DEFAULT_SORT_BY,
    sortOrder: DEFAULT_SORT_ORDER,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

/** Returns a message when the period is unusable, otherwise null. Both values must be explicit instants. */
export function validatePeriod(from: string, to: string): string | null {
  const start = parseUtcInstant(from);
  const end = parseUtcInstant(to);
  if (start === null || end === null) return "Enter both dates as UTC instants.";
  if (start >= end) return "The end of the period must be after its start.";
  if (end - start > MAX_PERIOD_DAYS * DAY_MS) return `The period must not exceed ${MAX_PERIOD_DAYS} days.`;
  return null;
}

/** Only the shared filters, without sorting or pagination. */
export function commonFilters(query: TraceListQuery | TraceFilters): TraceFilters {
  const filters: TraceFilters = { from: query.from, to: query.to };
  if (query.q !== undefined) filters.q = query.q;
  if (query.provider !== undefined) filters.provider = query.provider;
  if (query.model !== undefined) filters.model = query.model;
  if (query.workflow !== undefined) filters.workflow = query.workflow;
  if (query.status !== undefined) filters.status = query.status;
  return filters;
}

function codePoints(value: string): number {
  return [...value].length;
}

export type TraceQueryParse =
  | { ok: true; query: TraceListQuery; canonicalSearch: string }
  | { ok: false; errors: string[] };

/**
 * Reads the applied query from URL search parameters. Unsupported, repeated or malformed values are
 * reported, never silently replaced by defaults. When both dates are absent, the default period is
 * resolved here once; callers replace the URL with `canonicalSearch`.
 */
export function parseTraceSearchParams(params: URLSearchParams, now: Date = new Date()): TraceQueryParse {
  const errors: string[] = [];

  for (const key of new Set(params.keys())) {
    if (!(QUERY_KEYS as readonly string[]).includes(key)) errors.push(`Unsupported parameter "${key.slice(0, 40)}".`);
    else if (params.getAll(key).length > 1) errors.push(`Parameter "${key}" is repeated.`);
  }
  const value = (key: (typeof QUERY_KEYS)[number]): string | undefined => params.get(key) ?? undefined;

  const rawFrom = value("from");
  const rawTo = value("to");
  let from: string;
  let to: string;
  if (rawFrom === undefined && rawTo === undefined) {
    ({ from, to } = defaultPeriod(now));
  } else if (rawFrom === undefined || rawTo === undefined) {
    errors.push("Supply both the start and the end of the period.");
    from = to = "";
  } else {
    from = rawFrom.trim();
    to = rawTo.trim();
    if (parseUtcInstant(from) === null) errors.push("The start must be a UTC instant such as 2026-10-01T00:00:00.000Z.");
    else if (parseUtcInstant(to) === null) errors.push("The end must be a UTC instant such as 2026-10-02T00:00:00.000Z.");
    else {
      const periodError = validatePeriod(from, to);
      if (periodError) errors.push(periodError);
    }
    if (parseUtcInstant(from) !== null) from = formatUtcInstant(parseUtcInstant(from)!);
    if (parseUtcInstant(to) !== null) to = formatUtcInstant(parseUtcInstant(to)!);
  }

  const filters: TraceFilters = { from, to };

  const q = value("q")?.trim();
  if (q !== undefined && q !== "") {
    if (codePoints(q) > LIMITS.q) errors.push(`The search must contain at most ${LIMITS.q} characters.`);
    else if (q.includes("\u0000")) errors.push("The search contains an unsupported character.");
    else filters.q = q;
  }

  const provider = value("provider")?.trim().toLowerCase();
  if (provider !== undefined) {
    if (provider.length > LIMITS.provider || !PROVIDER.test(provider)) errors.push("The provider is not a valid identifier.");
    else filters.provider = provider;
  }

  const model = value("model")?.trim().toLowerCase();
  if (model !== undefined) {
    if (model.length > LIMITS.model || !MODEL.test(model)) errors.push("The model is not a valid identifier.");
    else filters.model = model;
  }

  const workflow = value("workflow")?.trim();
  if (workflow !== undefined) {
    if (workflow === "" || codePoints(workflow) > LIMITS.workflow || CONTROL.test(workflow)) {
      errors.push(`The workflow must contain 1–${LIMITS.workflow} characters without control characters.`);
    } else filters.workflow = workflow;
  }

  const status = value("status");
  if (status !== undefined) {
    if (status !== "SUCCESS" && status !== "ERROR") errors.push("The status must be SUCCESS or ERROR.");
    else filters.status = status as TraceStatus;
  }

  const sortBy = value("sortBy") ?? DEFAULT_SORT_BY;
  if (!TRACE_SORT_FIELDS.includes(sortBy as TraceSortField)) errors.push("Unsupported sort field.");

  const sortOrder = value("sortOrder") ?? DEFAULT_SORT_ORDER;
  if (sortOrder !== "asc" && sortOrder !== "desc") errors.push("The sort order must be asc or desc.");

  let page = 1;
  const rawPage = value("page");
  if (rawPage !== undefined) {
    const parsed = Number(rawPage);
    if (!POSITIVE_INTEGER.test(rawPage) || !Number.isSafeInteger(parsed)) errors.push("The page must be a positive integer.");
    else page = parsed;
  }

  let pageSize = DEFAULT_PAGE_SIZE;
  const rawPageSize = value("pageSize");
  if (rawPageSize !== undefined) {
    const parsed = Number(rawPageSize);
    if (!(TRACE_PAGE_SIZES as readonly number[]).includes(parsed) || !POSITIVE_INTEGER.test(rawPageSize)) {
      errors.push("The page size must be 25, 50 or 100.");
    } else pageSize = parsed;
  }

  if (errors.length > 0) return { ok: false, errors };

  const query: TraceListQuery = {
    ...filters,
    sortBy: sortBy as TraceSortField,
    sortOrder: sortOrder as TraceSortOrder,
    page,
    pageSize,
  };
  return { ok: true, query, canonicalSearch: serializeTraceQuery(query).toString() };
}

/**
 * URL form of a query: explicit dates, only active filters, and only non-default sorting/pagination.
 * Always built through URLSearchParams so user text can never inject another parameter.
 */
export function serializeTraceQuery(query: TraceListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.q) params.set("q", query.q);
  if (query.provider) params.set("provider", query.provider);
  if (query.model) params.set("model", query.model);
  if (query.workflow) params.set("workflow", query.workflow);
  if (query.status) params.set("status", query.status);
  if (query.sortBy !== DEFAULT_SORT_BY) params.set("sortBy", query.sortBy);
  if (query.sortOrder !== DEFAULT_SORT_ORDER) params.set("sortOrder", query.sortOrder);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  return params;
}

/** The backend request: every applied value is explicit, so server defaults can never differ from the screen. */
export function traceQueryToApiParams(query: TraceListQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", query.from);
  params.set("to", query.to);
  if (query.q) params.set("q", query.q);
  if (query.provider) params.set("provider", query.provider);
  if (query.model) params.set("model", query.model);
  if (query.workflow) params.set("workflow", query.workflow);
  if (query.status) params.set("status", query.status);
  params.set("sortBy", query.sortBy);
  params.set("sortOrder", query.sortOrder);
  params.set("page", String(query.page));
  params.set("pageSize", String(query.pageSize));
  return params;
}
