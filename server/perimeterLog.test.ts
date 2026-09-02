import { describe, it, expect } from 'vitest';
import { canonicalJson, hashEvent, PerimeterEvent } from './perimeterLog';

/**
 * Hash chaining — the property that turns "we have a log" into "verify it
 * yourself".
 *
 * These test the pure parts: canonical serialisation and event hashing. The
 * transaction and the Firestore round trip are covered by the rules suite and
 * by manual verification against the emulator.
 */

function ev(over: Partial<PerimeterEvent> = {}): PerimeterEvent {
  return {
    id: 'e1',
    seq: 1,
    prevHash: 'genesis',
    ts: '2026-09-02T12:00:00.000Z',
    kind: 'decision',
    zone: null,
    tool: 'create_note',
    decision: 'deny',
    reason: 'write_from_tainted_turn',
    invariant: 'INV-5',
    detail: { originSourceIds: ['acme/widgets'] },
    sessionId: null,
    ...over,
  };
}

describe('canonicalJson', () => {
  it('is stable regardless of key insertion order', () => {
    // Without this the chain would break on nothing more than a different
    // property order between two runs.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested keys too', () => {
    const x = canonicalJson({ outer: { z: 1, a: 2 } });
    const y = canonicalJson({ outer: { a: 2, z: 1 } });
    expect(x).toBe(y);
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('drops undefined without shifting the result', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it('handles primitives and null', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson('x')).toBe('"x"');
  });
});

describe('hashEvent', () => {
  it('is deterministic for the same event', () => {
    expect(hashEvent(ev())).toBe(hashEvent(ev()));
  });

  it('ignores the document id, which is not part of the chained content', () => {
    expect(hashEvent(ev({ id: 'aaa' }))).toBe(hashEvent(ev({ id: 'bbb' })));
  });

  it('changes when the DECISION is altered', () => {
    // The attack this defends: flipping a recorded deny into an allow.
    expect(hashEvent(ev({ decision: 'allow' }))).not.toBe(hashEvent(ev()));
  });

  it('changes when the reason is altered', () => {
    expect(hashEvent(ev({ reason: 'permitted' }))).not.toBe(hashEvent(ev()));
  });

  it('changes when the tool is altered', () => {
    expect(hashEvent(ev({ tool: 'search_artifacts' }))).not.toBe(hashEvent(ev()));
  });

  it('changes when detail is altered', () => {
    expect(hashEvent(ev({ detail: { originSourceIds: [] } }))).not.toBe(hashEvent(ev()));
  });

  it('changes when the sequence number is altered', () => {
    expect(hashEvent(ev({ seq: 2 }))).not.toBe(hashEvent(ev()));
  });

  it('produces a full sha256 hex digest', () => {
    expect(hashEvent(ev())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the chain property', () => {
  it('editing an event invalidates every link after it', () => {
    const first = ev({ seq: 1, prevHash: 'genesis' });
    const second = ev({ id: 'e2', seq: 2, prevHash: hashEvent(first), reason: 'permitted' });

    // Second correctly follows first.
    expect(second.prevHash).toBe(hashEvent(first));

    // Now tamper with the first event — flip a deny into an allow.
    const tampered = { ...first, decision: 'allow' as const };

    // Second's stored prevHash no longer matches the recomputed hash, so the
    // edit is detectable without needing a copy of the original.
    expect(second.prevHash).not.toBe(hashEvent(tampered));
  });

  it('a genuine chain of three events verifies link by link', () => {
    const a = ev({ id: 'a', seq: 1, prevHash: 'genesis' });
    const b = ev({ id: 'b', seq: 2, prevHash: hashEvent(a) });
    const c = ev({ id: 'c', seq: 3, prevHash: hashEvent(b) });

    expect(b.prevHash).toBe(hashEvent(a));
    expect(c.prevHash).toBe(hashEvent(b));
  });
});
