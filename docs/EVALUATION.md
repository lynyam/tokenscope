## Responsive matrix (TSE-88)

Viewports: 375 x 812 (mobile), 768 x 1024 (tablet), 1440 x 900 (desktop).
Automated checks: `frontend/test/e2e/responsive.spec.ts` (Playwright, 59 tests).
Mobile touch is browser emulation only, not physical-device testing.

Tested commit: `<COMMIT_SHA>` — working tree: `<clean | dirty>`
Browser: Chromium `<VERSION>` (Playwright). Firefox and Edge are covered by TSE-84, not here.

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
| Trace list state | 375, 768, 1440 | Resize 1440 → 768 → 375 → 1440 | Same URL and same rows | PASS | – | Playwright |
| Dialogs, long names/emails/IDs | 375, 768, 1440 | Manual check of the whole app | Nothing clipped or unreachable | PASS | – | Manual |
| Exports | 375, 768, 1440 | `<à remplir>` | `<à remplir>` | `<à remplir>` | – | `<à remplir>` |

### Remaining blockers
- Final evidence on trusted evaluation HTTPS (`make eval-up`, CA verification on): `<pas encore fait>`.
- Physical devices: not tested (the app runs locally in a VM); emulation only.
- Firefox / Edge: see TSE-84.