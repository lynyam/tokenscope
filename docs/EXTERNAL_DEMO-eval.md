# External application demonstration — Ubuntu evaluation

Configuration and price review: **25 October 2026**.

## Purpose and deployment

At the end of evaluation, demonstrate a customer onboarding in TokenScope,
adding project keys to an external Chat/Translation application, making real
Gemini requests and inspecting the resulting usage and costs in TokenScope.

The physical host runs Fedora. VirtualBox runs an Ubuntu VM stored on the SSD.
Docker Engine, this repository, configuration files and the evaluation browser
all run **inside Ubuntu**. Fedora is not the Docker host for this setup.
No Fedora-to-VM port forwarding is required for browser access inside Ubuntu.

Keep the existing TokenScope Compose stack and `.env`. The demo is a separate,
explicitly started container called `tokenscope-external-demo`, not an extra
mandatory Compose service. It has no database or persistent volume. Its own
ignored `examples/external-demo/.env` holds its three keys; this is not a new
TokenScope `.env.eval`.

| Command | Effect |
| --- | --- |
| `make eval-up` | Start TokenScope HTTPS; import the real demo price catalogue; never start the demo. |
| `make eval-up SEED=1 CONFIRM_DATABASE=name` | Same, then run the existing explicitly requested synthetic seed. |
| `make demo-build` | Prepare the demo image; no credentials or running stack needed. |
| `make demo-config` | Interactively create private demo configuration, preserving an existing file. |
| `make demo-up` | Validate configuration and trusted TokenScope HTTPS; start only the optional demo. |
| `make demo-down` | Stop/remove only this checkout's demo container. |
| `make demo-logs` | Follow that demo's logs. |
| `make demo-test` | Build the separate test image and run application tests without a provider call. |
| `make test-demo-startup` | Run launcher/configuration orchestration tests with fake Docker commands. |

The demo is not started by `make up`, `make start` or `make eval-up`, and has no
automatic restart policy. Core Compose commands do not manage this standalone
container: stop it explicitly before switching TokenScope back to development
or shutting down the evaluation stack. Stopping it preserves TokenScope's
accounts, projects, traces, prices and certificates.

## Network and certificate decisions

The launcher targets the local, system Docker Engine on Ubuntu, not rootless
Podman, rootless Docker, a remote Docker daemon or Docker Desktop on macOS.
Use the same Ubuntu user for configuration and launch, with Docker access
already configured. Do not switch to sudo just for one demo command.

The demo uses Linux Docker `--network host`. It shares Ubuntu's network
namespace, so `https://localhost:8443` reaches the existing Caddy entry point.
The Node server still binds **127.0.0.1 only**, on port 8080 by default. This
is a deliberate local-evaluation choice, not a network-isolation claim.
No `-p` mapping is used with host networking.

Two distinct browser URLs remain:

- TokenScope: `https://localhost:8443`.
- External demo: `http://127.0.0.1:8080` (local-only HTTP).

The browser submits demo prompts to the demo's own origin. The demo backend
calls Gemini and TokenScope over HTTPS. There is no cross-origin browser call
from the demo to TokenScope and no change to TokenScope's CORS or CSP.

`make eval-up` exports `.local/eval/caddy-root.crt`. The launcher mounts only
that public certificate and the private demo configuration, both read-only.
It sets `NODE_EXTRA_CA_CERTS` before Node starts and explicitly keeps TLS
verification enabled. CA private keys and the Docker socket are never mounted.
Browser trust remains the existing one-time Ubuntu/browser setup; see
[LOCAL_DEVELOPMENT-eval.md](LOCAL_DEVELOPMENT-eval.md).

