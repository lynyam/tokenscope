import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RefreshScheduler } from '../../src/lib/refresh-scheduler';

// A run that stays pending until the test finishes it.
function controlledRun() {
  const calls: { signal: AbortSignal; finish: () => void; fail: (error: unknown) => void }[] = [];
  const run = vi.fn((signal: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      calls.push({ signal, finish: resolve, fail: reject });
    });
  });
  return { run, calls };
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RefreshScheduler : regroupement', () => {
  it('une rafale de notifications donne UNE seule requête', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    for (let i = 0; i < 5; i++) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(1);
    calls[0].finish();
    await settle();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('des événements continus ne repoussent pas le rafraîchissement indéfiniment', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run, coalesceMs: 250, maxWaitMs: 1000 });
    // un événement toutes les 100 ms pendant 3 secondes
    for (let t = 0; t < 3000; t += 100) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(100);
      if (run.mock.calls.length > 0) break;
    }
    expect(run).toHaveBeenCalledTimes(1);
    // lancé au plus tard à ~1 s, pas à 3 s
    expect(Date.now() - new Date('2026-10-18T10:00:00.000Z').getTime()).toBeLessThanOrEqual(1100);
    calls[0].finish();
  });

  it('un rafraîchissement immédiat part sans attendre et n\'est pas repoussé par des événements', async () => {
    const { run } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    scheduler.request(); // un événement juste après
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshScheduler : une seule requête à la fois', () => {
  it('les déclencheurs pendant une requête donnent au plus UN suivi', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    expect(run).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) scheduler.request();
    scheduler.request('immediate');
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(1); // toujours une seule en vol
    expect(scheduler.isRunning).toBe(true);

    calls[0].finish();
    await settle();
    expect(run).toHaveBeenCalledTimes(2); // le suivi

    calls[1].finish();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2); // pas de troisième
  });

  it('sans déclencheur pendant la requête, aucun suivi', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('RefreshScheduler : erreurs', () => {
  it('429 avec Retry-After : aucune requête avant la fin du délai', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    calls[0].fail({ statusCode: 429, retryAfterSeconds: 8 });
    await settle();

    scheduler.request('immediate');
    await vi.advanceTimersByTimeAsync(7000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('429 sans Retry-After : délai par défaut de 5 s', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    calls[0].fail({ statusCode: 429 });
    await settle();
    scheduler.request('immediate');
    await vi.advanceTimersByTimeAsync(4000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not shorten the server Retry-After', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    calls[0].fail({ statusCode: 429, retryAfterSeconds: 600 });
    await settle();
    scheduler.request('immediate');
    await vi.advanceTimersByTimeAsync(599_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(2);
    scheduler.dispose();
  });

  it('une panne réseau ne relance rien toute seule (pas de boucle)', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    scheduler.request(); // dirty pendant la requête
    calls[0].fail(new Error('network'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);

    // le prochain déclencheur (tick de 30 s, focus, bouton) réessaie
    scheduler.request('immediate');
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('RefreshScheduler : nettoyage', () => {
  it('dispose annule la requête en cours et le minuteur', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    scheduler.request();
    scheduler.dispose();
    expect(calls[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('après dispose, request ne fait plus rien', async () => {
    const { run } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.dispose();
    scheduler.request('immediate');
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
  });

  it('une requête qui se termine après dispose ne programme pas de suivi', async () => {
    const { run, calls } = controlledRun();
    const scheduler = new RefreshScheduler({ run });
    scheduler.request('immediate');
    await settle();
    scheduler.request();
    scheduler.dispose();
    calls[0].finish();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
