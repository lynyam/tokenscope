# TokenScope external demo

Standalone Chat and Translation workflows powered by Gemini.
Each workflow sends usage traces to a separate TokenScope project through
the same tracing wrapper.

The demo uses TokenScope's public HTTP API. It does not access TokenScope's
database or import its backend code.

## Requirements

- Ubuntu/Linux with Docker and Docker Compose.
- A running TokenScope evaluation stack (`make eval-up`).
- A Gemini API key with access to the configured model.
- Two TokenScope projects, with one active API key for each.
- A price catalogue entry matching the provider and model.

The Docker commands below use Linux host networking. Run them inside the
Ubuntu VM, from the repository root.

## Install dependencies

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -e npm_config_cache=/tmp/npm-cache \
  -v "$PWD/examples/external-demo:/app" \
  -w /app \
  node:24-alpine npm ci
```

## Configure

Create a private configuration file if one does not already exist:

```bash
(
  umask 077
  set -C
  cat examples/external-demo/.env.example > examples/external-demo/.env
)
```

Edit `examples/external-demo/.env` locally:

| Variable | Purpose |
| --- | --- |
| `PORT` | Demo HTTP port; default 8080. |
| `GEMINI_API_KEY` | Gemini credential, used only by the demo server. |
| `LLM_MODEL` | Gemini model ID; the supplied catalogue uses `gemini-3.8-flash`. |
| `TOKENSCOPE_BASE_URL` | TokenScope origin, normally `https://localhost:8443`. |
| `TOKENSCOPE_CHAT_API_KEY` | Key belonging to the Chat project. |
| `TOKENSCOPE_TRANSLATION_API_KEY` | Different key belonging to the Translation project. |

Keep `.env` private and out of Git. Never put keys in browser code,
screenshots, documentation, or trace payloads.

Project association comes from the TokenScope API key. The trace payload
does not specify a project ID.

## Load the price catalogue

After TokenScope's evaluation backend is running:

```bash
docker compose cp \
  examples/external-demo/config/model-prices.json \
  backend:/tmp/external-demo-prices.json

docker compose exec -w /opt/tokenscope/backend backend \
  npm run pricing:load -- --file /tmp/external-demo-prices.json
```

The catalogue records Google's Standard paid text rates, checked on
2026-10-18: USD 0.75 per million input tokens and USD 3.75 per million
output tokens, including thinking tokens.

These are estimated costs, not a statement of the user's actual bill.
Gemini's free tier can make the actual provider charge zero.

Source: https://ai.google.dev/gemini-api/docs/pricing

The configured effective date is the local catalogue activation date,
not a claim about Google's price announcement date.

Google lists these rates through 2026-12-31, with higher rates from
2027-01-01. Verify pricing and add the appropriate new catalogue version
before using this configuration for later requests.

## Start the demo

The evaluation stack exports its local CA certificate to
`.local/eval/caddy-root.crt`. Keep TLS verification enabled.

```bash
docker run --rm --init --network host \
  --user "$(id -u):$(id -g)" \
  -e NODE_EXTRA_CA_CERTS=/certs/caddy-root.crt \
  --mount "type=bind,source=$PWD/.local/eval/caddy-root.crt,target=/certs/caddy-root.crt,readonly" \
  -v "$PWD/examples/external-demo:/app:ro" \
  -w /app \
  node:24-alpine npm start
```

Open http://127.0.0.1:8080 in the VM browser.
Keep the terminal running. Press Ctrl+C there to stop the demo.

The demo listens on loopback. These instructions are for local evaluation.

## Use the workflows

Chat accepts one independent question per submission.
Translation accepts text and a supported target language.

Each submission:
1. Calls Gemini once.
2. Records provider latency and reported token usage.
3. Attempts one trace delivery to `POST /api/v1/public/traces`.
4. Displays the provider result separately from the delivery result.

Inputs must contain 1–2,000 characters after trimming.
Translation supports English, French, and Spanish.

The interface blocks repeated submissions while a workflow is pending.
Submitting again after completion is a new provider call with a new
execution ID, even if the text is identical.

## Usage and delivery behavior

Input tokens come from Gemini's reported prompt count.
Output tokens are the reported total minus the prompt count, including
thinking tokens once. Missing or inconsistent usage is not estimated.

Provider latency excludes trace-delivery time.

Trace payloads contain usage metadata, not prompts, answers, or credentials.
If usable usage or required model information is unavailable, trace
delivery is skipped.

A delivery failure does not discard a successful Gemini answer.
There are no automatic provider or delivery retries.

For manual replay, copy the exact displayed trace payload and submit it
using the same project's API key. Replaying an existing identical trace
returns HTTP 200. A newly created trace returns HTTP 201.

Manual replay resends usage data; it does not call Gemini again.
Keep the original externalId and all payload fields unchanged.

## Tests

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD/examples/external-demo:/app" \
  -w /app \
  node:24-alpine npm test
```

The test script enables Node VM modules for Jest and jsdom compatibility.
Node may print an experimental VM Modules warning.

See [manual verification](MANUAL_TESTS.md) for live results and remaining
checks. Automated tests alone do not prove live provider or API behavior.

## Troubleshooting

- Browser cannot connect: check that the demo terminal is still running
  and that the browser is inside the VM.
- TLS failure: check the exported CA file and `NODE_EXTRA_CA_CERTS`.
  Do not disable certificate verification.
- Trace HTTP 401: check the workflow's TokenScope key and project access.
- Missing pricing: load a catalogue entry matching the actual provider
  and model; do not substitute fictional token counts or prices.
- Gemini failure: the page reports the provider outcome separately.
  A TokenScope key cannot fix a Gemini authentication or availability issue.
