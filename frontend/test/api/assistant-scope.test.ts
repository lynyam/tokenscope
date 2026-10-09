import { describe, it, expect } from 'vitest';
import { assistantScopeKey } from '../../src/api/assistant-scope';

const base = {
  organizationId: 'o1',
  projectId: 'p1',
  from: '2026-09-28T00:00:00.000Z',
  to: '2026-10-05T00:00:00.000Z',
  filters: { provider: 'openai' },
};

describe('assistantScopeKey', () => {
  it('donne la même clé pour la même portée', () => {
    expect(assistantScopeKey(base)).toBe(assistantScopeKey({ ...base }));
  });

  it("ne dépend pas de l'identité de l'objet filtres", () => {
    expect(assistantScopeKey(base)).toBe(
      assistantScopeKey({ ...base, filters: { provider: 'openai' } }),
    );
  });

  it("change quand l'organisation change", () => {
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, organizationId: 'o2' }),
    );
  });

  it('change quand le projet change', () => {
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, projectId: 'p2' }),
    );
  });

  it('change quand une date change', () => {
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, to: '2026-10-06T00:00:00.000Z' }),
    );
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, from: '2026-09-29T00:00:00.000Z' }),
    );
  });

  it('change quand un filtre change', () => {
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, filters: { provider: 'gemini' } }),
    );
    expect(assistantScopeKey(base)).not.toBe(
      assistantScopeKey({ ...base, filters: { provider: 'openai', status: 'ERROR' } }),
    );
  });

  it('traite pareil la même date écrite avec ou sans millisecondes', () => {
    expect(assistantScopeKey(base)).toBe(
      assistantScopeKey({
        ...base,
        from: '2026-09-28T00:00:00Z',
        to: '2026-10-05T00:00:00Z',
      }),
    );
  });

  it("ignore l'ordre des filtres et les filtres vides", () => {
    const a = assistantScopeKey({
      ...base,
      filters: { provider: 'openai', status: 'ERROR' },
    });
    const b = assistantScopeKey({
      ...base,
      filters: { status: 'ERROR', provider: 'openai', model: '  ' } as never,
    });
    expect(a).toBe(b);
  });

  it('garde la casse de workflow', () => {
    expect(assistantScopeKey({ ...base, filters: { workflow: 'Daily' } })).not.toBe(
      assistantScopeKey({ ...base, filters: { workflow: 'daily' } }),
    );
  });
});