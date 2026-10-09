import type { AssistantEvent } from '../types/assistant.types';

export const MAX_FRAME_BYTES = 64 * 1024; // une trame
export const MAX_ANSWER_BYTES = 1024 * 1024; // texte cumulé de la réponse

const encoder = new TextEncoder();

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

export function extractFrames(buffer: string): { frames: string[]; rest: string } {
  const pending = buffer.endsWith('\r') ? '\r' : '';
  const text = (pending ? buffer.slice(0, -1) : buffer).replace(/\r\n/g, '\n');
  const parts = text.split('\n\n');
  const rest = parts.pop() ?? '';
  const frames = parts.filter((part) => part.length > 0);
  return { frames, rest: rest + pending };
}

export function parseFrame(frame: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);

    if (value.startsWith(' ')) value = value.slice(1);

    if (field === 'event') event = value;
    else if (field === 'data') dataLines.push(value);
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export class AssistantStreamError extends Error {
  constructor(
    public kind: 'protocol' | 'limit' | 'interrupted',
    message: string,
  ) {
    super(message);
    this.name = 'AssistantStreamError';
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function toEvent(name: string | undefined, data: string): AssistantEvent | null {
  if (name !== 'start' && name !== 'delta' && name !== 'done' && name !== 'error') {
    return null;
  }

  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new AssistantStreamError('protocol', `JSON invalide dans l'événement ${name}`);
  }

  const invalid = () =>
    new AssistantStreamError('protocol', `Forme invalide pour l'événement ${name}`);

  if (!isObject(json)) throw invalid();

  switch (name) {
    case 'start':
      if (
        typeof json.requestId === 'string' &&
        typeof json.provider === 'string' &&
        typeof json.model === 'string' &&
        isObject(json.context)
      ) {
        return {
          type: 'start',
          data: {
            requestId: json.requestId,
            provider: json.provider,
            model: json.model,
            context: json.context,
          },
        };
      }
      throw invalid();

    case 'delta':
      if (typeof json.text === 'string') {
        return { type: 'delta', data: { text: json.text } };
      }
      throw invalid();

    case 'done': {
      const usage = json.usage;
      const usageOk =
        usage === null ||
        (isObject(usage) &&
          typeof usage.inputTokens === 'number' &&
          typeof usage.outputTokens === 'number');
      if (
        typeof json.requestId === 'string' &&
        (json.finishReason === 'stop' || json.finishReason === 'length') &&
        usageOk
      ) {
        return {
          type: 'done',
          data: {
            requestId: json.requestId,
            finishReason: json.finishReason,
            usage: usage === null ? null : {
              inputTokens: (usage as Record<string, number>).inputTokens,
              outputTokens: (usage as Record<string, number>).outputTokens,
            },
          },
        };
      }
      throw invalid();
    }

    case 'error':
      if (
        typeof json.requestId === 'string' &&
        typeof json.code === 'string' &&
        typeof json.message === 'string' &&
        typeof json.retryable === 'boolean'
      ) {
        return {
          type: 'error',
          data: {
            requestId: json.requestId,
            code: json.code,
            message: json.message,
            retryable: json.retryable,
          },
        };
      }
      throw invalid();
  }
}

type Phase = 'awaiting-start' | 'streaming' | 'ended';

export async function* parseAssistantStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let phase = 'awaiting-start' as Phase;
  let receivedText = false;
  let requestId: string | null = null;
  let answerBytes = 0;

  // Vérifie que l'événement arrive au bon moment.
  function checkOrder(event: AssistantEvent): void {
    switch (event.type) {
      case 'start':
        if (phase !== 'awaiting-start') {
          throw new AssistantStreamError('protocol', 'start reçu deux fois');
        }
        requestId = event.data.requestId;
        phase = 'streaming';
        break;
      case 'delta':
        if (phase !== 'streaming') {
          throw new AssistantStreamError('protocol', 'delta reçu avant start');
        }
        if (event.data.text !== '') receivedText = true;
        answerBytes += byteLength(event.data.text);
        if (answerBytes > MAX_ANSWER_BYTES) {
          throw new AssistantStreamError('limit', 'réponse trop longue');
        }
        break;
      case 'done':
        if (phase !== 'streaming') {
          throw new AssistantStreamError('protocol', 'done reçu avant start');
        }
        if (event.data.requestId !== requestId) {
          throw new AssistantStreamError('protocol', 'requestId différent de start');
        }
        if (!receivedText) {
          throw new AssistantStreamError('protocol', 'réponse vide');
        }
        phase = 'ended';
        break;
      case 'error':
        // Un error avant start est accepté : il n'y a pas encore d'id à comparer.
        if (requestId !== null && event.data.requestId !== requestId) {
          throw new AssistantStreamError('protocol', 'requestId différent de start');
        }
        phase = 'ended';
        break;
    }
  }

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (e) {
        // Annulation volontaire : on la laisse remonter telle quelle.
        if (e instanceof DOMException && e.name === 'AbortError') throw e;
        throw new AssistantStreamError('interrupted', 'connexion interrompue');
      }

      if (result.done) break;

      try {
        buffer += decoder.decode(result.value, { stream: true });
      } catch {
        throw new AssistantStreamError('protocol', 'texte UTF-8 invalide');
      }

      const { frames, rest } = extractFrames(buffer);
      buffer = rest;

      for (const frame of frames) {
        // Limite : une trame complète ne dépasse pas 64 Kio.
        if (byteLength(frame) > MAX_FRAME_BYTES) {
          throw new AssistantStreamError('limit', 'trame trop grande');
        }

        const parsed = parseFrame(frame);
        if (!parsed) continue; // commentaire seul

        const event = toEvent(parsed.event, parsed.data);
        if (!event) continue; // événement inconnu : ignoré

        checkOrder(event);
        yield event;

        // Après done ou error, on arrête de lire.
        if (phase === 'ended') return;
      }

      // Limite : ce qui reste (trame pas finie) ne dépasse pas 64 Kio non plus.
      if (byteLength(buffer) > MAX_FRAME_BYTES) {
        throw new AssistantStreamError('limit', 'trame non terminée trop grande');
      }
    }

    // Le flux s'est arrêté sans done ni error : interruption.
    throw new AssistantStreamError('interrupted', 'flux terminé sans done ni error');
  } finally {
    // Quoi qu'il arrive, on libère la lecture.
    await reader.cancel().catch(() => {});
  }
}