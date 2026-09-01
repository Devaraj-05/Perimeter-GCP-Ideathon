import { describe, it, expect } from 'vitest';
import { decide, computeTurnTaint, UserPolicy } from './policy';
import { DEFAULT_ALLOWED_TOOLS, TOOL_REGISTRY } from './tools';

const fullPolicy: UserPolicy = { allowedTools: DEFAULT_ALLOWED_TOOLS };

const READ = { tool: 'search_artifacts', args: { query: 'bug' } };
const WRITE = { tool: 'create_note', args: { title: 'Note', body: 'Body' } };

describe('decide - B.3 rule 1: allowlist', () => {
  it('denies a tool that is not in the registry at all', () => {
    const r = decide({ tool: 'exfiltrate_everything', args: {} }, fullPolicy, false);
    expect(r).toMatchObject({ decision: 'DENY', reason: 'not_in_registry' });
  });

  it('denies a registered tool the user has not allowed', () => {
    const r = decide(WRITE, { allowedTools: ['search_artifacts'] }, false);
    expect(r).toMatchObject({ decision: 'DENY', reason: 'not_in_allowlist' });
  });

  it('denies when the allowlist is empty', () => {
    expect(decide(READ, { allowedTools: [] }, false).decision).toBe('DENY');
  });
});

describe('decide - B.3 rule 2: writes from tainted turns', () => {
  it('DENIES a write when the turn is tainted - it is never offered for approval', () => {
    const r = decide(WRITE, fullPolicy, true);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('write_from_tainted_turn');
    // Critically NOT 'CONFIRM': asking a human to approve what an injection
    // requested would be a phishing prompt rendered by our own UI.
    expect(r.decision).not.toBe('CONFIRM');
  });

  it('still permits READS from a tainted turn - reading is not the objective', () => {
    expect(decide(READ, fullPolicy, true).decision).toBe('ALLOW');
  });

  it('treats any truthy taint as tainted', () => {
    expect(decide(WRITE, fullPolicy, true).reason).toBe('write_from_tainted_turn');
  });
});

describe('decide - B.3 rule 3: writes always require human confirmation', () => {
  it('returns CONFIRM for a clean-turn write, never ALLOW', () => {
    const r = decide(WRITE, fullPolicy, false);
    expect(r.decision).toBe('CONFIRM');
    expect(r.decision).not.toBe('ALLOW');
  });

  it('NO write path in the registry can reach ALLOW', () => {
    const writeTools = Object.values(TOOL_REGISTRY).filter((t) => t.sideEffect === 'write');
    expect(writeTools.length).toBeGreaterThan(0);
    for (const tool of writeTools) {
      const args: Record<string, string> = {};
      tool.parameters.required.forEach((k) => (args[k] = 'x'));
      for (const taint of [true, false]) {
        expect(decide({ tool: tool.name, args }, fullPolicy, taint).decision).not.toBe('ALLOW');
      }
    }
  });

  it('bypass attempt: extra fields on the proposal cannot force ALLOW', () => {
    const sneaky = {
      tool: 'create_note',
      args: { title: 'T', body: 'B' },
      // Attacker-supplied fields that a careless implementation might honour.
      decision: 'ALLOW',
      approved: true,
      skipConfirmation: true,
      sideEffect: 'read',
    } as any;
    expect(decide(sneaky, fullPolicy, false).decision).toBe('CONFIRM');
  });

  it('bypass attempt: forged usage/policy fields cannot force ALLOW on a write', () => {
    const sneakyPolicy = {
      allowedTools: DEFAULT_ALLOWED_TOOLS,
      usage: {},
      demoMode: true,
      autoApproveWrites: true,
    } as any;
    expect(decide(WRITE, sneakyPolicy, false).decision).toBe('CONFIRM');
  });
});

