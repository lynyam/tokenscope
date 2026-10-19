# Project analytics dashboard — TSE-76

Route: `/organizations/:organizationId/projects/:projectId/dashboard`
(link "Dashboard" in the project page navigation). Read-only. All times are UTC.
Costs are estimates, not provider invoices.

## What it shows

- Summary cards: estimated cost, trace count, input tokens, output tokens, average latency,
  error rate and the snapshot `generatedAt`.
  A missing average latency or error rate (`null`) reads **No observations**. It is never shown as 0.
- Charts, each with a keyboard-accessible "Show data table" of exact values:
  cost over time (line), cost by provider/model (bar), input/output tokens by provider/model (bar).
  Legend items are buttons (`aria-pressed`) that hide/show a series.
  With no traces in the selection the charts are not drawn: the cards read "No observations"
  and the page says "No traces match this period and these filters."
- Cost and token values stay decimal strings end to end. Only the drawing uses numbers; tooltips and
  tables print the original text. Text from the API is rendered as text, never as HTML.

## Applied selection (the one selection object)

`AppliedSelection` (`src/types/analytics.types.ts`):
organization ID, project ID, explicit UTC `from`/`to`, normalized filters.
The analytics request, the assistant (TSE-81) and the export (TSE-77) all start from it.

- Presets (last 24 hours / 7 days / 30 days) resolve to exact UTC dates when picked.
  The period does not slide afterwards. Picking a preset again resolves a new period.
- A custom UTC period applies only with the explicit "Apply period" action.
- Validation and normalization are the Trace Explorer's shared rules (`src/api/trace-filters.ts`):
  UTC instants, `from < to`, at most 90 days, filter lengths and identifiers.
  An invalid selection shows a message and sends **no request**; the previously applied
  selection and its figures stay as they were. Nothing is replaced by a silent default.
- Filters: search, workflow, status, provider, model. Changing the provider clears the model.
  Reset returns to the default (last 7 days, no filters). Refresh reads the same selection again.

## Three different things

| Action | Effect |
|---|---|
| Change the selection (project, dates, filters) | Abort the previous request, clear the figures, load the new selection. The assistant answer is stopped and cleared. Export stays disabled until a snapshot of the new selection is confirmed. |
| Refresh the same selection (button, notification, focus, timer, reconnection) | Keep the confirmed snapshot visible, replace cards, charts and tables together when the new one arrives. The assistant is untouched. |
| New assistant context | Only when the user submits a question. The server builds its own fixed context and timestamp. Dashboard events never trigger an LLM request. |

## Loading states (`useProjectAnalytics`)

| Status | Meaning |
|---|---|
| `loading` | First load of this selection, no figures yet |
| `ready` | Confirmed snapshot of this selection |
| `updating` | Confirmed snapshot still shown while a refresh runs |
| `stale` | Confirmed snapshot still shown, the last refresh failed (message + Retry) |
| `error` | The first load failed: no figures, never shown as an empty state |
| `unavailable` | Project no longer available (404 / access revoked): protected content cleared |

Stale-response protection: state is keyed by the applied selection. Figures of another
selection are never shown; a late response of an aborted request is ignored; the response must
match the requested project, window and filters (`ANALYTICS_SELECTION_MISMATCH` otherwise).

## Refresh scheduling (`src/lib/refresh-scheduler.ts`)

One scheduler per selection. Triggers: initial load, realtime subscription/reconnection,
matching `traces.changed`, visible focus, every 30 s while the tab is visible and the browser online,
explicit Refresh/Retry, browser back online.

- Bursts are coalesced (about 250 ms) but bounded (1 s maximum wait).
- At most one request at a time; a trigger during a request causes at most one follow-up.
- A 429 sets a cooldown from `Retry-After` that every automatic trigger respects (Retry is disabled meanwhile).
- After a failure nothing retries by itself: no request loop.
- Cleanup on selection change, project change and unmount.

## Realtime (`src/api/realtime-client.ts`, contract C07)

Same-origin Socket.IO, namespace `/realtime`, path `/socket.io`, handshake `{ token }`.

- One shared connection per project (no socket per component). Socket.IO reconnection with
  bounded exponential backoff and jitter (1 s to 30 s).
