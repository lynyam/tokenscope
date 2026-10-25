# Rich analytics extension

These two JSON files supplement, rather than replace, the canonical version 1.2
fixtures one directory above. The combined evaluation loader is version 1.3.

- `model-prices.json`: twelve fixed-ID, fictional provider/model entries.
  All prices are synthetic USD per million tokens. The template date
  `2026-10-01T00:00:00.000Z` is replaced in memory with the persisted analytics
  window start. Do not manually import this catalogue before running the seed.
- `expected-results.json`: exact counts, token sums, costs, errors and average
  latency for the generated 840-trace project, including filtered groups.
  These values are independent of the chosen time window.

Traces are generated deterministically by
`backend/src/evaluation/analytics-demo.ts`; there is no 840-row file to maintain.
The first installation/upgrade captures a completed UTC hour. Its preceding
seven-day window is stored in the existing seed receipt and reused on reruns.

Project: `30000000-0000-4000-8000-000000000006` (Acme Demo).
Price IDs: suffixes `001001`–`001012` in the existing price UUID namespace.
Trace IDs: suffixes `001001`–`001840` in the existing trace UUID namespace.
External IDs: `analytics-0001`–`analytics-0840`.
These ranges do not overlap the original golden, pagination or isolation IDs.

Use the normal explicit command:

```sh
make eval-up SEED=1 CONFIRM_DATABASE=tokenscope
```

The combined dataset has 899 traces and 15 prices. No credentials, prompts,
provider calls or uploads are created. An unchanged legacy seed can be upgraded
additively; edited/deleted data is never silently restored.
See [the full guide](../../../docs/ANALYTICS_DEMO.md).
