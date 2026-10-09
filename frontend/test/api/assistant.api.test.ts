import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  askAssistant,
  buildAssistantBody,
  validateAssistantQuestion,
} from '../../src/api/assistant.api';
import { apiPostStream } from '../../src/api/http-client';
import { streamFromChunks, collect } from './helpers/stream';

vi.mock('../../src/api/http-client', () => ({ apiPostStream: vi.fn() }));

const FROM = '2026-09-28T00:00:00.000Z';
const TO = '2026-10-05T00:00:00.000Z';
const selection = { from: FROM, to: TO, filters: { provider: 'openai' } };

function mockStream(chunks: string[] = []) {
  vi.mocked(apiPostStream).mockResolvedValue({
    body: streamFromChunks(chunks),
    requestId: 'req-1',
    isSessionCurrent: () => true,
    invalidateSession: () => {},
  });
}

const startWith = (context: unknown) =>
  `event: start\ndata: ${JSON.stringify({
    requestId: 'r1', provider: 'gemini', model: 'm', context,
  })}\n\n`;
const DELTA = `event: delta\ndata: ${JSON.stringify({ text: 'Hi' })}\n\n`;
const DONE = `event: done\ndata: ${JSON.stringify({
  requestId: 'r1', finishReason: 'stop', usage: null,
})}\n\n`;

const okContext = {
  project: { id: 'p1', name: 'Demo', description: null },
  window: { from: FROM, to: TO },
  filters: { q: null, provider: 'openai', model: null, workflow: null, status: null },
};