- States: connecting, **live only after the subscription acknowledgement**, reconnecting, offline, unavailable.
- Subscribe after every connection. After every acknowledgement, read analytics again (no replay).
- `traces.changed` of another project is ignored. The event carries no figures; the dashboard never
  computes totals from it.
- `access.revoked` or `PROJECT_NOT_FOUND`: project unavailable, protected content cleared,
  subscription stopped, **login kept**.
- Invalid/expired token: invalidate only the captured session. A transport failure alone never does.
- Local development needs `REALTIME_ALLOWED_ORIGINS` to contain the exact browser origin
  (`http://localhost:5173`, not `127.0.0.1`) and the `/socket.io` proxy (Vite and Caddy).

## Handoff to the assistant (TSE-81) and export (TSE-77)

`ProjectDashboard` accepts `renderExtras(handoff)` with:
`selection` (the applied selection), `snapshot` (always of that selection or null), `status`,
`selectionState` (`loading | ready | empty | error | invalid`, from `toAssistantSelectionState`),
`exportEnabled` (true only when the displayed snapshot belongs to the current selection and access is valid).

- A real change of project, dates or filters stops and clears the assistant answer.
- Same-selection refreshes do not stop, clear or restart it.
- Dashboard events never start an assistant request.
- TSE-81 provisional `AssistantSelection`/`AssistantFilters` should be aligned to
  `AppliedSelection`/`DashboardFilters` when both branches are on `develop`.

## Known behaviour to be aware of

Because the period is exact and does not slide, a trace dated **after** the period's `to`
(for example one ingested "now" after a preset was picked) is not in that period until the
period is picked again. Realtime refreshes keep the same dates. Late-arriving, corrected or
deleted traces inside the period do update the figures.

## Demo runbook

1. Load the synthetic price catalogue (LOCAL_DEVELOPMENT.md, "Explicit price catalogue loading").
2. Create a disposable organization and project, add a second user as MEMBER, create a project API key.
3. Ingest `fixtures/evaluation/traces-golden.json` bodies through `POST /api/v1/public/traces`.
4. Open the dashboard, apply the custom period `2026-10-01 00:00` to `2026-10-02 00:00` (UTC).
   Expected: cost `$0.01535`, 6 traces, 6,000 input / 1,200 output tokens, average latency 1.83 s,
   error rate 33.33 %. Filter provider `fixture-a`: 3 traces, `$0.00715`.
5. Open the same dashboard as the second user. Both show "Live".
6. Send `fixtures/evaluation/realtime/live-trace-request.json` (fresh `externalId`) with the project key.
   Both dashboards update without reload.
7. Turn the network off and on in one browser: "Offline", figures stay, then it reads again and returns to "Live".
8. Remove the second user from the organization: their dashboard shows "This project is not available."
   and they stay signed in.

## Tests and evidence

| Layer | File |
|---|---|
| API adapter | `frontend/test/api/analytics.api.test.ts` |
| Realtime client | `frontend/test/api/realtime-client.test.ts` |
| Scheduler / period | `frontend/test/lib/refresh-scheduler.test.ts`, `frontend/test/pages/projects/dashboardPeriod.test.ts` |
| Hooks | `frontend/test/hooks/useProjectAnalytics.test.tsx`, `frontend/test/hooks/useProjectRealtime.test.tsx` |
| Components / page | `frontend/test/pages/projects/ProjectDashboard.test.tsx`, `ProjectDashboardPage.test.tsx` |
| Browser (real backend) | `frontend/test/e2e/project-dashboard.spec.ts` |

Commands (from `frontend/`):

```sh
npm run check
npm test
npm run build
E2E_BASE_URL=http://localhost:5173 npm run test:e2e -- project-dashboard.spec.ts
```

Record before the pull request (do not copy results from another machine):

| Item | Value |
|---|---|
| Tested commit | `<git rev-parse HEAD>` |
| `npm run check` | `<result>` |
| `npm test` | `<N files, N tests, result>` |
| `npm run build` | `<result>` |
| E2E `project-dashboard.spec.ts` | `<result and mode>` |
| Layouts checked at 375 / 768 / 1440 px | `<result>` |
