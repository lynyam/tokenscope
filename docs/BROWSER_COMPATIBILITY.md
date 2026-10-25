# Browser compatibility (TSE-84)

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

Prerequisites are in `docs/LOCAL_DEVELOPMENT.md`, section "Browser compatibility tests (TSE-84)". Responsive results are in `docs/EVALUATION.md`.

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