Technical references:
[Docker host networking](https://docs.docker.com/engine/network/drivers/host/)
and [Node extra CA certificates](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

## Prepare before the presentation

Prerequisites inside Ubuntu: the existing evaluation prerequisites (Docker,
Compose, Make, curl, OpenSSL), Bash, outbound HTTPS/DNS access and a Gemini key
with access/quota for `gemini-3.5-flash-lite`. No host Node installation is
needed for demo execution. Image pulls and test dependency installation need
network access; prepare those beforehand. Live inference always needs network
access and provider availability.

From the repository root:

```bash
make eval-up
make demo-build
make demo-test
make test-demo-startup
make test-eval-startup
```

Your existing optional analytics seed is independent. If wanted, use the same
documented seed credentials/confirmation as before; do not reset the database:

```bash
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

Replace `tokenscope` with the actual database name. See
[EVALUATION_SEED.md](EVALUATION_SEED.md). Pricing requires no seed password.

`demo-build` does not need the demo `.env`. `demo-up` builds the runtime image
if it is absent; otherwise it reuses the prepared image. After editing demo
source, run `make demo-build` explicitly before restarting the demo.

## Live onboarding and demonstration

1. In the Ubuntu browser, open TokenScope over trusted HTTPS.
2. Register a new disposable customer account, or sign into the rehearsal one.
3. Create an organization and two projects: **Chat** and **Translation**.
4. Create a key in each project and copy each full value securely when shown.
   They must belong to different projects, not merely be two different keys
   in the same project. Do not record or commit credentials.
5. Run `make demo-config`. Accept `https://localhost:8443` unless using a custom
   HTTPS port. Enter the Gemini key and the two project keys at hidden prompts.
6. Run `make demo-up` and open the printed local HTTP URL inside Ubuntu.
7. Send a short Chat prompt, for example `Explain what an API key is in two sentences.`
8. Confirm the provider answer and separate trace-delivery **HTTP 201** result.
   Inspect the matching external identifier, actual model, token counts,
   latency and cost in the TokenScope Chat project.
9. Translate a short sentence. Confirm its trace is in Translation, not Chat.
10. Open the relevant project dashboard, select a current date window and
    refresh after requests. Do not keep the synthetic seed's fixed date range
    selected for these live traces.
11. Finish with `make demo-down`. TokenScope and the stored traces remain.

The runtime needs no signup password, user JWT, database credentials or
organization identifier. The project key determines where each trace belongs.
The Gemini credential belongs to the external application's provider call;
it is not the same credential as a TokenScope project key or automatically
shared with TokenScope's own trace assistant.

Existing demo configuration is never overwritten by `make demo-config`. To
change keys, edit the ignored file privately, keep mode 600, and run:

```bash
make demo-down
make demo-up
```

Environment is read at process startup. An existing demo container is not
silently replaced: repeated `demo-up` asks for this explicit restart.

Show `examples/external-demo/src/handlers.js` to explain instrumentation:
`callWithTrace` wraps the real provider call; `sendTrace` posts measured usage
to `/api/v1/public/traces` with `X-API-Key`. TokenScope does not intercept all
provider traffic. Only instrumented calls are reported, with one automatic
delivery attempt and no durable retry queue. Prompts and answers go to Gemini,
not into the trace payload.

## Real pricing versus synthetic fixtures

The single catalogue is `examples/external-demo/config/model-prices.json`.
Google's official [pricing page](https://ai.google.dev/gemini-api/docs/pricing)
was checked on 25 October 2026: `gemini-3.5-flash-lite`, Standard paid rates,
USD **0.30** per million input tokens and **2.50** per million output tokens,
including thinking. The demo uses ordinary text requests without Batch,
Priority, explicit caching or grounding. The estimate is not an invoice;
free-tier actual billing can be zero.

`effectiveFrom: 2026-10-25T00:00:00.000Z` is our evaluation price-version start,
not Google's historical rate-change date. It covers requests from that point
onward. Do not backdate it or invent model aliases to make older traces pass.
No speculative future rates are included. When verified rates change, append
a new dated version rather than altering an imported historical version.

After HTTPS readiness, the `[pricing]` stage invokes the existing transactional
loader inside the evaluation backend, before the optional synthetic seed:

- First import: `{"inserted":1,"unchanged":0}`.
- Identical re-import: `{"inserted":0,"unchanged":1}`.
- Same identity/date but different data: `MODEL_PRICE_CONFLICT`; no overwrite.

It does not call Gemini, download prices, start the demo or change existing
trace cost snapshots. Missing files, failed copy/validation or database errors
stop startup at `[pricing]` and suppress the final success message. Containers
may already be running; this is not an automatic rollback or database reset.

The demo records Gemini's actual returned `modelVersion`. During rehearsal,
confirm it matches the catalogue. If it differs, verify that identifier's price
before adding a row; do not relabel a trace to bypass pricing validation.

## Failure handling and acceptance checks

| Check | Expected result |
| --- | --- |
| `eval-up` with no demo `.env` | Core stack and pricing succeed; no demo container or provider call. |
| Repeat `eval-up` | Identical price version unchanged; no duplicates or demo launch. |
| Explicit `SEED=1` | Existing synthetic dataset remains repeatable; real prices coexist. |
| Missing demo `.env` or public CA | `demo-up` fails clearly before starting its persistent container. |
| Invalid model, duplicate keys or unsuitable URL | Preflight names the problem without exposing credentials. |
| Untrusted HTTPS or unreachable TokenScope | Preflight fails without disabling TLS verification. |
| Port already occupied | Preflight fails; no unrelated process is stopped. |
| Chat and Translation | Real answers and matching project traces, HTTP 201. |
| Exact payload replay | HTTP 200, same trace identity, no duplicate/provider invocation. |
| Revoke Chat key | Chat answer can still succeed; delivery reports 401; Translation remains independent. |
| Replace Chat key and restart demo | Subsequent Chat trace delivery succeeds. |
| Stop TokenScope backend after demo starts | Demo stays healthy and preserves answers while reporting delivery failure; restore backend afterward. |
| `demo-down` | Only the owned demo container is removed; core services, config and data remain. |
| Same container name from another checkout | Operation refuses to stop/remove it. |

Use the existing backend-only stop/start commands for an outage rehearsal:
`docker compose stop backend`, then `docker compose start backend`. Do not
reset volumes or stop PostgreSQL. Verify the existing HTTPS health endpoint
after restoration. The demo's steady-state health check only reads its own
page; it intentionally does not require TokenScope/provider availability.

Startup preflight proves configuration syntax, local port availability and
trusted TokenScope database health, **not** Gemini key validity/quota, project
key authorization, actual model identity or successful ingestion. Validate
those with real requests before presenting. Deliberate failure demonstrations
produce expected diagnostic feedback; do not present that as a clean happy-path
console run.

Preserve the historical PR evidence in `examples/external-demo/MANUAL_TESTS.md`,
but record fresh evidence for this launcher/model: tested commit, Ubuntu,
Docker/Compose and browser versions, command results, successful HTTPS
preflight, both trace IDs, pricing repeat result and stop-isolation check.
Never include key values, environment contents or private prompts in evidence.

Automated application tests and fake-command orchestration tests do not prove
real Docker networking, certificate mounts or live Gemini availability. Run
this acceptance checklist in the actual Ubuntu VM before merging.
