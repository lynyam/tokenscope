# Analytics Demo — varied seven-day evaluation data

This extends TSE-70; it does not replace the small verification fixtures or
change application analytics, authentication, Compose services or pricing rules.
The demo uses fictional providers and synthetic prices, not current commercial
quotes. Trace generation makes no external requests and needs no LLM credentials.
Using the assistant afterwards is separate and still requires its normal provider
configuration.

## Apply to the existing evaluation seed

Keep your existing ignored `.env`, `DEMO_PASSWORD`, database credentials,
Compose project and original `ANCHOR` (if you selected a custom one).
After applying the source update, run from the repository root:

```sh
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

Use your actual database name. Evaluation startup rebuilds the backend, applies
the committed `20261025090000_evaluation_analytics_window` migration and seeds
after HTTPS readiness. There is no manual price import and no development-mode
prerequisite. The migration only adds a nullable timestamp to the seed receipt;
it does not delete or rewrite application data.

The loader returns:

| Installed state | Result |
| --- | --- |
| No fixture data or receipt | `inserted`: the complete 1.3 dataset in one transaction |
| Unchanged 1.2 seed, same password and golden anchor | `upgraded`: append Analytics Demo; preserve every old entity row |
| Unchanged 1.3 seed | `already-present`: no writes, even on another day |
| Edited/deleted baseline or demo, collision, different password/anchor, unsupported receipt version | Refuse; do not overwrite, reset or restore |

The supported upgrade checks the old fingerprint and actual stored records,
then appends one project, twelve prices and 840 traces and updates the receipt
atomically. A failure leaves the old seed intact. Old account hashes, IDs,
timestamps, membership roles and golden results remain unchanged.

If you have already modified the baseline during a rehearsal, keep that database.
Use a new, unused Compose project and free HTTPS port for another rehearsal:

```sh
COMPOSE_PROJECT_NAME=tokenscope-rich-rehearsal EVAL_HTTPS_PORT=9443 \
  make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

Use the same project prefix for subsequent commands. This uses the same Compose
file and `.env`, with separate project-scoped volumes. Its CA is different:
startup exports that project's public certificate to the usual location, so
follow the existing trust instructions for its endpoint. Do not delete the old
volumes, remove its receipt or use `fullclean` to force this upgrade.

For an already-running backend with the new code/client and migration installed:

```sh
make eval-seed CONFIRM_DATABASE=tokenscope
```

In development, generate the new Prisma Client and apply committed migrations
before running the seed:

```sh
docker compose exec -T backend npx prisma generate
docker compose exec -T backend npx prisma migrate deploy
make eval-seed CONFIRM_DATABASE=tokenscope
```

## Open the dashboard

Sign in with `owner@demo.tokenscope.test` and your configured `DEMO_PASSWORD`.
Select **Acme Demo → Analytics Demo**. Admin and member accounts can also read it;
the outsider cannot. Its stable project ID is
`30000000-0000-4000-8000-000000000006`.

The command prints `analyticsDemo.range` and `analyticsDemo.dashboardPath`.
Append that path to your frontend origin (normally `https://localhost:8443`)
to open the exact, complete dataset. The original Support Golden, Empty Project,
Pagination Project, archived project and other-tenant project retain their roles.
The complete seed has **4 users, 2 organizations, 4 memberships, 6 projects,
15 prices, 899 traces and 1 receipt**.

## Recent dates without changing the dataset on restart

At the first enriched seed or the 1.2 upgrade, capture the current time once,
round down to the completed UTC hour, and save it as `analyticsWindowEnd`.
Generate the preceding seven rolling 24-hour blocks. For example, an installation
at 2026-10-24 18:30 UTC has this exact interval:

```text
2026-10-17T18:00:00.000Z inclusive
2026-10-24T18:00:00.000Z exclusive
```

Each block has traffic from hour 2 through hour 21, with quiet periods at either
end. All twelve provider/model combinations occur in every block. No trace is
future-dated; the application clock and production validation remain unchanged.
Immediately after seeding, the normal Last 7 days preset contains the complete
dataset, with roughly one to two hours of margin before the oldest record ages out.

The receipt freezes this window. Re-running next week does not re-date traces,
create duplicates or refresh prices. Use the printed exact dashboard path after
the data ages out of the moving preset. To prepare a newly recent week, create a
fresh isolated rehearsal as above. There is deliberately no destructive refresh
flag. `ANCHOR` still shifts only the original golden fixtures; it does not
change the analytics window. Tests inject a fixed clock into the generator.

The dashboard groups longer periods by UTC calendar day. A seven-day interval
ending at a non-midnight hour can intersect **eight** calendar buckets. This is
correct; the following generator blocks are rolling 24-hour periods, not always
midnight-to-midnight chart buckets.

## Exact totals and useful demonstration scenarios

For the complete unfiltered Analytics Demo window:

| Metric | Expected value |
| --- | ---: |
| Traces | 840 |
| Input tokens | 5,516,730 |
| Output tokens | 760,941 |
| Total tokens | 6,277,671 |
| Estimated synthetic cost (USD) | 8.550480200000 |
| ERROR traces | 49 |
| Error rate | 5.83% |
| Average latency | 1562.205 ms |

