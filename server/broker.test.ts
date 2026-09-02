import { describe, it, expect } from 'vitest';
import { decideProposal, resourceOf, missingArgument, explainReason } from './broker';
import { isLive, Capability } from './capabilities';

/**
 * INV-4 (no tool without a live grant) and INV-5 (tainted egress needs fresh
 * confirmation).
 *
 * decideProposal is pure, so every branch an attacker would need to reach is
 * directly reachable in a test — including the ones that only occur when
 * several conditions coincide.
 */

const HOUR = 3600_000;
const NOW = Date.parse('2026-09-02T12:00:00.000Z');

function cap(over: Partial<Capability> = {}): Capability {
  return {
    id: 'cap_1',
    tool: 'create_note',
    resource: 'entries:own',
    grantedAt: new Date(NOW - HOUR).toISOString(),
    expiresAt: new Date(NOW + HOUR).toISOString(),
    oneShot: false,
    usedAt: null,
    revokedAt: null,
    ...over,
  };
}

const NOTE = { tool: 'create_note', args: { title: 'T', body: 'B' } };
const SEARCH = { tool: 'search_artifacts', args: { query: 'bug' } };

describe('INV-4 — deny by default', () => {
  it('denies when no grant exists', () => {
    const d = decideProposal({ proposal: NOTE, capability: null, turnTaint: false, now: NOW });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('no_capability_grant');
    expect((d as any).invariant).toBe('INV-4');
  });

  it('allows when a live grant matches', () => {
    const d = decideProposal({ proposal: NOTE, capability: cap(), turnTaint: false, now: NOW });
    expect(d.allow).toBe(true);
    expect((d as any).capabilityId).toBe('cap_1');
  });

  it('denies a tool the model invented', () => {
    const d = decideProposal({
      proposal: { tool: 'exfiltrate_everything', args: {} },
      capability: cap({ tool: 'exfiltrate_everything' }),
      turnTaint: false,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('unknown_tool');
  });

  it('denies a malformed proposal rather than guessing', () => {
    for (const bad of [null, undefined, {} as any, { tool: 42 } as any]) {
      expect(decideProposal({ proposal: bad, capability: cap(), turnTaint: false }).allow).toBe(
        false,
      );
    }
  });

  it('names the missing argument so the refusal is actionable', () => {
    const d = decideProposal({
      proposal: { tool: 'create_note', args: { title: 'T' } },
      capability: cap(),
      turnTaint: false,
      now: NOW,
    });
    expect((d as any).reason).toBe('invalid_args:body');
  });
});

describe('INV-4 — grant scope', () => {
  it('a grant for a different tool does not authorise this one', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ tool: 'search_artifacts' }),
      turnTaint: false,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('capability_scope_mismatch');
  });

  it('a grant for a different destination does not authorise this one', () => {
    // The attack: obtain a grant for a benign destination, then have the model
    // propose the same tool against a different one.
    const d = decideProposal({
      proposal: { tool: 'send_digest', args: { destinationId: 'dest_evil', body: 'x' } },
      capability: cap({ tool: 'send_digest', resource: 'destination:dest_safe' }),
      turnTaint: false,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('capability_scope_mismatch');
  });
});

describe('INV-4 — grant lifetime', () => {
  it('denies an expired grant', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ expiresAt: new Date(NOW - 1).toISOString() }),
      turnTaint: false,
      now: NOW,
    });
    expect((d as any).reason).toContain('capability_expired');
  });

  it('denies a revoked grant even if unexpired', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ revokedAt: new Date(NOW - 60_000).toISOString() }),
      turnTaint: false,
      now: NOW,
    });
    expect((d as any).reason).toContain('capability_revoked');
  });

  it('denies a one-shot grant that has already been used', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ oneShot: true, usedAt: new Date(NOW - 60_000).toISOString() }),
      turnTaint: false,
      now: NOW,
    });
    expect((d as any).reason).toContain('capability_already_used');
  });

  it('allows an unused one-shot grant', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ oneShot: true }),
      turnTaint: false,
      now: NOW,
    });
    expect(d.allow).toBe(true);
  });

  it('treats an unparseable expiry as expired', () => {
    // A grant whose lifetime cannot be read is not a grant we can reason about.
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ expiresAt: 'not-a-date' }),
      turnTaint: false,
      now: NOW,
    });
    expect(d.allow).toBe(false);
  });
});

