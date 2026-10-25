# Browser compatibility (TSE-84)

## Current candidate: verification required

The review combines PR #61 head `b1d9e9f56bc816d5cb69376dc3ebd268a4984eb5`
with develop `a694a1ecbed816d24752751afe42cab407f6b1af`, plus the review corrections.
The historical results below are NOT results for this combined candidate.
Record the final commit after applying/committing the correction and rerun the matrix.

This review environment has no Docker evaluation stack or installed Chrome/Edge/Firefox.
Browser execution is BLOCKED here; test discovery and unit tests do not count as browser PASS.
TSE-84 is not complete until its remaining browser and manual evidence is recorded.

| Flow | Chrome/version | Firefox/version | Edge/version | Evidence / remaining work |
| --- | --- | --- | --- | --- |
| Authentication | NOT RUN | NOT RUN | NOT RUN | UI sign-in is exercised by API-key and Settings journeys; manually verify signup validation, logout/Back and invalid JWT. |
| Organizations/memberships/projects | NOT RUN | NOT RUN | NOT RUN | Run archive and Settings suites; manually check membership add/change/remove/last-owner protection. |
| API keys | NOT RUN | NOT RUN | NOT RUN | Run API-key suite; manually verify actual clipboard and denied-copy/manual-selection behavior, particularly Firefox. |
| Trace Explorer | NOT RUN | NOT RUN | NOT RUN | Existing filters, ordering, pagination, details and access-loss suites. |
| Dashboard/realtime | NOT RUN | NOT RUN | NOT RUN | Run dashboard, realtime and trace suites; confirm WebSocket notification, refetch, exact totals, reconnection and old-project isolation over HTTPS. |
| CSV/PDF exports | NOT RUN | NOT RUN | NOT RUN | Existing download suite; verify selected scope, values and usable downloaded artifacts. |
| Documents | NOT RUN | NOT RUN | NOT RUN | Existing upload, inert preview, PDF worker, download, delete and role suites. |
| Assistant: intercepted UI responses | NOT RUN | NOT RUN | NOT RUN | Existing assistant.spec.ts; buffered route.fulfill responses do NOT prove progressive delivery through Caddy. |
| Assistant: controlled progressive transport | NOT RUN | NOT RUN | NOT RUN | Existing test-only provider override is backend test infrastructure, not a selectable eval provider. Browser-to-backend streaming evidence still required; do not add a production fake. |
| Assistant: real Gemini | NOT RUN | NOT RUN | NOT RUN | Explicit manual request per browser; record model/tier, scope, progressive output, Stop and scope changes. Mark quota failures BLOCKED. |
| Public pages/layout | NOT RUN | NOT RUN | NOT RUN | Public/landing/responsive suites plus Settings at 390×844 and 1440×900; manually check other flows at 390×844. No physical-mobile claim. |
| Seeded evaluation accounts | NOT RUN | NOT RUN | NOT RUN | Explicit opt-in only; ordinary suite skips these five tests. |

Use PASS only after execution; FAIL means executed and failed; BLOCKED means an identified
prerequisite prevented execution; NOT RUN means not attempted. Do not reuse old pass counts.

## Setup and trusted HTTPS

Run on the host with Node 24, not inside the Caddy frontend container. Keep the existing
Compose file and ignored root `.env`. No extra environment file or development startup is needed.

1. Start the selected disposable rehearsal stack with `make eval-up`. If it is already
   running and unchanged, do not reset it. For a fresh seeded demo, configure DEMO_PASSWORD
   in `.env` and use `make eval-up SEED=1 CONFIRM_DATABASE=tokenscope` instead; substitute
   your actual database name. See [seed instructions](EVALUATION_SEED.md).
