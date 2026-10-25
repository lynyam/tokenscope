# Evaluation evidence

## TSE-88: responsive validation

Required viewports: **375 x 812**, **768 x 1024**, **1440 x 900**.
The current automated suite has 68 responsive cases plus 10 public-navigation
cases (including standalone favicon light/dark checks). Listing tests is not
evidence that they passed.

The responsive suite uses a real backend and disposable accounts, organizations,
projects, golden traces and a document. It does not change shared demo records
or submit an assistant question. A populated fixture catalogue is required.
Loaded-state assertions precede layout measurements; table columns and actions
must be reachable by scrolling their own container.

### Historical author report, not final-candidate evidence

PR [#56](https://github.com/lynyam/tokenscope/pull/56) originally reported 59
responsive cases passing in development and trusted evaluation HTTPS, plus manual
checks of dialogs and long content. It named Chromium 156.0.8078.4 but did not
record an immutable tested commit or desktop OS. Its physical-device report was
one iPhone using Safari over LAN **HTTP**, with no model/iOS version recorded.
Those results are not proof for a later merge with develop or the review fixes.
Firefox/Edge remain TSE-84; browser emulation is not physical-device evidence.

### Final-candidate record — complete before merging

Record the full output of `git rev-parse HEAD` and `git status --short` **before
the run**, the date, OS, browser/version, origin and certificate-trust setup.
Run against committed code; if only this evidence file changes afterward, state
that explicitly and retain the tested implementation SHA. If implementation,
dependencies, configuration or tests change, rebuild and rerun.

| Route / interaction | Viewports | Expected | Actual on final candidate |
| --- | --- | --- | --- |
| Landing, sign-in/up, privacy, terms | All three | Loaded content fits; legal links and theme work | NOT RUN |
| Organization list/detail/members/projects | All three | Real records loaded; no page overflow | NOT RUN |
| Long organization name, rename controls, confirmation, switcher | All three | Full values wrap; controls reachable; cancel does not mutate | NOT RUN |
| Dashboard and Trace Explorer dates/actions | All three | From/To/Apply inside form; Reset/Refresh reachable | NOT RUN |
| Trace table and detail link | All three | Every column reachable; View navigates to real detail | NOT RUN |
| Documents and API keys | All three | Populated content loaded and contained | NOT RUN |
| Navigation, footer, assistant, resizing | All three | Sidebar/drawer breakpoint; footer contained; draft/URL/rows retained | NOT RUN |
| Favicon and page logos | Light and dark | Readable browser-tab icon and in-page logos | NOT RUN |
| Manual extended states below | All three | No clipping, inaccessible controls or state loss | NOT RUN |
| Physical device | Record device/OS/browser/origin | Touch navigation/forms/dialogs usable | NOT RUN |

Do not turn a missing check into PASS. Record FAIL, BLOCKED (with reason), or
NOT RUN where applicable, with the corresponding fix/issue and evidence location.
Do not attach credentials, tokens, API-key values or authenticated browser traces.

### Reproduce in evaluation HTTPS

From the repository root, with Node 24 and Docker available:

```bash
npm --prefix frontend ci
npm --prefix frontend run check
npm --prefix frontend test
npm --prefix frontend run build
make eval-up
```

Use the existing `.env` and Compose services. No development startup is needed.
An already seeded evaluation database has the required synthetic catalogue:
**do not reset or reseed it just to run these tests**.

For a deliberately new evaluation dataset, configure `DEMO_PASSWORD` in the
existing ignored `.env` and follow [EVALUATION_SEED.md](EVALUATION_SEED.md), using
`make eval-up SEED=1 CONFIRM_DATABASE=tokenscope` (adjust the confirmed database
name). Do not import prices separately before that initial seed.

Only for a disposable browser-test database where you do **not** intend to run
the evaluation seed, an alternative explicit catalogue import into the running
evaluation backend is:

```bash
docker compose cp fixtures/evaluation/model-prices.json backend:/tmp/model-prices.json
docker compose exec -T backend npm run pricing:load -- --file /tmp/model-prices.json
```

The evaluation image is already built; do not run a development build in it.
This standalone import would conflict with a later first seed in that database.

Trust the current exported CA in the actual test browser using
[LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). `NODE_EXTRA_CA_CERTS` handles the
Node API client; it does not by itself install trust in Chromium. Keep
certificate validation enabled: no `ignoreHTTPSErrors` or insecure launch flags.

```bash
git rev-parse HEAD
git status --short
cd frontend
npx playwright install chromium
NODE_EXTRA_CA_CERTS="$PWD/../.local/eval/caddy-root.crt" \
E2E_BASE_URL=https://localhost:8443 \
npx playwright test test/e2e/responsive.spec.ts test/e2e/public-navigation.spec.ts
```

Use the configured origin if the HTTPS port is not 8443. Run from the host:
the evaluation `frontend` container serves built files with Caddy, not Node.
For optional development debugging, the same tests accept
`E2E_BASE_URL=http://localhost:5173`; an HTTP pass does not replace HTTPS evidence.

### Manual extended states still required

On the same candidate at all three sizes, inspect empty/loading/retry/validation
states, member editing/removal, project editing, key reveal/revoke, upload errors,
document preview/delete, analytics chart legends/tooltips and CSV/PDF exports.
Use long project names, emails, IDs, filenames, models, metadata and assistant
text. Verify keyboard focus, menu/dialog dismissal and pending-action protection.
Check that the floating assistant button does not cover controls, date values
remain readable, resize retains applied filters/drafts, and every table action is
reachable. Automated bounding-box checks are not proof of all these behaviors.
Record a physical-device result separately, or a specific reason it is blocked.
