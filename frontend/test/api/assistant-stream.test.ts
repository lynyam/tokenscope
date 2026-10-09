// frontend/test/api/assistant-stream.test.ts
import { describe, it, expect } from 'vitest';
import {
  extractFrames,
  parseFrame,
  toEvent,
  parseAssistantStream,
  AssistantStreamError,
} from '../../src/api/assistant-stream';
import { streamFromChunks, collect } from './helpers/stream';

// ---------------------------------------------------------------
// extractFrames : couper le texte en messages complets + reste
// ---------------------------------------------------------------
describe('extractFrames', () => {
  it('sépare les messages complets et garde le reste', () => {
    const result = extractFrames('event: a\n\nevent: b\n\nevent: c');
    expect(result).toEqual({
      frames: ['event: a', 'event: b'],
      rest: 'event: c',
    });
  });

  it('ne rend aucun message tant que la ligne vide manque', () => {
    expect(extractFrames('event: a\ndata: 1')).toEqual({
      frames: [],
      rest: 'event: a\ndata: 1',
    });
  });

  it('gère les fins de ligne \\r\\n', () => {
    expect(extractFrames('event: a\r\n\r\nevent: b')).toEqual({
      frames: ['event: a'],
      rest: 'event: b',
    });
  });

  it('gère un \\r\\n coupé entre deux morceaux', () => {
    const first = extractFrames('event: a\r\n\r');
    expect(first.frames).toEqual([]);

    const second = extractFrames(first.rest + '\nevent: b\n\n');
    expect(second.frames).toEqual(['event: a', 'event: b']);
  });

  it('ignore les lignes vides en trop', () => {
    expect(extractFrames('event: a\n\n\n\nevent: b\n\n')).toEqual({
      frames: ['event: a', 'event: b'],
      rest: '',
    });
  });
});

// ---------------------------------------------------------------
// parseFrame : lire un message (nom + données)
// ---------------------------------------------------------------
describe('parseFrame', () => {
  it('lit le nom et les données', () => {
    expect(parseFrame('event: delta\ndata: {"text":"Bonjour"}')).toEqual({
      event: 'delta',
      data: '{"text":"Bonjour"}',
    });
  });

  it('ignore les commentaires', () => {
    expect(parseFrame(': ping\nevent: delta\ndata: x')).toEqual({
      event: 'delta',
      data: 'x',
    });
  });

  it("rend null quand il n'y a pas de data", () => {
    expect(parseFrame(': ping')).toBeNull();
  });

  it('recolle plusieurs lignes data', () => {
    expect(parseFrame('event: delta\ndata: a\ndata: b')).toEqual({
      event: 'delta',
      data: 'a\nb',
    });
  });
});

// ---------------------------------------------------------------
// toEvent : texte JSON -> événement typé et validé
// ---------------------------------------------------------------
describe('toEvent', () => {
  it('lit un delta', () => {
    expect(toEvent('delta', '{"text":"Bonjour"}')).toEqual({
      type: 'delta',
      data: { text: 'Bonjour' },
    });
  });

  it('lit un start', () => {
    const data = JSON.stringify({
      requestId: 'r1', provider: 'gemini', model: 'm', context: { a: 1 },
    });
    expect(toEvent('start', data)).toEqual({
      type: 'start',
      data: { requestId: 'r1', provider: 'gemini', model: 'm', context: { a: 1 } },
    });
  });

  it('lit un done avec usage null', () => {
    const data = JSON.stringify({ requestId: 'r1', finishReason: 'length', usage: null });
    expect(toEvent('done', data)).toEqual({
      type: 'done',
      data: { requestId: 'r1', finishReason: 'length', usage: null },
    });
  });

  it('lit un error', () => {
    const data = JSON.stringify({
      requestId: 'r1', code: 'LLM_TIMEOUT', message: 'trop long', retryable: true,
    });
    expect(toEvent('error', data)?.type).toBe('error');
  });

  it('ignore un événement inconnu', () => {
    expect(toEvent('truc', '{}')).toBeNull();
    expect(toEvent(undefined, '{}')).toBeNull();
  });

  it('refuse un JSON invalide', () => {
    expect(() => toEvent('delta', '{pas du json')).toThrow(AssistantStreamError);
  });

  it('refuse un delta sans texte', () => {
    expect(() => toEvent('delta', '{"autre":1}')).toThrow(AssistantStreamError);
  });

  it('refuse un finishReason inconnu', () => {
    const data = JSON.stringify({ requestId: 'r1', finishReason: 'bizarre', usage: null });
    expect(() => toEvent('done', data)).toThrow(AssistantStreamError);
  });

  it("refuse un start dont le context n'est pas un objet", () => {
    const data = JSON.stringify({
      requestId: 'r1', provider: 'gemini', model: 'm', context: 'texte',
    });
    expect(() => toEvent('start', data)).toThrow(AssistantStreamError);
  });
});

// ---------------------------------------------------------------
// parseAssistantStream : la boucle complète
// ---------------------------------------------------------------
const START = `event: start\ndata: ${JSON.stringify({
  requestId: 'r1', provider: 'gemini', model: 'm', context: {},
})}\n\n`;

