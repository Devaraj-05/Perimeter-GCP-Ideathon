import { describe, it, expect } from 'vitest';
import { cosineSimilarity, embeddingModel } from './gemini';

/**
 * Embedding maths — Amendment P. The embedText call itself hits the network
 * and is not unit-tested; the ranking maths it feeds is pure and is.
 */
describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('ranks a closer vector higher', () => {
    const q = [1, 1, 0];
    const near = cosineSimilarity(q, [1, 1, 0.1]);
    const far = cosineSimilarity(q, [0, 0, 1]);
    expect(near).toBeGreaterThan(far);
  });

  it('is 0, not NaN, for a zero vector', () => {
    // A degenerate embedding must not poison the sort with NaN.
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it('is 0 for mismatched lengths rather than throwing', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('the embedding model is pinned and overridable', () => {
  it('has a stable default', () => {
    const original = process.env.GEMINI_EMBED_MODEL;
    delete process.env.GEMINI_EMBED_MODEL;
    expect(embeddingModel()).toBe('text-embedding-004');
    if (original !== undefined) process.env.GEMINI_EMBED_MODEL = original;
  });
});
