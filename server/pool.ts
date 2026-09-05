/**
 * Bounded-concurrency map, order preserving.
 *
 * The airlock read every untrusted artifact in a `for` loop with an `await`
 * inside it, so a turn cost one Gemini round trip per connected source,
 * serially. With eighteen sources that was a measured 2.9 minutes before the
 * Planner had been called at all, for a one-line question.
 *
 * Bounded rather than unbounded: `Promise.all` over every artifact would open
 * as many concurrent model calls as the user has sources, which is the fastest
 * way to spend a per-minute quota and turn a slow turn into a failed one.
 *
 * Order preserving because the Reader's observations are assembled into the
 * Planner's context, and a context whose contents shift between identical
 * turns is one nobody can reason about or reproduce.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));

  const results = new Array<R>(items.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