describe('INV-5 — tainted egress', () => {
  const digest = { tool: 'send_digest', args: { destinationId: 'dest_1', body: 'summary' } };
  const digestCap = cap({ tool: 'send_digest', resource: 'destination:dest_1' });

  it('denies a valid, granted egress call when the turn is tainted', () => {
    // The exfiltration-by-summary defence: the attacker does not need the
    // model to read the journal aloud, only to put it in an outbound payload.
    const d = decideProposal({
      proposal: digest,
      capability: digestCap,
      turnTaint: true,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).invariant).toBe('INV-5');
    expect((d as any).needsConfirmation).toBe(true);
  });

  it('a standing grant does NOT override INV-5', () => {
    const longLived = cap({
      tool: 'send_digest',
      resource: 'destination:dest_1',
      expiresAt: new Date(NOW + 7 * 24 * HOUR).toISOString(),
    });
    expect(
      decideProposal({ proposal: digest, capability: longLived, turnTaint: true, now: NOW }).allow,
    ).toBe(false);
  });

  it('allows the same egress call on a clean turn', () => {
    expect(
      decideProposal({ proposal: digest, capability: digestCap, turnTaint: false, now: NOW }).allow,
    ).toBe(true);
  });

  it('taint does not block non-egress tools — reading is not the objective', () => {
    const readCap = cap({ tool: 'search_artifacts' });
    expect(
      decideProposal({ proposal: SEARCH, capability: readCap, turnTaint: true, now: NOW }).allow,
    ).toBe(true);
  });
});

describe('rate limiting', () => {
  it('denies over the per-tool limit', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap(),
      turnTaint: false,
      usage: { create_note: 20 },
      now: NOW,
    });
    expect((d as any).reason).toContain('rate_limited');
  });

  it('allows below the limit', () => {
    expect(
      decideProposal({
        proposal: NOTE,
        capability: cap(),
        turnTaint: false,
        usage: { create_note: 19 },
        now: NOW,
      }).allow,
    ).toBe(true);
  });

  it('denies on unreadable usage rather than assuming zero', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap(),
      turnTaint: false,
      usage: { create_note: NaN },
      now: NOW,
    });
    expect((d as any).reason).toContain('rate_limited');
  });
});

describe('bypass attempts', () => {
  it('forged fields on the proposal cannot force an allow', () => {
    const sneaky = {
      tool: 'create_note',
      args: { title: 'T', body: 'B' },
      allow: true,
      capabilityId: 'forged',
      skipBroker: true,
    } as any;
    expect(decideProposal({ proposal: sneaky, capability: null, turnTaint: false }).allow).toBe(
      false,
    );
  });

  it('forged fields on the capability cannot revive a revoked grant', () => {
    const sneaky = { ...cap({ revokedAt: new Date(NOW - 1).toISOString() }), forceAllow: true } as any;
    expect(
      decideProposal({ proposal: NOTE, capability: sneaky, turnTaint: false, now: NOW }).allow,
    ).toBe(false);
  });

  it('is deterministic — same inputs, same decision', () => {
    const input = { proposal: NOTE, capability: cap(), turnTaint: false, now: NOW };
    expect(decideProposal(input)).toEqual(decideProposal(input));
  });
});

describe('resourceOf — the model never names a destination', () => {
  it('scopes a digest to the opaque destination id', () => {
    expect(resourceOf({ tool: 'send_digest', args: { destinationId: 'd7' } })).toBe(
      'destination:d7',
    );
  });

  it('an email address in the args does not become the resource', () => {
    // The declaration accepts no address, so this cannot arrive - but if it
    // ever did, it must not silently become the thing that is authorised.
    const r = resourceOf({
      tool: 'send_digest',
      args: { destinationId: 'd7', to: 'attacker@example.com' },
    });
    expect(r).toBe('destination:d7');
    expect(r).not.toContain('attacker');
  });

  it('scopes journal tools to the caller own entries', () => {
    expect(resourceOf(NOTE)).toBe('entries:own');
  });
});

describe('isLive', () => {
  it('is false for null, revoked, expired, and used one-shot grants', () => {
    expect(isLive(null, NOW)).toBe(false);
    expect(isLive(cap({ revokedAt: 'x' }), NOW)).toBe(false);
    expect(isLive(cap({ expiresAt: new Date(NOW - 1).toISOString() }), NOW)).toBe(false);
    expect(isLive(cap({ oneShot: true, usedAt: 'x' }), NOW)).toBe(false);
  });

  it('is true for a plain live grant', () => {
    expect(isLive(cap(), NOW)).toBe(true);
  });
});

describe('explainReason', () => {
  it('renders every reason code as a sentence, not a code', () => {
    const codes = [
      'no_capability_grant:create_note:entries:own',
      'capability_expired:create_note',
      'capability_revoked:create_note',
      'capability_already_used:create_note',
      'capability_scope_mismatch:send_digest:destination:d1',
      'tainted_egress_payload:send_digest',
      'rate_limited:create_note',
      'unknown_tool:nonsense',
      'invalid_args:body',
    ];
    for (const code of codes) {
      const sentence = explainReason(code);
      expect(sentence).not.toBe(code);
      expect(sentence.length).toBeGreaterThan(20);
    }
  });
});