describe('decide - B.3 rule 4: rate limits', () => {
  it('denies a read over its limit', () => {
    const spent = { allowedTools: DEFAULT_ALLOWED_TOOLS, usage: { search_artifacts: 60 } };
    expect(decide(READ, spent, false)).toMatchObject({
      decision: 'DENY',
      reason: 'rate_limited',
    });
  });

  it('denies a rate-limited write rather than queueing it for approval', () => {
    const spent = { allowedTools: DEFAULT_ALLOWED_TOOLS, usage: { create_note: 20 } };
    const r = decide(WRITE, spent, false);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('rate_limited');
  });

  it('allows a read below its limit', () => {
    const some = { allowedTools: DEFAULT_ALLOWED_TOOLS, usage: { search_artifacts: 59 } };
    expect(decide(READ, some, false).decision).toBe('ALLOW');
  });
});

describe('decide - B.3 rule 5 and B.6 failure posture', () => {
  it('allows a clean, allowlisted, in-budget read', () => {
    expect(decide(READ, fullPolicy, false)).toMatchObject({
      decision: 'ALLOW',
      reason: 'permitted',
      sideEffect: 'read',
    });
  });

  it('denies a null or malformed proposal', () => {
    expect(decide(null, fullPolicy, false).decision).toBe('DENY');
    expect(decide(undefined, fullPolicy, false).decision).toBe('DENY');
    expect(decide('create_note' as any, fullPolicy, false).decision).toBe('DENY');
  });

  it('denies when the policy itself is missing', () => {
    expect(decide(READ, null, false).decision).toBe('DENY');
    expect(decide(READ, undefined, false).decision).toBe('DENY');
  });

  it('denies when required arguments are missing or blank', () => {
    expect(decide({ tool: 'create_note', args: { title: 'T' } }, fullPolicy, false).reason).toBe(
      'invalid_arguments',
    );
    expect(
      decide({ tool: 'create_note', args: { title: '  ', body: 'B' } }, fullPolicy, false).reason,
    ).toBe('invalid_arguments');
  });

  it('denies when usage data is unreadable rather than assuming zero', () => {
    const broken = { allowedTools: DEFAULT_ALLOWED_TOOLS, usage: { search_artifacts: NaN } };
    expect(decide(READ, broken, false).reason).toBe('rate_limited');
  });

  it('is deterministic - same inputs, same output', () => {
    const a = decide(WRITE, fullPolicy, false);
    const b = decide(WRITE, fullPolicy, false);
    expect(a).toEqual(b);
  });
});

describe('computeTurnTaint', () => {
  it('taints on a hostile untrusted artifact', () => {
    expect(computeTurnTaint([{ trust: 'untrusted', verdict: 'hostile' }])).toBe(true);
  });

  it('taints on a suspicious untrusted artifact', () => {
    expect(computeTurnTaint([{ trust: 'untrusted', verdict: 'suspicious' }])).toBe(true);
  });

  it('does not taint on clean untrusted content', () => {
    expect(computeTurnTaint([{ trust: 'untrusted', verdict: 'clean' }])).toBe(false);
  });

  it('does not taint on first-party content, whatever its verdict', () => {
    expect(computeTurnTaint([{ trust: 'first_party', verdict: 'hostile' }])).toBe(false);
  });

  it('one hostile artifact taints a mixed context', () => {
    expect(
      computeTurnTaint([
        { trust: 'first_party', verdict: 'clean' },
        { trust: 'untrusted', verdict: 'clean' },
        { trust: 'untrusted', verdict: 'hostile' },
      ]),
    ).toBe(true);
  });

  it('handles empty and malformed input', () => {
    expect(computeTurnTaint([])).toBe(false);
    expect(computeTurnTaint(null)).toBe(false);
    expect(computeTurnTaint(undefined)).toBe(false);
  });
});

describe('the end-to-end claim', () => {
  it('a hostile issue proposing create_note is denied, not queued', () => {
    const context = [
      { trust: 'first_party', verdict: 'clean' },
      { trust: 'untrusted', verdict: 'hostile' },
    ];
    const taint = computeTurnTaint(context);
    const r = decide({ tool: 'create_note', args: { title: 'exfil', body: '...' } }, fullPolicy, taint);

    expect(taint).toBe(true);
    expect(r.decision).toBe('DENY');
    expect(r.reason).toBe('write_from_tainted_turn');
  });
});