const ask = (overrides: Record<string, unknown> = {}) =>
  askAssistant({
    organizationId: 'o1',
    projectId: 'p1',
    question: 'Which model costs most?',
    selection,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('buildAssistantBody', () => {
  it('construit exactement les 4 champs attendus', () => {
    const body = buildAssistantBody('  Hello  ', selection);
    expect(Object.keys(body)).toEqual(['question', 'from', 'to', 'filters']);
    expect(body).toEqual({
      question: 'Hello',
      from: FROM,
      to: TO,
      filters: { provider: 'openai' },
    });
  });

  it("envoie filters: {} quand aucun filtre n'est actif", () => {
    const body = buildAssistantBody('Q', { from: FROM, to: TO, filters: {} });
    expect(body.filters).toEqual({});
  });

  it('omet les filtres inactifs et garde la casse de workflow', () => {
    const body = buildAssistantBody('Q', {
      from: FROM,
      to: TO,
      filters: {
        q: '  ',
        provider: undefined,
        model: null,
        workflow: 'MyWorkflow',
        status: 'ERROR',
      } as never,
    });
    expect(body.filters).toEqual({ workflow: 'MyWorkflow', status: 'ERROR' });
  });

  it('ignore une valeur de status inconnue', () => {
    const body = buildAssistantBody('Q', {
      from: FROM, to: TO, filters: { status: 'WEIRD' } as never,
    });
    expect(body.filters).toEqual({});
  });

  it("refuse une question vide ou faite d'espaces", () => {
    expect(() => buildAssistantBody('   ', selection)).toThrowError(
      expect.objectContaining({ kind: 'empty-question' }),
    );
  });

  it('refuse une question de plus de 2000 caractères', () => {
    expect(() => buildAssistantBody('a'.repeat(2001), selection)).toThrowError(
      expect.objectContaining({ kind: 'question-too-long' }),
    );
    expect(() => buildAssistantBody('a'.repeat(2000), selection)).not.toThrow();
  });

  it('mesure le corps en octets : 2000 caractères peuvent dépasser 8 Kio', () => {
    // \u0001 fait 1 caractère mais 6 octets une fois écrit en JSON (\\u0001)
    expect(() => buildAssistantBody('\u0001'.repeat(2000), selection)).toThrowError(
      expect.objectContaining({ kind: 'body-too-large' }),
    );
  });

  it('refuse des dates qui ne sont pas des instants UTC en Z', () => {
    expect(() =>
      buildAssistantBody('Q', { ...selection, from: '2026-09-28T00:00:00+02:00' }),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-selection' }));
    expect(() =>
      buildAssistantBody('Q', { ...selection, to: 'pas une date' }),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-selection' }));
  });

  it('refuse from >= to', () => {
    expect(() =>
      buildAssistantBody('Q', { ...selection, from: TO, to: FROM }),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-selection' }));
    expect(() =>
      buildAssistantBody('Q', { ...selection, to: FROM }),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-selection' }));
  });

  it('accepte 90 jours exactement et refuse 91 jours', () => {
    const from = '2026-01-01T00:00:00.000Z';
    expect(() =>
      buildAssistantBody('Q', { from, to: '2026-04-01T00:00:00.000Z', filters: {} }),
    ).not.toThrow();
    expect(() =>
      buildAssistantBody('Q', { from, to: '2026-04-02T00:00:00.000Z', filters: {} }),
    ).toThrowError(expect.objectContaining({ kind: 'invalid-selection' }));
  });
});

describe('validateAssistantQuestion', () => {
  it('rend empty, too-long ou null', () => {
    expect(validateAssistantQuestion('  ')).toBe('empty');
    expect(validateAssistantQuestion('a'.repeat(2001))).toBe('too-long');
    expect(validateAssistantQuestion('ok')).toBeNull();
  });
});

describe('askAssistant', () => {
  it('appelle le bon chemin (IDs encodés) avec le corps exact et le signal', async () => {
    mockStream();
    const controller = new AbortController();
    await ask({
      organizationId: 'o/1',
      projectId: 'p 1',
      signal: controller.signal,
    });

    const [path, body, options] = vi.mocked(apiPostStream).mock.calls[0];
    expect(path).toBe('/organizations/o%2F1/projects/p%201/assistant');
    expect(body).toEqual({
      question: 'Which model costs most?',
      from: FROM,
      to: TO,
      filters: { provider: 'openai' },
    });
    expect(options).toEqual({ signal: controller.signal });
  });

  it("n'appelle pas le réseau quand la validation échoue", async () => {
    await expect(ask({ question: '   ' })).rejects.toMatchObject({
      kind: 'empty-question',
    });
    expect(apiPostStream).not.toHaveBeenCalled();
  });

  it('rend les événements quand le contexte correspond à la requête', async () => {
    mockStream([startWith(okContext), DELTA, DONE]);
    const { events } = await ask();
    const list = await collect(events);
    expect(list.map((e) => e.type)).toEqual(['start', 'delta', 'done']);
  });

  it('accepte des dates écrites autrement mais identiques (sans .000)', async () => {
    mockStream([
      startWith({
        ...okContext,
        window: { from: '2026-09-28T00:00:00Z', to: '2026-10-05T00:00:00Z' },
      }),
      DELTA,
      DONE,
    ]);
    const { events } = await ask();
    await expect(collect(events)).resolves.toHaveLength(3);
  });

  it("refuse un contexte d'un autre projet", async () => {
    mockStream([
      startWith({ ...okContext, project: { id: 'AUTRE', name: 'X', description: null } }),
      DELTA,
      DONE,
    ]);
    const { events } = await ask();
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it("refuse un contexte d'une autre période", async () => {
    mockStream([
      startWith({
        ...okContext,
        window: { from: '2026-01-01T00:00:00.000Z', to: TO },
      }),
      DELTA,
      DONE,
    ]);
    const { events } = await ask();
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it("refuse un contexte avec d'autres filtres", async () => {
    mockStream([
      startWith({ ...okContext, filters: { ...okContext.filters, provider: 'gemini' } }),
      DELTA,
      DONE,
    ]);
    const { events } = await ask();
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('refuse un contexte sans window', async () => {
    const { window: _unused, ...withoutWindow } = okContext;
    mockStream([startWith(withoutWindow), DELTA, DONE]);
    const { events } = await ask();
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it("laisse passer l'annulation si le signal est déjà annulé", async () => {
    mockStream([startWith(okContext), DELTA, DONE]);
    const controller = new AbortController();
    controller.abort();
    await expect(ask({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});