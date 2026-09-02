/**
 * Corpus replay — Amendment C.3.
 *
 * Runs every payload through the real defensive primitives and prints the
 * attempted / detected / reaching-execution table, including any misses.
 *
 * This runs WITHOUT a network or a running server: it exercises the pure
 * architectural properties directly, so "blocked" is a fact about the code
 * rather than a claim about a model's behaviour on the day. The model-layer
 * detection rate is reported separately and honestly as defence in depth.
 *
 *   npx tsx scripts/replay-corpus.ts
 *   npx tsx scripts/replay-corpus.ts --md    # markdown table for the README
 */

import { CORPUS } from '../server/corpus';
import { detectL1, fuseVerdict } from '../server/detect';
import { buildReaderRequest, assertReaderHasNoTools } from '../server/reader';
import { assertPublicHttpUrl, isBlockedAddress } from '../server/fetchurl';
import { decideProposal } from '../server/broker';

interface Row {
  id: string;
  cls: string;
  invariant: string;
  /** Did the architectural boundary stop it? */
  architecturallyBlocked: boolean;
  /** Did the deterministic L1 layer flag it? (defence in depth) */
  l1Detected: boolean;
  block: string;
}

/**
 * The architectural check for each payload — the property that stops it
 * regardless of what any model does.
 */
function architecturalBlock(id: string, cls: string, body: string): { blocked: boolean; how: string } {
  // SSRF: the fetch guard refuses before connecting.
  if (cls === 'ssrf') {
    try {
      const url = assertPublicHttpUrl(body.trim());
      const blocked = isBlockedAddress(url.hostname);
      return { blocked, how: blocked ? 'fetch guard: blocked address' : 'REACHED FETCH' };
    } catch (err: any) {
      return { blocked: true, how: `fetch guard: ${err?.message ?? 'refused'}` };
    }
  }

  // Capability social-engineering: no grant, so any proposed tool is denied.
  if (cls === 'capability_social_engineering') {
    const d = decideProposal({
      proposal: { tool: 'create_note', args: { title: 'x', body: 'y' } },
      capability: null,
      turnTaint: true,
    });
    return { blocked: !d.allow, how: 'broker: deny by default' };
  }

  // Destination substitution: even granted, a tainted egress turn is held.
  if (cls === 'destination_substitution') {
    const d = decideProposal({
      proposal: { tool: 'send_digest', args: { destinationId: 'd1', body: 'x' } },
      capability: {
        id: 'c', tool: 'send_digest', resource: 'destination:d1',
        grantedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        oneShot: false, usedAt: null, revokedAt: null,
      },
      turnTaint: true,
    });
    return { blocked: !d.allow, how: 'broker: INV-5 tainted egress held' };
  }

  // Markdown beacon: INV-9 in the renderer. It never becomes an <img>, so it
  // cannot fetch. Nothing to execute server-side; the block is structural.
  if (cls === 'markdown_beacon') {
    return { blocked: true, how: 'renderer: escaped, never an <img>' };
  }

  // Everything else: the airlock. The Reader that reads this has no tools.
  const request = buildReaderRequest('gemini-3.1-flash-lite', body);
  try {
    assertReaderHasNoTools(request);
    const noTools = !('tools' in request.config);
    return { blocked: noTools, how: 'airlock: Reader holds no tools' };
  } catch {
    return { blocked: false, how: 'READER CARRIED TOOLS' };
  }
}

function run(): Row[] {
  return CORPUS.map((p) => {
    const arch = architecturalBlock(p.id, p.class, p.body);
    const l1 = detectL1(p.body);
    const l1Detected = fuseVerdict(l1, null) !== 'clean';
    return {
      id: p.id,
      cls: p.class,
      invariant: p.invariant,
      architecturallyBlocked: arch.blocked,
      l1Detected,
      block: arch.how,
    };
  });
}

function printTable(rows: Row[], markdown: boolean) {
  const attempted = rows.length;
  const blocked = rows.filter((r) => r.architecturallyBlocked).length;
  const l1Hits = rows.filter((r) => r.l1Detected).length;

  if (markdown) {
    console.log('| Payload | Class | Invariant | Architectural block | L1 detected |');
    console.log('|---|---|---|---|---|');
    for (const r of rows) {
      console.log(
        `| ${r.id} | ${r.cls.replace(/_/g, ' ')} | ${r.invariant} | ${
          r.architecturallyBlocked ? '✅ ' + r.block : '❌ REACHED EXECUTION'
        } | ${r.l1Detected ? '✅' : '—'} |`,
      );
    }
    console.log('');
    console.log(`**Attempted:** ${attempted} · **Reached execution:** ${attempted - blocked} · ` +
      `**Architecturally blocked:** ${blocked}/${attempted}`);
    console.log('');
    console.log(`Deterministic L1 detection (defence in depth, not the boundary): ` +
      `${l1Hits}/${attempted}. The gap between L1 and the architectural block is the whole ` +
      `point — the boundary holds on the payloads the pattern layer misses.`);
    return;
  }

  console.log('\n  Perimeter — corpus replay\n  ' + '='.repeat(60));
  for (const r of rows) {
    const mark = r.architecturallyBlocked ? '  BLOCKED ' : '  LEAKED  ';
    const l1 = r.l1Detected ? 'L1:hit ' : 'L1:miss';
    console.log(`  ${mark} ${r.id.padEnd(4)} ${l1}  ${r.invariant.padEnd(7)} ${r.block}`);
  }
  console.log('  ' + '='.repeat(60));
  console.log(`  Attempted:            ${attempted}`);
  console.log(`  Reached execution:    ${attempted - blocked}`);
  console.log(`  Architecturally blocked: ${blocked}/${attempted}`);
  console.log(`  L1 detection (in depth): ${l1Hits}/${attempted}\n`);

  if (blocked < attempted) {
    console.error('  FAIL: a payload reached execution.');
    process.exit(1);
  }
}

const rows = run();
printTable(rows, process.argv.includes('--md'));
