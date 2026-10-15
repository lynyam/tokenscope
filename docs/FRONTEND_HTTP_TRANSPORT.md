# Frontend HTTP transport

All browser API calls go through `frontend/src/api/http-client.ts`:
**Page → domain API adapter → shared transport → same-origin backend.**
Paths are relative to `/api/v1` and must start with a single `/`. Absolute (`https://…`), protocol-relative (`//…`), backslash and whitespace forms are rejected with a `TypeError` before anything is sent, so a bearer token never leaves the application.

## Common rules
- The session snapshot (`auth-session.ts`) is captured when the request starts. A `401` invalidates only that session, and only if it is still current (a newer login for the same user or token is untouched). Non-JSON `401` follows the same rule.
- `403`, `404`, `409`, `422`, `429`, `5xx`, network failures and cancellation never end the session.
- Errors reuse `ApiError { statusCode, code, message, details, requestId }`. Raw proxy HTML or provider text is never shown. Network failure = `ApiError` with `statusCode: undefined` and `NETWORK_ERROR`. Cancellation = `DOMException` named `AbortError` (check with `isAbortError`).
- No automatic retries.
- Redirects are not followed with credentials (`redirect: "manual"`); a redirect is `INVALID_API_RESPONSE`.

## Exports
```ts
import { requestBlob, uploadMultipart, requestStream, isAbortError, ApiError }
  from "@/api/http-client";
```

### `requestBlob(path, options?) → Promise<Blob>`
Authenticated GET of private bytes. Returns the real `Blob.type`. A `text/html` success (login page) is `INVALID_API_RESPONSE`. Object URLs, preview, download and their cleanup belong to the caller.
```ts
const blob = await requestBlob(`${base}/documents/${id}/content?download=false`, { signal });
```

### `uploadMultipart<T>(path, formData, options?) → Promise<T>`
XHR multipart POST (XHR is used because only it reports upload progress). The browser sets the multipart `Content-Type` and boundary. `options.onProgress({ loaded, total? })`; `total` is absent when the length is not computable (indeterminate). The promise resolves **only** after a 2xx `application/json` response: 100 % sent is not "saved" (show "Processing" until then). `signal` aborts the XHR; an already aborted signal sends nothing. Settles once; listeners removed on every exit path.
```ts
const doc = await uploadMultipart<DocumentSummary>(`${base}/documents`, form, { signal, onProgress });
```

### `requestStream(path, body, options?) → Promise<{ response, invalidateSession }>`
Authenticated JSON POST with `Accept: text/event-stream` (fetch, because `EventSource` cannot POST or send a bearer). Requires 2xx, `text/event-stream` (parameters allowed) and a readable body; otherwise the body is cancelled and a safe `ApiError` is thrown. The body is **not** read. `invalidateSession()` signs out only the session that opened the stream (for a later `ACCESS_TOKEN_EXPIRED` event); it never exposes the token. SSE decoding and event validation belong to TSE-81.
```ts
const { response, invalidateSession } = await requestStream(`${base}/assistant`, request, { signal });
const reader = response.body!.getReader();
```

## Tests and results
`frontend/test/api/http-client.test.ts` (incl. `requestBlob` and regressions), `xhr-upload.test.ts` (with `fake-xhr.ts`), `stream-transport.test.ts`.
Run: `make frontendcheck`, `make frontendtest`, `docker compose exec frontend npm run build`.

Integration with real consumers (TSE-79 upload/download, TSE-81 live stream/Stop) is **pending**: controlled doubles do not prove it.

## Documents UI: resources, roles and late responses (TSE-79)
- `documents.api.ts` is the only document network boundary: JSON list/DELETE use `apiGet`/`apiDelete`, upload uses `uploadMultipart`, bytes use `requestBlob`. It validates the document shapes (the transport only proves JSON).
- The role comes from `GET /organizations/:id` (`currentUserRole`), never from storage or the JWT. `OWNER`/`ADMIN` manage; `MEMBER` reads. While the role is unknown nothing is shown; a `403 INSUFFICIENT_ORGANIZATION_ROLE` hides management controls, aborts an active upload and re-reads the role. The backend stays authoritative.
- Every request is guarded twice: an `AbortController` (cancellation) and a scope check before applying a response (mounted, same organization/project because the page is keyed by them, same authentication session snapshot, latest list request). A response that had already resolved when the user navigated is therefore still ignored.
- Cleanup on close, document change, project change, sign-out and unmount: pending retrievals are aborted, PDF.js rendering is cancelled and its document destroyed, the canvas is zeroed, text and Blob references are dropped, and temporary download object URLs are revoked. Intentional aborts are handled and never reach the user as errors.
- Preview text is rendered with `<pre>` only (no HTML/Markdown conversion) and limited to the first 100 KiB; the cut never leaves a broken UTF-8 character.
- `Retry-After` for `429` is not shown: `ApiError` does not carry response headers, so the UI gives generic retry guidance.