The ERROR statuses simulate unsuccessful requests made by a fictional upstream
application. They are data to demonstrate error-rate analytics. They are not
exceptions that the seed should print, nor permission for browser console errors.

| Rolling block, oldest first | Traces | Synthetic cost (USD) |
| --- | ---: | ---: |
| 1 | 60 | 0.724618000000 |
| 2 | 90 | 0.820811400000 |
| 3 | 120 | 1.012910450000 |
| 4 | 210 | 2.403306400000 |
| 5 | 165 | 1.642731050000 |
| 6 | 105 | 1.214229350000 |
| 7 | 90 | 0.731873550000 |

Demonstrate:

1. **Cost over time:** block four combines higher traffic and more long reports.
2. **Provider/model comparison:** `demo-aurora/aurora-mini` has 199 traces and
   costs `0.281346900000`; `demo-boreal/boreal-pro` has only 38 traces but
   costs `2.839524000000`. Cost is not simply request count or token volume.
3. **Workflow filters:** support uses shorter exchanges; summarization has large
   inputs; classification has small outputs; report generation has long outputs.
4. **Status filters:** 49 ERROR rows include both zero-token failures and failures
   with partial usage. They retain the existing application's cost semantics.
5. **Latency, search and pagination:** variation and slow outliers are visible in
   trace inspection; stable external IDs are `analytics-0001`–`analytics-0840`.
6. **Exports:** use the normal dashboard CSV/PDF controls; compare the selected
   snapshot, not a different date window or the overall database total.
7. **Assistant:** with the normal provider configured, ask which model contributes
   most to cost or how input/output usage differs. The allowlisted context and
   synthetic-pricing indication still apply. No prompt/response text is seeded.

The input range is approximately 100–30,000 tokens and output 20–6,000 for normal
requests; failures can have zero or partial output. These are designed examples,
not measurements of real model performance or provider reliability.

## Catalogue and implementation

All rates below are **synthetic USD per million tokens**:

| Provider | Model | Input | Output |
| --- | --- | ---: | ---: |
| demo-aurora | aurora-mini | 0.15 | 0.60 |
| demo-aurora | aurora-standard | 0.80 | 3.20 |
| demo-aurora | aurora-pro | 4.00 | 16.00 |
| demo-boreal | boreal-mini | 0.25 | 1.00 |
| demo-boreal | boreal-standard | 1.20 | 4.80 |
| demo-boreal | boreal-pro | 6.00 | 24.00 |
| demo-cascade | cascade-mini | 0.10 | 0.40 |
| demo-cascade | cascade-standard | 0.60 | 2.40 |
| demo-cascade | cascade-pro | 3.00 | 12.00 |
| demo-delta | delta-mini | 0.20 | 0.80 |
| demo-delta | delta-standard | 1.00 | 4.00 |
| demo-delta | delta-pro | 5.00 | 20.00 |

The original `fixtures/evaluation/model-prices.json` stays unchanged because
existing contract tests and the 1.2 receipt depend on it. The additional twelve
entries live in `fixtures/evaluation/analytics-demo/model-prices.json`.
The loader combines both catalogues. The extension's template effective date is
shifted to the frozen window start; do not import this template manually.

`backend/src/evaluation/analytics-demo.ts` generates stable IDs and values with
a fixed xorshift32 sequence, unequal model/workflow weights and daily volumes.
No new dependency is required. The sequence is for data variation, not security.
Trace validation, payload hashing, historical price selection and exact decimal
cost calculation reuse application code. The extension resolves twelve prices
and writes traces in batches of 250, retaining the existing serializable
transaction, advisory lock and timeout. It does not weaken production pricing.

Independent expected totals by provider, model, workflow and rolling day are in
`fixtures/evaluation/analytics-demo/expected-results.json`. Tests use integer
picodollar arithmetic independently of the production decimal calculator.
Changing catalogue values or generator output requires an intentional version
and expectation update, not silently accepting a different installed dataset.

## Verification

Run the existing isolated backend gate and startup orchestration tests:

```sh
make test-backend
make test-eval-startup
```

The enriched integration tests cover real HTTP analytics, filters, pagination,
tenant isolation, a fake assistant, new installation, the 1.2 upgrade, frozen
dates, unchanged reruns, collision refusal and transaction rollback. Unit
repository doubles exercise orchestration but do not prove PostgreSQL behavior.

After seeding an isolated evaluation stack and trusting its certificate, export
the same `DEMO_PASSWORD` privately in the terminal and run:

```sh
E2E_EVALUATION_SEED=1 E2E_BASE_URL=https://localhost:8443 \
  make frontende2e E2E_ARGS=evaluation-seed.spec.ts
```

The five browser tests cover the four accounts and a richer dashboard/filter
smoke test. The dashboard test derives the frozen window from the authenticated
price API, so no new environment variable is needed. It also checks console
warnings/errors, unhandled errors and absence of implicit assistant requests.
Automatic credential-bearing screenshots, videos, traces and HTML reports stay
disabled. Browser tests must actually execute; test discovery is not a pass.
