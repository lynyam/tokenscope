# External demo: manual verification

Verification date: 2026-10-18.
Environment: Ubuntu VM, Docker, TokenScope evaluation stack with HTTPS.
Provider: Gemini, model gemini-3.8-flash.

These checks used real provider calls and the running TokenScope API.
They supplement the automated tests.

## Verified results

| Check | Observed result |
| --- | --- |
| Chat | Gemini returned an answer; TokenScope accepted the trace with HTTP 201. |
| Translation | Gemini returned translated text; TokenScope accepted the trace with HTTP 201. |
| Exact trace replay | Resending the original payload returned HTTP 200 with matching externalId. No additional Gemini call was made. |
| Chat project ownership | Reading the Chat trace with the Chat key returned HTTP 200 and the expected projectId and workflow. |
| Translation project ownership | Reading the Translation trace with the Translation key returned HTTP 200 and the expected projectId and workflow. |
| Cross-project isolation | Each key received HTTP 404 when reading the other project's trace. |
| Temporary key revocation | Creation returned HTTP 201; revocation returned HTTP 204; a subsequent authenticated trace read returned HTTP 401. |
| Answer retained after delivery failure | Using the revoked Chat key, Gemini returned an answer and usage; the demo displayed the answer alongside the trace-delivery HTTP 401 error. |
| Translation unaffected by Chat key revocation | In the same temporary demo instance, Translation still returned an answer and delivered its trace with HTTP 201. |

## Evidence references

Replay and project-isolation checks:
- Chat trace: f5e8b075-dfde-4f75-ad52-23d3025bbba1
- Chat externalId: demo-chat-947455ca-9903-4d08-8104-59761e3455f3
- Translation trace: af62d94a-a4b0-406f-9beb-28080ac21b6e

Revoked-key delivery check:
- Chat externalId: demo-chat-367f3417-6bd5-4409-b98e-e5d68b92c9e8
- Delivery HTTP status: 401
- Gemini usage: 21 input tokens, 404 output tokens
- Provider latency: 23202 ms

Unaffected Translation check:
- Trace: c0dba79c-faa4-4907-aa18-0c3f8817ae88
- Delivery HTTP status: 201
- Gemini usage: 21 input tokens, 221 output tokens
- Provider latency: 3449 ms

These identifiers refer to the local evaluation database.

## Observations and remaining verification

Earlier Chat attempts reported provider unavailability and no usable token
usage. The demo skipped trace delivery for those attempts. Later requests
succeeded; the precise cause of the earlier failures was not established.

Successful manual checks do not establish completion of every ticket criterion.
A controlled TokenScope outage and recovery test remains outstanding.
Stored cost calculations have not yet been independently checked against
the catalogue and recorded token counts.

No API keys, login tokens, prompts, or generated answers are included here.
