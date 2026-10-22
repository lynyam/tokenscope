# Evaluation fixtures

These files define synthetic test inputs and expected responses.
They do not seed the application automatically and do not prove that
the corresponding feature endpoints are implemented.

Source: the fixture attachment on TSE-63.
Assistant examples are aligned with the dashboard contract in TSE-80.

## Fixed time scope

Golden window:

- From: 2026-10-01T00:00:00.000Z, inclusive.
- To: 2026-10-02T00:00:00.000Z, exclusive.
- Fixed test clock: 2026-10-02T08:00:00.000Z.

Use these explicit dates in tests. Do not depend on a moving
"last seven days" preset including historical fixture records.

## Contents and consumers

| Files | Purpose | Consumers |
|---|---|---|
| identities.json | Tenant, user, membership and project references | TSE-70 and isolation tests |
| model-prices.json | Synthetic historical price versions | TSE-68, TSE-70, TSE-71 |
| traces-golden.json | Six trace request bodies with seed metadata | TSE-68, TSE-70, TSE-71 |
| traces-pagination.json | 51 rows in a separate project | TSE-69, TSE-75 |
| traces-isolation.json | Cross-tenant and archived-project examples | Authorization tests |
| responses/ | Expected HTTP responses | Backend/frontend contract tests |
| expected-results.json | Independent expected analytics | TSE-70, TSE-71 |
| requests/ | Invalid and replacement trace inputs | TSE-68, TSE-69 |
| realtime/ | A trace insertion used in refresh demonstrations | TSE-73, TSE-76 |
| uploads/ and uploads-manifest.json | File samples, sizes and hashes | TSE-78, TSE-79 |
| assistant/ | Dashboard request, context and SSE transcripts | TSE-80, TSE-81 |

Wrapper IDs in trace input files are seed metadata.
Only each wrapper's `body` is an HTTP trace request.

## Golden totals

- Trace count: 6
- Input tokens: "6000"
- Output tokens: "1200"
- Total tokens: "7200"
- Estimated cost: "0.015350000000"
- Error count: 2
- Error rate: 33.33
- Average latency: 1833.333

Prices and provider/model labels are synthetic.

## Security and lifecycle

No usable password, JWT, provider credential or plaintext project
API key belongs in these files.

TSE-70 owns repeatable database loading and password hashing.

Organization/project archive retains child records and private files.
Individual trace deletion retains its external-ID reservation.
Individual document deletion removes metadata and schedules cleanup.

## Assistant examples

The request sends a question, explicit dates and filters.
It does not send a trace ID or client-calculated analytics.

The context comes from the canonical analytics example.
SSE output is deterministic test data, not live-provider evidence.
The fixture model label is not a deployable Gemini model name.

| File | Shows |
|---|---|
| request.json | Golden window, no filters |
| request-filtered.json | Golden window with provider + status filters |
| context.json | The `start.context` for request.json |
| success.sse | start, two deltas (Unicode), done/stop |
| length.sse | Output-limit completion (done/length) |
| refusal.sse | Provider accepted the request, then refused (start + error) |
| partial-timeout.sse | Partial answer, then LLM_TIMEOUT |
| unexpected-eof.sse | Connection cut: no terminal event |
| chunk-boundaries.json | Byte offsets for split-frame and UTF-8 decoding tests |

The backend test `test/assistant/assistant-fixtures.unit.spec.ts` regenerates
every `.sse` file with the fake provider and checks it byte for byte.

## Verification

The backend fixture unit test checks golden arithmetic, upload
checksums and the dashboard assistant context.

Passing these tests does not prove live ingestion, analytics,
uploads, realtime or Gemini integration.

## Dashboard CSV example (TSE-77 / C06)

`responses/dashboard-golden.csv` exports `responses/analytics-golden.json`
with the authorized fixture project name `Support Golden`. It contains the
canonical 24-column header, one summary, 24 hourly buckets (including zeroes)
and two model rows. UTF-8 and CRLF record separators are deliberate.
The frontend tests compare this file byte for byte and independently check
its parsed columns, rows, exact decimal strings and formula escaping.
