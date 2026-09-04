import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { TOOL_REGISTRY } from './tools';
import { decideProposal } from './broker';
import type { Capability } from './capabilities';

/**
 * Reachability — the structural guard for the failure this repo kept hitting.
 *
 * Four separate security controls were written, tested, and then quietly left
 * off the live code path by a later migration. Each kept its own tests green:
 *
 *   - assemble.ts   fencing + DATA_ONLY_PREAMBLE   orphaned by the M3 airlock
 *   - policy.ts     write_requires_confirmation    orphaned by the M4 broker
 *   - the 'reader' perimeter event kind            declared, never emitted
 *   - contains_instruction_attempt                 computed, never logged
 *
 * The policy.ts one was the expensive one: it held the ONLY implementation of
 * problem-statement.md S2, so S2 was false while policy.test.ts passed.
 *
 * A passing test on an unreachable function is not evidence about the running
 * system. These tests check reachability itself, so the next migration that
 * strands a control fails the suite instead of the submission.
 */

const SERVER_DIR = resolve(__dirname);
const ENTRY = resolve(__dirname, '..', 'server.ts');

/** Modules deliberately kept for the record. Each must say so in its own header. */
const SUPERSEDED_MARKER = 'SUPERSEDED';

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const specs: string[] = [];
  // Static VALUE imports only. An `import type` or `export type` clause is
  // erased by TypeScript and creates no runtime edge, so counting one would
  // report a superseded module as live purely because something still uses
  // its interface. That is exactly the state assemble.ts and policy.ts are
  // in, and the negative lookahead below is what keeps them honest.
  //
  // The class excludes the semicolon but NOT the newline, because a
  // multi-line import clause is still one statement: gmailRoutes.ts pulls
  // eight names from './gmail' across eight lines. Excluding the newline
  // reported gmail.ts and tokencrypto.ts as dead when both are live.
  for (const m of src.matchAll(
    /^[ \t]*(?:import|export)\s+(?!type\s)[^;]*?from\s+['"](\.[^'"]+)['"]/gm,
  )) {
    specs.push(m[1]);
  }
  // Dynamic: await import('./x')
  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    specs.push(m[1]);
  }
  return specs;
}

