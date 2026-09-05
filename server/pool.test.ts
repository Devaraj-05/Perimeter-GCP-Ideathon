import { describe, it, expect } from 'vitest';
import { mapPool } from './pool';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mapPool', () => {
  it('preserves input order regardless of completion order', async () => {
    // The Reader's observations become the Planner's context. A context whose
    // contents shift between identical turns cannot be reasoned about.
    const out = await mapPool([50, 10, 30, 0], 4, async (ms, i) => {
      await tick(ms);
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it('never exceeds the concurrency limit', async () => {
    let live = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick(5);
      live--;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBe(4);
  });

  it('is actually concurrent, not a disguised serial loop', async () => {
    const started = Date.now();
    await mapPool(Array.from({ length: 8 }, () => 40), 8, async (ms) => tick(ms));
    // Serial would be ~320ms. Generous bound so this cannot flake on a slow box.
    expect(Date.now() - started).toBeLessThan(220);
  });

  it('handles an empty list without opening a worker', async () => {
    let calls = 0;
    expect(await mapPool([], 4, async () => calls++)).toEqual([]);
    expect(calls).toBe(0);
  });

  it('never opens more workers than there are items', async () => {
    let peak = 0;
    let live = 0;
    await mapPool([1, 2], 16, async () => {
      live++;
      peak = Math.max(peak, live);
      await tick(5);
      live--;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('treats a nonsense limit as one rather than throwing', async () => {
    for (const bad of [0, -3, NaN]) {
      expect(await mapPool([1, 2, 3], bad, async (n) => n * 2)).toEqual([2, 4, 6]);
    }
  });

  it('propagates a rejection', async () => {
    // The caller decides how to degrade. mapPool does not swallow failures,
    // because a Reader failure has to be counted, not hidden.
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});
