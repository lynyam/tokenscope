# Frontend Trace Explorer (read-only)

Screens: `/organizations/:organizationId/projects/:projectId/traces` (list) and
`.../traces/:traceId` (detail). Both are protected routes. Nothing here edits a trace.

## Files

| File | Role |
|---|---|
| `frontend/src/types/trace.types.ts` | Browser contract: `Trace`, `TracePage`, `TraceFilters`, `TraceListQuery` |
| `frontend/src/api/trace-filters.ts` | The one shared filter utility (parse, validate, serialize) |
| `frontend/src/api/traces.api.ts` | The only network boundary: `listTraces`, `getTrace`, `getModelChoices` |
| `frontend/src/api/trace-format.ts` | Display helpers (UTC time, cost text) |
| `frontend/src/pages/projects/TracesPage.tsx` | List, URL state, request lifecycle |
| `frontend/src/pages/projects/TraceDetailPage.tsx` | Detail |

## Contract

- `GET /api/v1/organizations/:org/projects/:project/traces` returns `TracePage` directly
  (`items`, `page`, `pageSize`, `total`, `totalPages`).
- `GET .../traces/:traceId` returns one `Trace`.
- Costs (`inputCostUsd`, `outputCostUsd`, `estimatedCostUsd`, 12 decimals) and rates
  (`pricing.*UsdPerMillion`, 6 decimals) are strings. They are never parsed into numbers or recomputed.
  The list shortens a cost for display by trimming trailing zeros (minimum two decimals; a small positive
  cost is never shown as `$0.00`). The detail page shows the recorded strings unchanged.
- The adapter validates the response shape; a malformed 200 becomes `INVALID_API_RESPONSE`.
- Provider and model choices come from `GET /api/v1/model-prices`, deduplicated.
  A catalogue failure shows a Retry link and never turns into an empty result.

## Shared filters (hand-off for the dashboard and the assistant)

`TraceFilters = { from, to, q?, provider?, model?, workflow?, status? }`. Sorting and pagination are
**not** part of it: a dashboard or assistant request describes a selection, not a table view.

```ts
import { commonFilters, parseTraceSearchParams, serializeTraceQuery } from "@/api/trace-filters";
const parsed = parseTraceSearchParams(new URLSearchParams(location.search));
if (parsed.ok) { const filters = commonFilters(parsed.query); /* from, to, q, provider, model, workflow, status */ }
```

Rules (identical to the backend):

- `from`/`to`: UTC ISO instants ending in `Z`, `from < to`, at most 90 days. Both or none.
  With none, the last 7 days are resolved **once** to explicit dates and the URL is replaced.
- `q`: trimmed, at most 100 characters, empty omitted. `provider`: lowercase `[a-z0-9][a-z0-9._-]*`, ≤ 40.
  `model`: lowercase `[a-z0-9][a-z0-9._:/-]*`, ≤ 100. `workflow`: trimmed, case-sensitive, ≤ 80. `status`: `SUCCESS` or `ERROR`.
- Table view only: `sortBy` (`occurredAt` default, `estimatedCostUsd`, `latencyMs`, `inputTokens`, `outputTokens`),
  `sortOrder` (`desc` default), `page` (default 1), `pageSize` (25 default, 50, 100).
- Unknown, repeated or malformed parameters are rejected with a visible message and a Reset button.
  `parse(serialize(q))` returns `q`.

## Behaviour

- The URL holds the applied query: reload, Back/Forward and copied links reproduce the screen.
- Search and workflow are debounced (300 ms) and **replace** the URL entry; selects, sorting, paging and
  Apply push one entry. Changing any filter, sort or page size returns to page 1. Custom dates apply on "Apply period".
- Changing the provider clears the model. Reset restores the defaults (a fresh 7-day period).
- Each request is aborted when superseded and guarded by a generation counter. The screen is keyed by
  organization and project, so another project's answer can never be shown.
- A refresh of the same query keeps the rows and shows "Updating…". A changed query hides old rows.
- A page beyond `totalPages` is replaced once by `Math.max(1, totalPages)`.
- Errors: empty result ≠ failure; 400 shows the server message; 401 uses the shared session invalidation;
  404 `PROJECT_NOT_FOUND`/`ORGANIZATION_NOT_FOUND` (and archiving the project in this tab) show an unavailable state;
  404 `TRACE_NOT_FOUND` affects only the detail; 429 disables Retry for the server's `Retry-After` (10 s when the header is absent or unusable), with a visible countdown and no automatic retry;
  network/server errors offer Retry.
- The detail page shows metadata as escaped text and labels synthetic pricing. Its return link keeps the list query;
  a direct visit returns to the default list.

## Known limitations

- Realtime refresh: pending integration. The shared realtime hook from the realtime ticket does not exist yet;
  no WebSocket client is created here.
- Archiving the project from another browser is detected on the next request (404), not live.
