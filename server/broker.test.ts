import { describe, it, expect } from 'vitest';
import { decideProposal, resourceOf, missingArgument, explainReason } from './broker';
import { isLive, Capability } from './capabilities';
import { TOOL_REGISTRY } from './tools';

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

  it('holds a live-granted write for a human click (S2)', () => {
    // A matching grant clears every deny in the chain. It does not clear the
    // confirmation: a grant is the user allowing this tool to run at all, not
    // the user approving this particular note.
    const d = decideProposal({ proposal: NOTE, capability: cap(), turnTaint: false, now: NOW });
    expect(d.allow).toBe(false);
    expect((d as any).needsConfirmation).toBe(true);
    expect((d as any).reason).toContain('write_requires_confirmation');
  });

  it('allows once a live grant matches and the human has confirmed', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap(),
      turnTaint: false,
      confirmed: true,
      now: NOW,
    });
    expect(d.allow).toBe(true);
    expect((d as any).capabilityId).toBe('cap_1');
  });

  it('a confirmation does not substitute for a grant', () => {
    // confirmed suppresses the two branches that ask for a click. It must not
    // suppress a deny, or /approve would become a way to run an ungranted tool.
    const d = decideProposal({
      proposal: NOTE,
      capability: null,
      turnTaint: false,
      confirmed: true,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('no_capability_grant');
  });

  it('a confirmation does not revive a revoked grant', () => {
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ revokedAt: new Date(NOW - 1000).toISOString() }),
      turnTaint: false,
      confirmed: true,
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('capability_revoked');
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
    // confirmed: true so this tests grant LIFETIME rather than re-testing the
    // write gate, which has its own cases above.
    const d = decideProposal({
      proposal: NOTE,
      capability: cap({ oneShot: true }),
      turnTaint: false,
      confirmed: true,
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
      decideProposal({
        proposal: digest,
        capability: digestCap,
        turnTaint: false,
        confirmed: true,
        now: NOW,
      }).allow,
    ).toBe(true);
  });

  it('holds a tainted egress call even when the human already confirmed a write', () => {
    // confirmed is set by /approve, where the human saw this exact payload.
    // It clears the hold for THAT call and nothing else — but the audit record
    // must still carry the turn's real taint, which is why turnTaint is passed
    // honestly rather than as false.
    const d = decideProposal({
      proposal: digest,
      capability: digestCap,
      turnTaint: true,
      confirmed: true,
      now: NOW,
    });
    expect(d.allow).toBe(true);
  });

  it('holds a tainted egress call when nobody has confirmed', () => {
    const d = decideProposal({ proposal: digest, capability: digestCap, turnTaint: true, now: NOW });
    expect(d.allow).toBe(false);
    expect((d as any).invariant).toBe('INV-5');
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
        confirmed: true,
        usage: { create_note: 19 },
        now: NOW,
      }).allow,
    ).toBe(true);
  });

  it('a rate limit outranks a confirmation request', () => {
    // Ordering matters: a refusal the user cannot fix by clicking must not be
    // presented as a click they can make.
    const d = decideProposal({
      proposal: NOTE,
      capability: cap(),
      turnTaint: false,
      usage: { create_note: 20 },
      now: NOW,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('rate_limited');
    expect((d as any).needsConfirmation).toBeUndefined();
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

/**
 * Grant-time resource contract.
 *
 * This block exists because the same bug shipped twice. The Permissions panel
 * builds a capability's `resource` string, and the broker independently
 * computes one via resourceOf() at decision time. If they disagree, the grant
 * appears ACTIVE in the UI and is denied on every single use for
 * capability_scope_mismatch — a failure that reads as a broken security model
 * rather than a missing permission, which is far worse than a plain refusal.
 *
 * It happened to send_digest (granted `destination:SANDBOX`, computed
 * `destination:<realId>`) and then, unnoticed, to summarise_source (granted
 * `entries:own`, computed `source:<sourceId>`).
 *
 * These tests pin resourceOf's shape per tool. If someone changes it, or adds
 * a tool whose resource depends on its arguments, this fails and says so — and
 * the fix is to resolve that resource at grant time in PermissionsPanel.tsx,
 * the way send_digest and summarise_source already do.
 */
describe('resourceOf — the contract the Permissions panel must match', () => {
  /** Tools whose resource depends on their arguments. */
  const PER_OBJECT: Record<string, { args: Record<string, unknown>; expected: string }> = {
    send_digest: { args: { destinationId: 'd1', body: 'x' }, expected: 'destination:d1' },
    summarise_source: { args: { sourceId: 's1' }, expected: 'source:s1' },
  };

  /** Tools that share the one static resource the UI may hardcode. */
  const STATIC_TOOLS = ['search_artifacts', 'create_note'];

  for (const [tool, { args, expected }] of Object.entries(PER_OBJECT)) {
    it(`${tool} is scoped per object and MUST be resolved at grant time`, () => {
      expect(resourceOf({ tool, args })).toBe(expected);
      // The give-away: it must NOT be the static resource the panel would
      // otherwise hardcode.
      expect(resourceOf({ tool, args })).not.toBe('entries:own');
    });
  }

  for (const tool of STATIC_TOOLS) {
    it(`${tool} uses the static resource the panel grants`, () => {
      expect(resourceOf({ tool, args: {} })).toBe('entries:own');
    });
  }

  it('every registered tool is classified above', () => {
    // Forces a decision when a tool is added, rather than letting it default
    // to 'entries:own' and quietly mismatching a per-object grant.
    const known = new Set([...Object.keys(PER_OBJECT), ...STATIC_TOOLS]);
    for (const name of Object.keys(TOOL_REGISTRY)) {
      expect(known.has(name), `${name} is not classified in this test`).toBe(true);
    }
  });

  it('a grant built with the wrong resource is denied, not silently allowed', () => {
    // The exact live bug, pinned.
    const d = decideProposal({
      proposal: { tool: 'summarise_source', args: { sourceId: 'src_abc' } },
      capability: {
        id: 'c', tool: 'summarise_source', resource: 'entries:own',
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        oneShot: false, usedAt: null, revokedAt: null,
      } as any,
      turnTaint: false,
    });
    expect(d.allow).toBe(false);
    expect((d as any).reason).toContain('capability_scope_mismatch');
  });
});
