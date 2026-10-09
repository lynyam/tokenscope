// frontend/test/api/http-client-stream.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiPostStream, ApiError } from '../../src/api/http-client';
import { getAuthSessionSnapshot, invalidateAuthSession } from '../../src/api/auth-session';

// On remplace le module de session par un faux, pour contrôler la session courante.
vi.mock('../../src/api/auth-session', () => ({
  getAuthSessionSnapshot: vi.fn(),
  invalidateAuthSession: vi.fn(),
}));

const session1 = { token: 'tok-1' };
const session2 = { token: 'tok-2' };

// Fabrique une réponse SSE valide (statut 200 + type text/event-stream).
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    fetchMock.mockReset();
  });

  it('envoie le POST avec le token, le corps JSON et le signal', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const controller = new AbortController();

    await apiPostStream('/x/assistant', { question: 'Salut' }, { signal: controller.signal });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/x/assistant');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(controller.signal);
    expect(init.body).toBe(JSON.stringify({ question: 'Salut' }));
    const headers = init.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok-1');
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('rend le flux sans le lire, avec le request id', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});
    expect(result.requestId).toBe('req-1');
    expect(result.body).toBeInstanceOf(ReadableStream);
    expect(result.body.locked).toBe(false); // personne ne l'a lu
  });

  it('transforme une erreur JSON initiale en ApiError', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'PROJECT_NOT_FOUND', message: 'Introuvable' }), {
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

  it('expose Retry-After sur un 429', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'RATE_LIMITED', message: 'Trop vite' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '12' },
      }),
    );
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 12,
    });
  });

  it('invalide la session capturée sur un 401, même non JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>unauthorized</html>', {
        status: 401,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    await expect(apiPostStream('/x', {})).rejects.toBeInstanceOf(ApiError);
    expect(invalidateAuthSession).toHaveBeenCalledWith(session1);
  });

  it("refuse une réponse 200 qui n'est pas un flux SSE", async () => {
    fetchMock.mockResolvedValue(sseResponse({ contentType: 'application/json' }));
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({
      code: 'INVALID_API_RESPONSE',
    });
  });

  it('isSessionCurrent devient faux quand une autre session prend la place', async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});
    expect(result.isSessionCurrent()).toBe(true);

    vi.mocked(getAuthSessionSnapshot).mockReturnValue(session2 as never);
    expect(result.isSessionCurrent()).toBe(false);
  });

  it("invalidateSession invalide la session d'origine, pas la nouvelle", async () => {
    fetchMock.mockResolvedValue(sseResponse());
    const result = await apiPostStream('/x', {});

    vi.mocked(getAuthSessionSnapshot).mockReturnValue(session2 as never);
    result.invalidateSession();

    expect(invalidateAuthSession).toHaveBeenCalledWith(session1);
    expect(invalidateAuthSession).not.toHaveBeenCalledWith(session2);
  });

  it('laisse passer une annulation volontaire sans la transformer', async () => {
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(apiPostStream('/x', {})).rejects.toMatchObject({ name: 'AbortError' });
  });
});