2. Trust the exported public CA using [the existing instructions](LOCAL_DEVELOPMENT-eval.md#trust-the-local-certificate).
   Never export the private CA key. Each browser must open the origin without certificate warnings.
3. Run `make frontende2e-setup`. It installs frontend dependencies and Playwright Firefox.
   Install the release Google Chrome and Microsoft Edge applications separately if absent.
   The projects use their actual `chrome`/`msedge` channels, not a user-agent substitute.
   On Linux, Playwright may also require OS dependencies (`cd frontend && npx playwright install-deps firefox`).
   This can require administrator approval.
4. Set the Node API client's CA and the evaluation origin in the same shell, from the repo root:

```bash
export NODE_EXTRA_CA_CERTS="$PWD/.local/eval/caddy-root.crt"
export E2E_BASE_URL="https://localhost:8443"
```

`NODE_EXTRA_CA_CERTS` does not provision browser certificate stores. Firefox's
`security.enterprise_roots.enabled` setting imports OS roots on macOS/Windows, not Linux.
On Linux (or when fresh Playwright profiles still reject the CA), create the ignored local file
`.local/eval/firefox-policies.json` with this structure, replacing the path with the actual
absolute path to your exported **public** CA:

```json
{
  "policies": {
    "Certificates": {
      "Install": ["/absolute/path/to/tokenscope/.local/eval/caddy-root.crt"]
    }
  }
}
```

Then, from the repository root, use Playwright's supported policy input:

```bash
export PLAYWRIGHT_FIREFOX_POLICIES_JSON="$PWD/.local/eval/firefox-policies.json"
```

Do not overwrite an existing organization policy; coordinate its certificate entry if one exists.
This is a local browser certificate policy, not a new application environment file.
Use the installed Firefox release's own certificate settings for the separate manual check.
For Chrome/Edge on Linux, provision their certificate store too if the system CA is not picked up.
If policy or trust cannot be provisioned, mark the browser BLOCKED; never bypass TLS.

Sources: [Playwright browser channels/install warning](https://playwright.dev/docs/browsers),
[Playwright Firefox policy input](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-firefox-user-prefs),
[Mozilla certificate policy and Linux limitation](https://firefox-admin-docs.mozilla.org/reference/policies/certificates/).
Playwright's optional branded-browser installer can replace a system installation;
it is intentionally not run by `make frontende2e-setup`.

## Commands for this candidate

Use a clean candidate checkout. Run each command successfully before proceeding. From the repo root:

```bash
git rev-parse HEAD
git status --short
node --version
cd frontend
npm run check
npm test
npm run build
npm run test:e2e -- browser-compatibility.spec.ts --project=chrome
npm run test:e2e -- browser-compatibility.spec.ts --project=firefox
npm run test:e2e -- browser-compatibility.spec.ts --project=edge
npm run test:e2e -- project-settings.spec.ts --project=chrome
npm run test:e2e -- project-settings.spec.ts --project=firefox
npm run test:e2e -- project-settings.spec.ts --project=edge
npm run test:e2e -- --project=chrome
npm run test:e2e -- --project=firefox
npm run test:e2e -- --project=edge
```

The preflight prints the actual browser version and validates both Node and browser HTTPS.
On HTTP it is explicitly skipped: that is useful for dev debugging, never final evidence.
Use sequential runs: they create unique disposable users/projects and respect existing rate limits.
Do not delete shared database/storage volumes. The existing feature suites require the
`fixture-a/demo-fast` and `fixture-b/demo-large` price rows; the evaluation seed supplies them.
For an unseeded stack follow [explicit catalogue loading](LOCAL_DEVELOPMENT-eval.md#explicit-price-catalogue-loading).

For the five read-only seeded-account checks, provide DEMO_PASSWORD in the host environment
without putting it in command history, then from `frontend/` run each browser separately:

```bash
E2E_EVALUATION_SEED=1 npm run test:e2e -- evaluation-seed.spec.ts --project=chrome
E2E_EVALUATION_SEED=1 npm run test:e2e -- evaluation-seed.spec.ts --project=firefox
E2E_EVALUATION_SEED=1 npm run test:e2e -- evaluation-seed.spec.ts --project=edge
```

The runner keeps the seed run's line-only reporter. Do not override it with HTML reporting
or enable traces, screenshots, videos or HARs for credentials/one-time API keys.
Normal HTML reports/results remain Git-ignored; inspect and redact any evidence before sharing.

## Record before merging / closing TSE-84

For every run record candidate SHA, clean/dirty tree, UTC date/time, OS, Node/Playwright and
actual browser versions, origin, command, pass/fail/skip counts, and any flaky result.
Record installed release Firefox separately from Playwright Firefox.
Run headed manual checks in all three release browsers, including keyboard dialogs,
clipboard success/denial, 390×844 layout, and explicit live Gemini calls.
Keep [existing evaluation evidence](EVALUATION.md) and [the evaluation run record](DEMO-eval.md#evaluation-run-record).

Investigate unexpected page errors, console errors, failed HTTP requests, mixed content,
PDF worker failures, WebSocket and assistant stream failures. Expected intentional 403/404,
offline failures and request cancellations must be identified per scenario, not globally ignored.
The new preflight and Settings journeys check diagnostics; they do not imply every existing
feature test has comprehensive console/network assertions. Review those flows manually too.

## Historical report from the original PR (not current-candidate evidence)

The author supplied the following report for `fafdfde`. It is retained for traceability,
not independently rerun by this review. Its 98-test suite predates the merged responsive,
landing and review coverage; its PASS labels do not complete the matrix above.

Automated run of the whole Playwright suite on the trusted evaluation HTTPS stack (`make eval-up`,
`https://localhost:8443`, real backend and PostgreSQL). Certificate validation stays enabled
(no `ignoreHTTPSErrors`, no security flags). Each browser is a Playwright project:
`chrome` and `edge` use the installed branded browsers (`channel`), `firefox` uses Playwright's Firefox build.

| Item | Value |
|---|---|
| Tested commit | `fafdfde` (clean working tree) |
| Date | 2026-10-25 |
| OS | Debian GNU/Linux 13 (trixie), kernel 6.12.111 |
| Playwright | 1.64.1 |
| Google Chrome | 154.0.8037.97 |
| Microsoft Edge | 156.0.4314.42 |
| Mozilla Firefox | 157.0 (Playwright build). The installed Firefox ESR 153.4.0 was used for manual checks only. |

## Automated results

98 tests per browser: 93 PASS, 5 NOT RUN, 0 FAIL, 0 flaky (no test failed then passed on retry; retries are not used).

| Flow | Tests | Chrome | Firefox | Edge |
|---|---|---|---|---|
| API keys: create, one-time secret, revoke, roles, isolation | 16 | PASS | PASS | PASS |
| Dashboard assistant: ask, stop, retry, panel at 375 px | 11 | PASS | PASS | PASS |
| Dashboard export: CSV and PDF download | 4 | PASS | PASS | PASS |
| Documents: upload, preview, download, delete, isolation | 15 | PASS | PASS | PASS |
| Organization archive and access loss | 5 | PASS | PASS | PASS |
| Project dashboard: filters, periods, realtime refresh | 8 | PASS | PASS | PASS |
| Public pages, legal links, theme, mobile navigation | 8 | PASS | PASS | PASS |
| Realtime transports: polling, websocket, upgrade | 3 | PASS | PASS | PASS |
| Trace Explorer: filters, search, sort, pagination, detail, realtime | 23 | PASS | PASS | PASS |
| Seeded evaluation accounts (`evaluation-seed.spec.ts`) | 5 | NOT RUN | NOT RUN | NOT RUN |

The 5 seeded-account tests are skipped on every browser.

## Manual checks

Manual checks are separate from the automated run and use the real clipboard and a headed browser.

| Check | Chrome | Firefox | Edge |
|---|---|---|---|
| Copy of the API key secret reaches the real clipboard | PASS (automated and manual) | PASS (manual only) | NOT RUN (manual) |
| Main flows in a headed browser | PASS | PASS | NOT RUN |
| Real Gemini assistant answer | NOT RUN | NOT RUN | NOT RUN |

## Fixes and test changes

- No application code needed a browser-specific fix. The application contains no browser-name detection.
- `api-keys.spec.ts`: Playwright cannot grant `clipboard-read` / `clipboard-write` to Firefox. The clipboard content assertion runs on Chromium-based browsers only; Firefox is verified manually (table above).
- `trace-explorer.spec.ts`: a page opened with `context.newPage()` fires a `load` event on `about:blank` in Firefox but not in Chromium. The "page never reloaded" counter now ignores `about:blank`. Real reloads of the application are still counted.

## Reproduce

For current prerequisites use the setup above. Historical responsive results remain in `docs/EVALUATION.md`.

```bash
NODE_EXTRA_CA_CERTS="$PWD/.local/eval/caddy-root.crt" E2E_BASE_URL=https://localhost:8443 E2E_ARGS="--project=chrome" make frontende2e
NODE_EXTRA_CA_CERTS="$PWD/.local/eval/caddy-root.crt" E2E_BASE_URL=https://localhost:8443 E2E_ARGS="--project=edge" make frontende2e
NODE_EXTRA_CA_CERTS="$PWD/.local/eval/caddy-root.crt" E2E_BASE_URL=https://localhost:8443 E2E_ARGS="--project=firefox" make frontende2e
```

## Limitations

- Automated runs were done on Linux only. No macOS or Windows run.
- Edge manual checks and the real Gemini check per browser were not done.
- Safari was checked manually only, outside this matrix.
- The narrow phone layout (390 x 844) is covered by the responsive matrix on Chromium, not rerun on Firefox or Edge.