function resolveSpec(fromFile: string, spec: string): string | null {
  const base = resolve(fromFile, '..', spec);
  for (const candidate of [base + '.ts', join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Every server module the Cloud Run entrypoint can actually reach. */
function reachableFromEntry(): Set<string> {
  const seen = new Set<string>();
  const queue = [ENTRY];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const target = resolveSpec(file, spec);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

const liveModules = reachableFromEntry();

function serverModules(): string[] {
  return readdirSync(SERVER_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => resolve(SERVER_DIR, f));
}

describe('no orphaned security control', () => {
  it('every server module is reachable from server.ts, or declares itself superseded', () => {
    const orphans: string[] = [];

    for (const file of serverModules()) {
      if (liveModules.has(file)) continue;
      const header = readFileSync(file, 'utf8').slice(0, 1500);
      if (!header.includes(SUPERSEDED_MARKER)) orphans.push(file.split(/[\/]/).pop()!);
    }

    // An unreachable module with no SUPERSEDED banner is a control that has
    // silently stopped running. Either wire it back in, or band it and say why.
    expect(orphans).toEqual([]);
  });

  it('the two known-dead modules are still dead, and still labelled', () => {
    // If either of these becomes reachable again there are two policy engines
    // or two prompt assemblers, which is worse than having one of each.
    for (const name of ['assemble.ts', 'policy.ts']) {
      const file = resolve(SERVER_DIR, name);
      expect(liveModules.has(file)).toBe(false);
      expect(readFileSync(file, 'utf8').slice(0, 400)).toContain(SUPERSEDED_MARKER);
    }
  });

  it('the broker and the reader are on the live path', () => {
    // The two halves the whole claim rests on. A migration that strands either
    // of these is the thing this file exists to catch.
    for (const name of ['broker.ts', 'reader.ts', 'planner.ts', 'perimeterLog.ts']) {
      expect(liveModules.has(resolve(SERVER_DIR, name))).toBe(true);
    }
  });
});

describe('S2 — the write gate covers the whole tool registry', () => {
  const live = (tool: string, resource: string): Capability => ({
    id: 'cap_reach',
    tool,
    resource,
    grantedAt: new Date(Date.now() - 1000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    oneShot: false,
    usedAt: null,
    revokedAt: null,
  } as Capability);

  const argsFor = (name: string): Record<string, unknown> => {
    const required = TOOL_REGISTRY[name].parameters.required;
    return Object.fromEntries(required.map((k) => [k, 'x']));
  };

  const resourceFor = (name: string) =>
    name === 'send_digest' ? 'destination:x' : name === 'summarise_source' ? 'source:x' : 'entries:own';

  // Data-driven over the registry rather than a list written by hand, so a new
  // write-class tool cannot be added without this gate applying to it. That is
  // exactly how create_note came to execute with no confirmation.
  const writeTools = Object.keys(TOOL_REGISTRY).filter(
    (t) => TOOL_REGISTRY[t].sideEffect === 'write',
  );

  it('there is at least one write-class tool to guard', () => {
    expect(writeTools.length).toBeGreaterThan(0);
  });

  it.each(writeTools)('%s is held for a human click even with a live grant', (tool) => {
    const resource = resourceFor(tool);
    const d = decideProposal({
      proposal: { tool, args: argsFor(tool) },
      capability: live(tool, resource),
      turnTaint: false,
    });
    expect(d.allow).toBe(false);
    expect((d as any).needsConfirmation).toBe(true);
  });

  it.each(writeTools)('%s runs once confirmed', (tool) => {
    const resource = resourceFor(tool);
    const d = decideProposal({
      proposal: { tool, args: argsFor(tool) },
      capability: live(tool, resource),
      turnTaint: false,
      confirmed: true,
    });
    expect(d.allow).toBe(true);
  });
});

describe('every declared perimeter event kind is actually emitted', () => {
  /**
   * The 'reader' kind was declared in perimeterLog.ts and rendered by
   * PerimeterLogPanel.tsx ('Analysed in quarantine') for the whole life of the
   * project without a single line emitting it. The Reader's
   * contains_instruction_attempt finding — the strongest attack signal in the
   * system, because the Reader is the only thing that actually read the
   * document — was computed, handed to the Planner and dropped. Whether the
   * user ever learned an attempt had been made came down to the Planner
   * choosing to mention it in prose.
   *
   * A declared-and-unemitted kind is a visibility promise nothing keeps, so
   * it has to be either wired up or admitted to below.
   */

  /** Kinds that exist in the union but nothing emits yet. Each needs a reason. */
  const NOT_YET_EMITTED: Record<string, string> = {
    // The decision event already carries the tool and its arguments, so a
    // separate proposal event would duplicate every row in the log.
    plan: 'redundant with the decision event, which records tool and args',
    // Failures currently surface as a decision with a deny reason, which keeps
    // one ordering for everything in the chain.
    error: 'failures are recorded as a decision with a deny reason',
  };

  const declaredKinds = (): string[] => {
    const src = readFileSync(resolve(SERVER_DIR, 'perimeterLog.ts'), 'utf8');
    const union = src.match(/export type EventKind =([\s\S]*?);/);
    expect(union).not.toBeNull();
    return Array.from(union![1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
  };

  const emittedKinds = (): Set<string> => {
    const out = new Set<string>();
    for (const file of serverModules()) {
      for (const m of readFileSync(file, 'utf8').matchAll(/kind:\s*'([a-z_]+)'/g)) {
        out.add(m[1]);
      }
    }
    return out;
  };

  it('emits every kind it declares, or names why not', () => {
    const emitted = emittedKinds();
    const silent = declaredKinds().filter(
      (k) => !emitted.has(k) && !(k in NOT_YET_EMITTED),
    );
    expect(silent).toEqual([]);
  });

  it('the reader kind is emitted — it was the one that went missing', () => {
    expect(emittedKinds().has('reader')).toBe(true);
  });

  it('the excused list stays honest: nothing on it is secretly emitted', () => {
    // If one of these starts being emitted, delete its excuse rather than
    // leaving a comment that claims it does not exist.
    const emitted = emittedKinds();
    const wronglyExcused = Object.keys(NOT_YET_EMITTED).filter((k) => emitted.has(k));
    expect(wronglyExcused).toEqual([]);
  });
});
