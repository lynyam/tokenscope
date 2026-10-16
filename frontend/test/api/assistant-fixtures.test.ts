// Tests built on the shared backend fixtures (TSE-80): fixtures/evaluation/assistant/
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AssistantStreamError,
  parseAssistantStream,
} from '../../src/api/assistant-stream';
import { askAssistant, buildAssistantBody } from '../../src/api/assistant.api';
import { apiPostStream } from '../../src/api/http-client';
import type { AssistantEvent } from '../../src/types/assistant.types';
import { streamFromChunks, collect } from './helpers/stream';
import { readFixture } from './helpers/fixtures';

const successSse = readFixture('success.sse');
const partialTimeoutSse = readFixture('partial-timeout.sse');
const lengthSse = readFixture('length.sse');
const refusalSse = readFixture('refusal.sse');
const unexpectedEofSse = readFixture('unexpected-eof.sse');
const contextJson = readFixture('context.json');
const requestJson = readFixture('request.json');
const boundariesJson = readFixture('chunk-boundaries.json');

vi.mock('../../src/api/http-client', () => ({ apiPostStream: vi.fn() }));

const context = JSON.parse(contextJson);
const request = JSON.parse(requestJson);
const boundaries = JSON.parse(boundariesJson) as { splitAtByteOffsets: number[] };

const encode = (text: string) => new TextEncoder().encode(text);

// Cuts the BYTES of a text at the given offsets (this can cut inside a character).
function cutBytes(text: string, offsets: number[]): Uint8Array[] {
  const bytes = encode(text);
  const points = [0, ...offsets, bytes.length];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    chunks.push(bytes.slice(points[i], points[i + 1]));
  }
  return chunks;
}

const types = (events: AssistantEvent[]) => events.map((e) => e.type);

describe('fixture success.sse', () => {
  it('start, delta, delta, done avec le contexte exact du backend', async () => {
    const events = await collect(parseAssistantStream(streamFromChunks([successSse])));
    expect(types(events)).toEqual(['start', 'delta', 'delta', 'done']);

    const start = events[0];
    expect(start.type === 'start' && start.data.context).toEqual(context);
    expect(start.type === 'start' && start.data.requestId).toBe('assistant-demo-001');

    const text = events
      .map((e) => (e.type === 'delta' ? e.data.text : ''))
      .join('');
    expect(text).toContain('fixture-b/demo-large');
    expect(text).toContain('Café and €'); // UTF-8 multi-octets

    const done = events[3];
    expect(done.type === 'done' && done.data.finishReason).toBe('stop');
    expect(done.type === 'done' && done.data.usage).toBeNull();
  });

  it('le contexte contient les valeurs de référence (golden)', () => {
    expect(context.summary.traceCount).toBe(6);
    expect(context.summary.inputTokens).toBe('6000');
    expect(context.summary.outputTokens).toBe('1200');
    expect(context.summary.totalTokens).toBe('7200');
    expect(context.summary.estimatedCostUsd).toBe('0.015350000000');
  });

  it('donne le même résultat coupé aux positions de chunk-boundaries.json', async () => {
    const whole = await collect(parseAssistantStream(streamFromChunks([successSse])));
    const cut = await collect(
      parseAssistantStream(streamFromChunks(cutBytes(successSse, boundaries.splitAtByteOffsets))),
    );
    expect(cut).toEqual(whole);
  });

  it('donne le même résultat pour CHAQUE position de coupure possible', async () => {
    const whole = await collect(parseAssistantStream(streamFromChunks([successSse])));
    const total = encode(successSse).length;
    for (let offset = 1; offset < total; offset++) {
      const cut = await collect(
        parseAssistantStream(streamFromChunks(cutBytes(successSse, [offset]))),
      );
      expect(cut).toEqual(whole);
    }
  });

  it('donne le même résultat octet par octet', async () => {
    const whole = await collect(parseAssistantStream(streamFromChunks([successSse])));
    const total = encode(successSse).length;
    const everyByte = Array.from({ length: total - 1 }, (_, i) => i + 1);
    const cut = await collect(parseAssistantStream(streamFromChunks(cutBytes(successSse, everyByte))));
    expect(cut).toEqual(whole);
  });

  it('accepte les fins de ligne CRLF', async () => {
    const whole = await collect(parseAssistantStream(streamFromChunks([successSse])));
    const crlf = await collect(
      parseAssistantStream(streamFromChunks([successSse.replace(/\n/g, '\r\n')])),
    );
    expect(crlf).toEqual(whole);
  });
});