const delta = (text: string) =>
  `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;

const DONE = `event: done\ndata: ${JSON.stringify({
  requestId: 'r1', finishReason: 'stop', usage: null,
})}\n\n`;

const ERROR = `event: error\ndata: ${JSON.stringify({
  requestId: 'r1', code: 'LLM_TIMEOUT', message: 'trop long', retryable: true,
})}\n\n`;

describe('parseAssistantStream', () => {
  it("lit start, delta, done dans l'ordre", async () => {
    const body = streamFromChunks([START, delta('Bonjour'), DONE]);
    const events = await collect(parseAssistantStream(body));
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'done']);
  });

  it('recolle un message coupé en plusieurs morceaux', async () => {
    const all = START + delta('Bonjour') + DONE;
    const body = streamFromChunks([all.slice(0, 20), all.slice(20, 75), all.slice(75)]);
    const events = await collect(parseAssistantStream(body));
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'done']);
  });

  it('lit plusieurs messages arrivés dans un seul morceau', async () => {
    const body = streamFromChunks([START + delta('a') + delta('b') + DONE]);
    const events = await collect(parseAssistantStream(body));
    expect(events).toHaveLength(4);
  });

  it('gère un caractère multi-octets coupé en deux', async () => {
    const bytes = new TextEncoder().encode(delta('é'));
    const cut = bytes.indexOf(0xc3) + 1; // coupe au milieu du "é"
    const body = streamFromChunks([START, bytes.slice(0, cut), bytes.slice(cut), DONE]);
    const events = await collect(parseAssistantStream(body));
    const d = events.find((e) => e.type === 'delta');
    expect(d && d.type === 'delta' && d.data.text).toBe('é');
  });

  it('ignore un événement inconnu', async () => {
    const unknown = 'event: truc\ndata: {}\n\n';
    const body = streamFromChunks([START, unknown, delta('a'), DONE]);
    const events = await collect(parseAssistantStream(body));
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'done']);
  });

  it('accepte une erreur après du texte', async () => {
    const body = streamFromChunks([START, delta('début'), ERROR]);
    const events = await collect(parseAssistantStream(body));
    expect(events.map((e) => e.type)).toEqual(['start', 'delta', 'error']);
  });

  it('refuse un delta avant start', async () => {
    const body = streamFromChunks([delta('a'), DONE]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'protocol',
    });
  });

  it('refuse un start en double', async () => {
    const body = streamFromChunks([START, START, delta('a'), DONE]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'protocol',
    });
  });

  it('refuse une réponse vide', async () => {
    const body = streamFromChunks([START, DONE]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'protocol',
    });
  });

  it('signale une interruption si le flux finit sans done ni error', async () => {
    const body = streamFromChunks([START, delta('a')]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'interrupted',
    });
  });

  it('signale une interruption si le réseau tombe en route', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(START));
        controller.error(new TypeError('network error'));
      },
    });
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'interrupted',
    });
  });

  it('refuse un done dont le requestId diffère de start', async () => {
    const otherDone = `event: done\ndata: ${JSON.stringify({
      requestId: 'autre', finishReason: 'stop', usage: null,
    })}\n\n`;
    const body = streamFromChunks([START, delta('a'), otherDone]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'protocol',
    });
  });

  it('refuse un error dont le requestId diffère de start', async () => {
    const otherError = `event: error\ndata: ${JSON.stringify({
      requestId: 'autre', code: 'LLM_TIMEOUT', message: 'x', retryable: true,
    })}\n\n`;
    const body = streamFromChunks([START, delta('a'), otherError]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'protocol',
    });
  });
});

  it('refuse une trame de plus de 64 Kio', async () => {
    const big = `event: delta\ndata: ${JSON.stringify({ text: 'a'.repeat(70 * 1024) })}\n\n`;
    const body = streamFromChunks([START, big]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'limit',
    });
  });

  it('refuse une trame jamais terminée de plus de 64 Kio', async () => {
    const body = streamFromChunks([START, 'event: delta\ndata: ' + 'a'.repeat(70 * 1024)]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'limit',
    });
  });

  it('compte les octets et pas les caractères', async () => {
    // 40 000 "é" = 40 000 caractères mais 80 000 octets
    const big = `event: delta\ndata: ${JSON.stringify({ text: 'é'.repeat(40 * 1000) })}\n\n`;
    const body = streamFromChunks([START, big]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'limit',
    });
  });

  it('refuse une réponse cumulée de plus de 1 Mio', async () => {
    const chunk = delta('a'.repeat(30 * 1024)); // chaque trame reste sous 64 Kio
    const frames = Array.from({ length: 36 }, () => chunk); // 36 x 30 Kio > 1 Mio
    const body = streamFromChunks([START, ...frames, DONE]);
    await expect(collect(parseAssistantStream(body))).rejects.toMatchObject({
      kind: 'limit',
    });
  });

  it('accepte un gros morceau réseau qui contient beaucoup de petites trames', async () => {
    // Le morceau fait plus de 64 Kio au total, mais chaque trame est minuscule.
    const many = Array.from({ length: 3000 }, () => delta('a')).join('');
    const body = streamFromChunks([START + many + DONE]);
    const events = await collect(parseAssistantStream(body));
    expect(events).toHaveLength(3002); // start + 3000 delta + done
  });