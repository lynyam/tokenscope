# TokenScope external demo

A separate customer-style application with Chat and Translation powered by
Gemini. Both workflows use the same `callWithTrace` wrapper and send traces to
different TokenScope projects. The application has no database and does not
need a TokenScope user access token at runtime.

## Evaluation workflow

Use [the Ubuntu evaluation guide](../../docs/EXTERNAL_DEMO-eval.md) as the
authoritative setup, configuration, launch and rehearsal instructions.

From the repository root, inside Ubuntu with Docker Engine:

```bash
make eval-up       # Start TokenScope HTTPS and import real-model pricing.
make demo-build    # Prepare the optional demo image; no credentials needed.
make demo-config   # After creating projects/keys in TokenScope, configure privately.
make demo-up       # Explicitly start only the demo container.
```

Open TokenScope at `https://localhost:8443` and the demo at
`http://127.0.0.1:8080` in a browser inside Ubuntu. The demo page is loopback
HTTP; its server-to-TokenScope and server-to-Gemini requests use verified HTTPS.

```bash
make demo-down    # Stop/remove only the demo; preserve TokenScope and its data.
```

There are no automatic demo launches, provider requests at startup, Podman
requirements, hardcoded backend-container names or host Node requirements in
this evaluation workflow. Old `demo-*-42` commands are superseded by the
commands above. Run `make demo-build` after changing demo source; use
`make demo-down` followed by `make demo-up` after source/configuration changes.

## Code to explain during the presentation

- `src/handlers.js`: select the Chat/Translation project key on the server and
  invoke the existing provider call through the shared wrapper.
- `src/call-with-trace.js`: measure provider execution and construct a trace
  from actual usage. No prompt or response text is included in the trace.
- `src/gemini.js` and `src/gemini-response.js`: call Gemini directly and
  normalize its actual model identifier, response and token usage.
- `src/send-trace.js`: send the trace to `/api/v1/public/traces` with `X-API-Key`.

TokenScope is not an inference proxy and does not intercept provider requests.
An application must instrument the calls it wants to report. There is one
automatic trace-delivery attempt, no durable queue and no automatic provider
retry. Missing usage is not fabricated. A trace-delivery failure does not
discard a successful provider answer. The UI displays the two outcomes
separately and exposes the safe trace payload for manual idempotent replay.

The example intentionally has no login, persistent chat history, streaming,
WebSockets, tools, document processing or provider selector. Use only
non-sensitive evaluation prompts. The runtime image contains only application
code, public assets and the public price catalogue, not test dependencies.

## Tests

```bash
make demo-test
make test-demo-startup
make test-eval-startup
```

For contributors who already have Node 24, application tests can also run with
`npm ci && npm test` in this directory. The isolated application tests do not
need `.env`, a provider key or a running TokenScope instance.

`MANUAL_TESTS.md` preserves the PR author's historical results. It does not
establish live acceptance for the revised launcher or the current model.