describe('autres fixtures', () => {
  it('partial-timeout.sse : du texte puis une erreur LLM_TIMEOUT', async () => {
    const events = await collect(parseAssistantStream(streamFromChunks([partialTimeoutSse])));
    expect(types(events)).toEqual(['start', 'delta', 'error']);
    const last = events[2];
    expect(last.type === 'error' && last.data.code).toBe('LLM_TIMEOUT');
    expect(last.type === 'error' && last.data.retryable).toBe(true);
  });

  it('length.sse : done avec finishReason length', async () => {
    const events = await collect(parseAssistantStream(streamFromChunks([lengthSse])));
    expect(types(events)).toEqual(['start', 'delta', 'done']);
    const done = events[2];
    expect(done.type === 'done' && done.data.finishReason).toBe('length');
  });

  it('refusal.sse : start puis erreur LLM_REFUSED, sans texte', async () => {
    const events = await collect(parseAssistantStream(streamFromChunks([refusalSse])));
    expect(types(events)).toEqual(['start', 'error']);
    const last = events[1];
    expect(last.type === 'error' && last.data.code).toBe('LLM_REFUSED');
    expect(last.type === 'error' && last.data.retryable).toBe(false);
  });

  it('unexpected-eof.sse : le texte arrive puis le flux est déclaré interrompu', async () => {
    const received: string[] = [];
    let failure: unknown;
    try {
      for await (const event of parseAssistantStream(streamFromChunks([unexpectedEofSse]))) {
        received.push(event.type);
      }
    } catch (error) {
      failure = error;
    }
    expect(received).toEqual(['start', 'delta']);
    expect(failure).toBeInstanceOf(AssistantStreamError);
    expect((failure as AssistantStreamError).kind).toBe('interrupted');
  });
});

describe('request.json et adaptateur', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const selection = { from: request.from, to: request.to, filters: request.filters };

  function mockServer(sse: string) {
    vi.mocked(apiPostStream).mockResolvedValue({
      body: streamFromChunks([sse]),
      requestId: 'req-1',
      isSessionCurrent: () => true,
      invalidateSession: () => {},
    });
  }

  const ask = (overrides: Record<string, unknown> = {}) =>
    askAssistant({
      organizationId: 'o1',
      projectId: context.project.id,
      question: request.question,
      selection,
      ...overrides,
    });

  it('construit exactement le corps de request.json (mêmes champs, même ordre)', () => {
    const body = buildAssistantBody(request.question, selection);
    expect(body).toEqual(request);
    expect(Object.keys(body)).toEqual(Object.keys(request));
  });

  it('envoie le corps de request.json au bon chemin', async () => {
    mockServer(successSse);
    await ask();
    const [path, body] = vi.mocked(apiPostStream).mock.calls[0];
    expect(path).toBe(`/organizations/o1/projects/${context.project.id}/assistant`);
    expect(body).toEqual(request);
  });

  it('accepte le vrai contexte du backend pour cette requête', async () => {
    mockServer(successSse);
    const { events } = await ask();
    expect(types(await collect(events))).toEqual(['start', 'delta', 'delta', 'done']);
  });

  it('refuse ce contexte si on demandait un autre projet', async () => {
    mockServer(successSse);
    const { events } = await ask({ projectId: '30000000-0000-4000-8000-0000000000ff' });
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('refuse ce contexte si on demandait une autre période', async () => {
    mockServer(successSse);
    const { events } = await ask({
      selection: { ...selection, to: '2026-10-03T00:00:00.000Z' },
    });
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it('refuse ce contexte si on demandait un filtre que le contexte ne reflète pas', async () => {
    mockServer(successSse);
    const { events } = await ask({
      selection: { ...selection, filters: { provider: 'openai' } },
    });
    await expect(collect(events)).rejects.toMatchObject({ kind: 'protocol' });
  });
});