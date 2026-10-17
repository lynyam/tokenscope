# TokenScope Public Trace API

Interactive documentation: `/api/v1/public/docs`

OpenAPI specification: `/api/v1/public/openapi.json`

The generated repository copy is `docs/openapi/public-api.json`.
Edit `backend/scripts/generate-public-api.cjs`, then run
`npm run docs:generate` from `backend`; do not edit generated JSON directly.

## Authentication

Create a project API key through the authenticated workspace API:

POST /api/v1/organizations/:organizationId/projects/:projectId/api-keys

Only an authorized OWNER or ADMIN can manage project keys.
The plaintext key is returned once.

Keep the key in the integrating application's backend environment.
Never place it in frontend source, browser storage, logs or Git.

Public trace requests require:

X-API-Key: <project-key>

The verified key determines the project. A user JWT alone cannot authorize
public trace operations.

## Local evaluation setup

Use the existing application startup and price-catalogue loading instructions
in LOCAL_DEVELOPMENT.md.

The examples below use synthetic fixture pricing. Load the canonical evaluation
catalogue first. These values demonstrate estimated costs, not provider billing.

Set BASE to your application origin. For example:

```bash
export BASE="https://localhost:8443"
read -s API_KEY
export API_KEY
```

Use the trusted evaluation certificate. Do not disable TLS verification.

## Create

Create trace.json:

```json
{
  "externalId": "public-demo-001",
  "provider": "fixture-a",
  "model": "demo-fast",
  "workflow": "support",
  "inputTokens": 1000,
  "outputTokens": 200,
  "latencyMs": 500,
  "status": "SUCCESS",
  "occurredAt": "2026-10-01T10:00:00.000Z",
  "metadata": {}
}
```

```bash
curl -i "$BASE/api/v1/public/traces" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @trace.json
```

Creation returns 201. An identical normalized replay returns 200 without
repricing or changing timestamps.

A different payload under the same externalId returns
409 TRACE_EXTERNAL_ID_CONFLICT.

Copy the returned trace ID into TRACE_ID:

```bash
export TRACE_ID="<returned-id>"
```

## List and search

Use explicit fixture dates:

```bash
curl --get "$BASE/api/v1/public/traces" \
  -H "X-API-Key: $API_KEY" \
  --data-urlencode "from=2026-10-01T00:00:00.000Z" \
  --data-urlencode "to=2026-10-02T00:00:00.000Z" \
  --data-urlencode "q=support" \
  --data-urlencode "page=1" \
  --data-urlencode "pageSize=25" \
  --data-urlencode "sortBy=occurredAt" \
  --data-urlencode "sortOrder=desc"
```

Both dates or neither are required. The default is the last seven days.
The maximum interval is 90 days.

Time matching is inclusive at from and exclusive at to.

Search is a case-insensitive literal substring over workflow, externalId and
model. Other filters are exact provider, model, workflow and status.
Workflow is case-sensitive.

Sorting supports occurredAt, estimatedCostUsd, latencyMs, inputTokens and
outputTokens. Ties use id ascending.

Pagination defaults to page 1 and size 25; maximum size is 100.
Unknown, repeated or incorrectly typed parameters are rejected.

Count and page rows share one read snapshot. Separate page requests remain live.

## Read and capture the version

```bash
curl -i "$BASE/api/v1/public/traces/$TRACE_ID" \
  -H "X-API-Key: $API_KEY"
```

The response includes an ETag such as:

ETag: "1"

Detail lookup does not apply the list's default seven-day window.

## Correct

Edit trace.json, retaining the same externalId and all required fields.

```bash
curl -i -X PUT "$BASE/api/v1/public/traces/$TRACE_ID" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "1"' \
  --data-binary @trace.json
```

PUT replaces all writable content. Omitted metadata becomes {}.

A current-version no-op preserves version, timestamps, prices and costs.
A changed replacement recalculates historical pricing using occurredAt,
updates the payload hash and increments version atomically.

Missing If-Match returns 428 TRACE_VERSION_REQUIRED.
Malformed If-Match returns 400 VALIDATION_ERROR.
A stale version returns 412 TRACE_VERSION_CONFLICT, even for identical content.

After a conflict, read the trace and reconsider the intended change.
Do not automatically fetch a newer version and overwrite it.

## Delete

Use the current ETag:

```bash
curl -i -X DELETE "$BASE/api/v1/public/traces/$TRACE_ID" \
  -H "X-API-Key: $API_KEY" \
  -H 'If-Match: "2"'
```

Success returns 204 without a body.

Deletion retains the database row and reserves externalId.
Subsequent GET/DELETE returns 404 TRACE_NOT_FOUND.
POST using that identity returns 409 TRACE_DELETED.
There is no restoration endpoint.

## Exact values and safe errors

Rates are six-decimal strings. Costs are twelve-decimal strings.
Reads return stored historical values and do not recalculate current pricing.

Errors use statusCode, code, error, message and requestId, with optional
validation details. Preserve requestId when reporting a failure.

A missing, invalid or revoked key, or a key under an archived parent,
returns 401 INVALID_API_KEY.

A valid key requesting another project's trace receives 404 TRACE_NOT_FOUND.

Transaction conflict exhaustion returns 409 CONCURRENT_MODIFICATION.
Version integer exhaustion returns 409 TRACE_VERSION_EXHAUSTED.

## Limits

All five trace operations share:

- 60 requests per minute per client IP before authentication.
- 120 requests per minute per verified key.

429 RATE_LIMITED includes Retry-After in seconds.

POST and PUT require application/json and permit at most 16384 actual body bytes.
Metadata is a flat object with at most 20 keys and 4096 UTF-8 bytes.

## Verification

From backend:

```bash
npm run docs:generate
npm run docs:check
```

From the repository root:

```bash
make test-backend
```

Verify Swagger UI and all five operations through evaluation HTTPS.
The documentation UI sends real requests; use a disposable project and key.