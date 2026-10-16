import { describe, it, expect } from 'vitest';
import {
  describeAssistantError,
  describeStreamErrorEvent,
} from '../../src/api/assistant-errors';
import { ApiError } from '../../src/api/http-client';
import { AssistantStreamError } from '../../src/api/assistant-stream';
import { AssistantRequestError } from '../../src/api/assistant.api';

const api = (status: number | undefined, code: string, requestId?: string, retryAfter?: number) =>
  new ApiError(status, code, 'raw server message', undefined, requestId, retryAfter);

const event = (code: string) => ({
  requestId: 'r1',
  code,
  message: 'raw server message',
  retryable: true,
});

describe('describeAssistantError : accès perdu', () => {
  it('401 : invalide la session et efface le contenu', () => {
    const f = describeAssistantError(api(401, 'UNAUTHORIZED'));
    expect(f.invalidateSession).toBe(true);
    expect(f.clearContent).toBe(true);
    expect(f.keepPartial).toBe(false);
  });

  it('ACCESS_TOKEN_EXPIRED reçu dans le flux : invalide la session', () => {
    const f = describeStreamErrorEvent(event('ACCESS_TOKEN_EXPIRED'));
    expect(f.invalidateSession).toBe(true);
    expect(f.clearContent).toBe(true);
  });

  it('404 PROJECT_NOT_FOUND : efface, prévient le dashboard, garde la session', () => {
    const f = describeAssistantError(api(404, 'PROJECT_NOT_FOUND'));
    expect(f.clearContent).toBe(true);
    expect(f.notifyProjectUnavailable).toBe(true);
    expect(f.invalidateSession).toBe(false);
  });

  it('PROJECT_NOT_FOUND reçu dans le flux : même comportement', () => {
    const f = describeStreamErrorEvent(event('PROJECT_NOT_FOUND'));
    expect(f.clearContent).toBe(true);
    expect(f.notifyProjectUnavailable).toBe(true);
    expect(f.invalidateSession).toBe(false);
  });

  it('403 défensif : efface le contenu, garde la session', () => {
    const f = describeAssistantError(api(403, 'FORBIDDEN'));
    expect(f.clearContent).toBe(true);
    expect(f.invalidateSession).toBe(false);
    expect(f.notifyProjectUnavailable).toBe(false);
  });
});

describe('describeAssistantError : erreurs récupérables', () => {
  const cases: [number, string, string][] = [
    [400, 'VALIDATION_ERROR', 'not accepted'],
    [413, 'PAYLOAD_TOO_LARGE', 'shorten'],
    [422, 'ASSISTANT_NO_DATA', 'No traces'],
    [422, 'ASSISTANT_CONTEXT_TOO_LARGE', 'Narrow'],
    [422, 'LLM_REFUSED', 'could not answer'],
    [429, 'ASSISTANT_ALREADY_RUNNING', 'already running'],
    [503, 'LLM_UNAVAILABLE', 'unavailable'],
    [503, 'LLM_PROVIDER_BUSY', 'capacity'],
    [502, 'LLM_PROVIDER_ERROR', 'incomplete'],
    [504, 'LLM_TIMEOUT', 'incomplete'],
    [500, 'INTERNAL_SERVER_ERROR', 'incomplete'],
  ];

  it.each(cases)('%i %s : message utile, session et contenu intacts', (status, code, text) => {
    const f = describeAssistantError(api(status, code));
    expect(f.message).toContain(text);
    expect(f.kind).toBe('failed');
    expect(f.clearContent).toBe(false);
    expect(f.keepPartial).toBe(true);
    expect(f.invalidateSession).toBe(false);
    expect(f.notifyProjectUnavailable).toBe(false);
  });

  it('ne reprend jamais le message brut du serveur', () => {
    const f = describeAssistantError(api(502, 'LLM_PROVIDER_ERROR'));
    expect(f.message).not.toContain('raw server message');
  });

  it("les erreurs du fournisseur ne déconnectent jamais l'utilisateur", () => {
    for (const code of ['LLM_UNAVAILABLE', 'LLM_PROVIDER_BUSY', 'LLM_PROVIDER_ERROR', 'LLM_TIMEOUT']) {
      expect(describeStreamErrorEvent(event(code)).invalidateSession).toBe(false);
    }
  });

  it('transmet le request id', () => {
    expect(describeAssistantError(api(502, 'LLM_PROVIDER_ERROR', 'req-9')).requestId).toBe('req-9');
    expect(describeStreamErrorEvent(event('LLM_TIMEOUT')).requestId).toBe('r1');
  });
});

describe('describeAssistantError : limite de débit', () => {
  it('429 RATE_LIMITED : affiche et expose le délai', () => {
    const f = describeAssistantError(api(429, 'RATE_LIMITED', undefined, 12));
    expect(f.waitSeconds).toBe(12);
    expect(f.message).toContain('12 seconds');
  });

  it('accorde le singulier pour 1 seconde', () => {
    expect(describeAssistantError(api(429, 'RATE_LIMITED', undefined, 1)).message).toContain('1 second.');
  });

  it('sans Retry-After : pas de délai inventé', () => {
    const f = describeAssistantError(api(429, 'RATE_LIMITED'));
    expect(f.waitSeconds).toBeUndefined();
  });

  it('ASSISTANT_ALREADY_RUNNING : pas de délai, pas de retry automatique', () => {
    const f = describeAssistantError(api(429, 'ASSISTANT_ALREADY_RUNNING'));
    expect(f.waitSeconds).toBeUndefined();
  });

  it('code inconnu avec statut 429 : traité comme une limite de débit', () => {
    const f = describeAssistantError(api(429, 'SOMETHING_ELSE', undefined, 5));
    expect(f.waitSeconds).toBe(5);
  });
});

describe('describeAssistantError : autres sources', () => {
  it('réseau coupé : interrupted, texte partiel conservé', () => {
    const f = describeAssistantError(api(undefined, 'NETWORK_ERROR'));
    expect(f.kind).toBe('interrupted');
    expect(f.keepPartial).toBe(true);
    expect(f.invalidateSession).toBe(false);
  });

  it('flux interrompu : interrupted', () => {
    const f = describeAssistantError(new AssistantStreamError('interrupted', 'x'));
    expect(f.kind).toBe('interrupted');
    expect(f.message).toContain('interrupted');
  });

  it('protocole ou limite dépassée : failed, réponse invalide', () => {
    for (const kind of ['protocol', 'limit'] as const) {
      const f = describeAssistantError(new AssistantStreamError(kind, 'x'));
      expect(f.kind).toBe('failed');
      expect(f.message).toContain('invalid response');
    }
  });

  it("erreur de requête locale : message de l'adaptateur", () => {
    const f = describeAssistantError(new AssistantRequestError('empty-question', 'Enter a question.'));
    expect(f.message).toBe('Enter a question.');
    expect(f.clearContent).toBe(false);
  });

  it("erreur inconnue : message sûr, rien d'interne affiché", () => {
    const f = describeAssistantError(new Error('secret internal stack'));
    expect(f.kind).toBe('failed');
    expect(f.message).not.toContain('secret');
    expect(f.invalidateSession).toBe(false);
  });

  it('code inconnu : échec générique sans effacer ni déconnecter', () => {
    const f = describeStreamErrorEvent(event('BRAND_NEW_CODE'));
    expect(f.kind).toBe('failed');
    expect(f.clearContent).toBe(false);
    expect(f.invalidateSession).toBe(false);
  });
});