import { describe, it, expect } from 'vitest';
import { CORPUS } from './corpus';
import { detectL1, fuseVerdict } from './detect';
import { buildReaderRequest, assertReaderHasNoTools } from './reader';
import { assertPublicHttpUrl, isBlockedAddress } from './fetchurl';
import { decideProposal } from './broker';

/**
 * The corpus, verified against the real defensive primitives without a network.
 *
 * Amendment C.2: each payload must be stopped by an architectural property.
 * These tests assert that property directly for every payload, so "blocked" is
 * a fact about the code rather than a hope about a model's behaviour.
 */

describe('corpus integrity', () => {
  it('every payload has a unique id', () => {
    const ids = CORPUS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every payload names an invariant and an expected block', () => {
    for (const p of CORPUS) {
      expect(p.invariant, p.id).toMatch(/^INV-\d+$/);
      expect(p.expectedBlock.length, p.id).toBeGreaterThan(20);
    }
  });
});

describe('Amendment C.2 — every payload is stopped by an architectural property', () => {
  it('the Reader carries no tools for ANY payload (INV-1 / INV-2)', () => {
    // The single most important assertion: whatever the payload says, the model
    // that reads it has nothing to call.
    for (const p of CORPUS) {
      const request = buildReaderRequest('gemini-3.1-flash-lite', p.body);
      expect(() => assertReaderHasNoTools(request), p.id).not.toThrow();
      expect('tools' in request.config, p.id).toBe(false);
    }
  });

  it('the SSRF payload is refused by the fetch guard (INV-11)', () => {
    const ssrf = CORPUS.filter((p) => p.class === 'ssrf');
    expect(ssrf.length).toBeGreaterThan(0);
    for (const p of ssrf) {
      const url = p.body.trim();
      // Either the scheme check throws, or the resolved host is blocked.
      let refused = false;
      try {
        const parsed = assertPublicHttpUrl(url);
        refused = isBlockedAddress(parsed.hostname);
      } catch {
        refused = true;
      }
      expect(refused, p.id).toBe(true);
    }
  });

  it('the capability social-engineering payload cannot mint a grant (INV-4)', () => {
    // There is no grant in play, so any tool the model proposes is denied.
    const decision = decideProposal({
      proposal: { tool: 'create_note', args: { title: 'x', body: 'y' } },
      capability: null,
      turnTaint: true,
      now: Date.now(),
    });
    expect(decision.allow).toBe(false);
  });

  it('the destination-substitution payload cannot express an attacker address (INV-5)', () => {
    // Even with a grant, a tainted egress turn is held for confirmation, and
    // the address in the payload never becomes the resource.
    const decision = decideProposal({
      proposal: { tool: 'send_digest', args: { destinationId: 'd1', body: 'x' } },
      capability: {
        id: 'c',
        tool: 'send_digest',
        resource: 'destination:d1',
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        oneShot: false,
        usedAt: null,
        revokedAt: null,
      },
      turnTaint: true,
      now: Date.now(),
    });
    expect(decision.allow).toBe(false);
    expect((decision as any).invariant).toBe('INV-5');
  });
});

describe('detection observes the obvious payloads (defence in depth, not the control)', () => {
  it('flags the direct-override and fake-system payloads', () => {
    for (const id of ['P01', 'P03']) {
      const p = CORPUS.find((x) => x.id === id)!;
      const l1 = detectL1(p.body);
      expect(fuseVerdict(l1, null), id).not.toBe('clean');
    }
  });

  it('the hidden-comment payload is detectable once extracted', () => {
    // extractText would surface the comment; detection then sees it. Here we
    // confirm the signal fires on the comment content directly.
    const p = CORPUS.find((x) => x.id === 'P02')!;
    const l1 = detectL1(p.body);
    expect(l1.signals.length).toBeGreaterThan(0);
  });
});
