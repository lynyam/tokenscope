// frontend/test/api/http-client-stream.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiPostStream, ApiError } from '../../src/api/http-client';
import { getAuthSessionSnapshot, invalidateAuthSession, isAuthSessionCurrent } from '../../src/api/auth-session';

// Replace the session module with a fake, to control the current session.
vi.mock('../../src/api/auth-session', () => ({
  getAuthSessionSnapshot: vi.fn(),
  invalidateAuthSession: vi.fn(),
  isAuthSessionCurrent: vi.fn(),
}));

const session1 = { token: 'tok-1' };
const session2 = { token: 'tok-2' };

// Builds a valid SSE response (status 200 + text/event-stream).
function sseResponse(init: { status?: number; contentType?: string } = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: start\n\n'));
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'Content-Type': init.contentType ?? 'text/event-stream; charset=utf-8',
      'X-Request-Id': 'req-1',
    },
  });
}

describe('apiPostStream', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAuthSessionSnapshot).mockReturnValue(session1 as never);
    // Same rule as the real function: a session is current while it is still the stored one.
    vi.mocked(isAuthSessionCurrent).mockImplementation(
      (snapshot) => (vi.mocked(getAuthSessionSnapshot)() as unknown) === snapshot,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('sends the POST with the token, the JSON body and the signal', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const controller = new AbortController();

    await apiPostStream('/x/assistant', { question: 'Hello' }, { signal: controller.signal });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/x/assistant');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(controller.signal);
    expect(init.body).toBe(JSON.stringify({ question: 'Hello' }));
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('returns the stream unread, with the request id', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});
    expect(result.requestId).toBe('req-1');
    expect(result.body).toBeInstanceOf(ReadableStream);
    expect(result.body.locked).toBe(false); // nobody read it
  });

  it('turns an initial JSON error into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'PROJECT_NOT_FOUND', message: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-2' },
      }),
    );
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({
      statusCode: 404,
      code: 'PROJECT_NOT_FOUND',
      requestId: 'req-2',
    });
  });

  it('exposes Retry-After on a 429', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'Too fast' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
      }),
    );
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 12,
    });
  });

  it('invalidates the captured session on a 401, even with a non-JSON body', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>unauthorized</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(apiPostStream('/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(invalidateAuthSession).toHaveBeenCalledWith(session1);
  });

  it('rejects a 200 response that is not an SSE stream', async () => {
    fetchMock.mockResolvedValue(sseResponse({ contentType: 'application/json' }));
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('isSessionCurrent becomes false when another session takes over', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});
    expect(result.isSessionCurrent()).toBe(true);

    vi.mocked(getAuthSessionSnapshot).mockReturnValue(session2 as never);
    expect(result.isSessionCurrent()).toBe(false);
  });

  it('invalidateSession invalidates the original session, not the new one', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});

    vi.mocked(getAuthSessionSnapshot).mockReturnValue(session2 as never);
    result.invalidateSession();

    expect(invalidateAuthSession).toHaveBeenCalledWith(session1);
    expect(invalidateAuthSession).not.toHaveBeenCalledWith(session2);
  });

  it('lets a deliberate abort through without wrapping it', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({ name: 'AbortError' });
  });
});