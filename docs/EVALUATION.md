# Evaluation evidence

## Responsive matrix (TSE-88)

Viewports: 375 x 812 (mobile), 768 x 1024 (tablet), 1440 x 900 (desktop).
Automated checks: `frontend/test/e2e/responsive.spec.ts` (Playwright, 59 tests).
Browser emulation is not proof of physical-device testing; the physical-device row below is separate.

Tested commit: the head commit of the pull request that adds this file (committed code, no uncommitted changes).
Browser: Chromium 156.0.8078.4 (Playwright). Firefox and Edge are covered by TSE-84, not here.

| Route / panel | Viewports | State / interaction | Expected | Actual | Fix / PR | Evidence |
|---|---|---|---|---|---|---|
| `/`, `/signin`, `/signup`, `/privacy`, `/terms` | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | – | Playwright |
| Organizations, organization detail, Members, Projects | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | – | Playwright |
| Project dashboard | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | Date fields, Refresh button and assistant button no longer overflow or hide filters (TSE-88) | Playwright + manual |
| Documents | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | – | Playwright + manual |
| Trace Explorer (list) | 375, 768, 1440 | Page load, filters | From/To fields stay inside the card | PASS | From/To `min-w-0` fix (TSE-88) | Playwright + manual |
| Trace detail | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | – | Playwright |
| API keys | 375, 768, 1440 | Page load | No horizontal page scroll | PASS | – | Playwright + manual |
| Navigation | 375, 768, 1440 | Open menu, follow a link | Drawer below 768 px, sidebar from 768 px | PASS | – | Playwright |
| Legal footer | 375, 768, 1440 | Short page | Footer at the bottom of the screen | PASS | `AppLayout.tsx` (TSE-88) | Playwright |
| Assistant panel | 375, 768, 1440 | Open panel, resize window | Panel fits the screen, draft kept | PASS | – | Playwright |
| Trace list state | 375, 768, 1440 | Resize 1440 → 768 → 375 → 768 → 1440 | Same URL and same rows | PASS | – | Playwright |
| Dialogs, long names/emails/IDs | 375, 768, 1440 | Manual check of the whole app | Nothing clipped or unreachable | PASS | – | Manual |
| Main pages | iPhone, portrait | Navigation, menu, filters, dialogs over the local network (HTTP) | Usable by touch | PASS | – | Manual, physical device, Safari iOS (model and version not recorded) |

Tables intentionally scroll inside their own container; the checks above only forbid horizontal scrolling of the page itself.

## Reproduce

Development (debugging only):

```bash
cd frontend
E2E_BASE_URL=http://localhost:5173 npx playwright test test/e2e/responsive.spec.ts
```

Final evidence, trusted evaluation HTTPS (certificate validation stays enabled, no `ignoreHTTPSErrors`):

```bash
make eval-up
cd frontend
NODE_EXTRA_CA_CERTS="$PWD/../.local/eval/caddy-root.crt" \
E2E_BASE_URL=https://localhost:8443 npx playwright test test/e2e/responsive.spec.ts
```

The browser must also trust the evaluation CA (see `docs/LOCAL_DEVELOPMENT.md`).

## Remaining blockers

- Final trusted-HTTPS run on the integrated commit: done, 59 tests passed (`make eval-up`, https://localhost:8443, certificate validation enabled).
- Physical devices: one iPhone only (Safari iOS), served over HTTP on the local network. No Android or tablet.
- Firefox and Edge: see TSE-84. Chromium results are not claimed for other browsers.