# Review — TSE-81 Dashboard assistant frontend

Branch: `feature/tse-81-assistant-frontend` (commit `e5789a0`)

Good work on the parser, the error handling and the Stop logic. The request
and the events match the TSE-80 backend. Before merging, please fix these
4 points.

---

## 1. Merge conflict in `http-client.ts`

📍 `frontend/src/api/http-client.ts:18-19` and `:128-223`

This branch started from an old `develop`. Since then, `develop` already got
the same code (`apiPostStream`, `ApiStreamResponse`, `parseRetryAfter`,
`retryAfterSeconds`). Merging gives one conflict:

```ts
export class ApiError extends Error {
	constructor(
		...
		public readonly retryAfterSeconds?: number,
	) {
```

It also silently creates **duplicates**, which break the build:

```ts
export interface ApiStreamResponse { ... }   // twice
function parseRetryAfter(...) { ... }        // twice
export async function apiPostStream(...) {}  // twice
```

**Fix:** rebase on `develop` and delete your lines 18-19 and 128-223. The
`develop` version works the same way, so `assistant.api.ts` doesn't change.

---

## 2. `provider` / `model` not lowercased, so good answers are rejected

📍 `frontend/src/api/assistant.api.ts:51-54` and `:163-166`

The backend turns `"OpenAI"` into `"openai"`. The frontend keeps `"OpenAI"`,
then compares them exactly:

```ts
// assistant.api.ts:165
if (returned[key] !== expected.filters[key]) throw mismatch();
// "openai" !== "OpenAI"  ->  "invalid response" for a correct answer
```

**Fix:** lowercase them, like the backend:

```ts
const provider = cleanText(filters.provider)?.toLowerCase();
const model = cleanText(filters.model)?.toLowerCase();
```

Keep `workflow` as it is: it is case-sensitive.

---

## 3. Two test files crash in Docker

📍 `frontend/test/api/helpers/fixtures.ts:10`

```ts
readFileSync(resolve(here, '../../../../fixtures/evaluation/assistant', name))
```

The frontend container only has the `frontend/` folder, so this path does
not exist:

```
ENOENT: no such file or directory, open '/fixtures/evaluation/assistant/success.sse'
```

Crashing files:
- `frontend/test/api/assistant-fixtures.test.ts`
- `frontend/test/pages/projects/assistantContextView.test.ts`

**Fix:** copy the fixtures into `frontend/test/fixtures/` and point line 10
there.

---

## 4. The panel is never shown, and it has no tests

📍 `frontend/src/pages/projects/DashboardAssistant.tsx`

- No file imports `DashboardAssistant`, so the panel does not appear in the
  app. Mount it in the project dashboard, with the dashboard's applied dates
  and filters.
- `ask()`, `stop()` and `close()` (lines 140-227) have no tests. Add
  `frontend/test/pages/projects/DashboardAssistant.test.tsx`, starting with:
  - double click sends one request
  - Stop works

---

## Test results

- `npm run check`: ✅ passes
- `npm run test`: ❌ 2 files crash (point 3); the other 6 new test files pass
