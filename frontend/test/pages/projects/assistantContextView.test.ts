import { describe, it, expect } from 'vitest';
import {
  buildContextView,
  formatUsd,
  NO_OBSERVATIONS,
} from '../../../src/pages/projects/assistantContextView';
import { readEvaluationFixture } from '../../api/helpers/evaluation-fixtures';

const contextJson = readEvaluationFixture('assistant/context.json');

const context = JSON.parse(contextJson);

describe('buildContextView avec le contexte du backend', () => {
  const view = buildContextView(context);
  const row = (label: string) => view.rows.find((r) => r.label === label)?.value;

  it('affiche le projet, la période UTC, les filtres et l\'heure de génération', () => {
    expect(view.projectName).toBe('Support Golden');
    expect(view.period).toBe('2026-10-01T00:00:00.000Z → 2026-10-02T00:00:00.000Z (UTC)');
    expect(view.filters).toBe('No filters');
    expect(view.generatedAt).toBe('2026-10-02T08:00:00.000Z');
  });

  it('affiche les chiffres de référence', () => {
    expect(row('Matching traces')).toBe('6');
    expect(row('Estimated cost')).toBe('$0.01535');
    expect(row('Tokens')).toBe('6,000 in · 1,200 out · 7,200 total');
    expect(row('Errors')).toBe('2');
    expect(row('Error rate')).toBe('33.33%');
    expect(row('Average latency')).toBe('1833.333 ms');
  });

  it('indique le prix synthétique', () => {
    expect(view.syntheticPricing).toBe(true);
  });

  it('liste les modèles', () => {
    expect(view.models).toEqual([
      { name: 'fixture-b/demo-large', details: '3 traces · $0.0082 · 2,500 in / 400 out' },
      { name: 'fixture-a/demo-fast', details: '3 traces · $0.00715 · 3,500 in / 800 out' },
    ]);
  });
});

describe('buildContextView : valeurs inconnues et filtres', () => {
  it('null reste "No observations" et ne devient jamais 0', () => {
    const view = buildContextView({
      ...context,
      summary: { ...context.summary, errorRatePct: null, averageLatencyMs: null },
    });
    const row = (label: string) => view.rows.find((r) => r.label === label)?.value;
    expect(row('Error rate')).toBe(NO_OBSERVATIONS);
    expect(row('Average latency')).toBe(NO_OBSERVATIONS);
  });

  it('0 reste 0', () => {
    const view = buildContextView({
      ...context,
      summary: { ...context.summary, errorCount: 0, errorRatePct: 0 },
    });
    const row = (label: string) => view.rows.find((r) => r.label === label)?.value;
    expect(row('Errors')).toBe('0');
    expect(row('Error rate')).toBe('0%');
  });

  it('affiche les filtres actifs seulement', () => {
    const view = buildContextView({
      ...context,
      filters: { q: null, provider: 'openai', model: null, workflow: 'Daily', status: 'ERROR' },
    });
    expect(view.filters).toBe('provider: openai · workflow: Daily · status: ERROR');
  });


});

describe('formatUsd', () => {
  it('retire les zéros de fin mais garde 2 décimales', () => {
    expect(formatUsd('0.015350000000')).toBe('$0.01535');
    expect(formatUsd('1.500000000000')).toBe('$1.50');
    expect(formatUsd('0.000000000000')).toBe('$0.00');
  });

  it('ne montre jamais un petit coût positif comme $0.00', () => {
    expect(formatUsd('0.000000000001')).toBe('$0.000000000001');
  });

  it('uses the same exact cost representation as the dashboard', () => {
    expect(formatUsd('12345.670000000000')).toBe('$12345.67');
  });

  it('null reste "No observations"', () => {
    expect(formatUsd(null)).toBe(NO_OBSERVATIONS);
  });
});