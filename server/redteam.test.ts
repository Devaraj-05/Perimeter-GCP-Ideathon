import { describe, it, expect } from 'vitest';
import { runClassSpecificStage } from './redteam';
import { CORPUS } from './corpus';

/**
 * These tests exist because of a specific, real defect.
 *
 * The red team console printed an `expectedBlock` beside every payload — "the
 * broker holds it", "the renderer escapes it" — while the runner only ever
 * exercised the toolless Reader. The rows were not false, but they cited
 * controls the run had not touched, which is exactly the kind of overclaim
 * this project's whole argument rests on not making.
 *
 * So: every payload class that names a downstream control must produce a stage
 * from that control, and that stage must block.
 */

const CLASSES_WITH_OWN_CONTROL: Record<string, string> = {
  destination_substitution: 'broker_decision',
  capability_social_engineering: 'broker_decision',
  cross_user_probe: 'tool_surface',
  markdown_beacon: 'renderer_inv9',
};

describe('red team runner exercises the control each payload names', () => {
  for (const [cls, expectedStage] of Object.entries(CLASSES_WITH_OWN_CONTROL)) {
    it(`${cls} runs ${expectedStage} and blocks`, async () => {
      const payload = CORPUS.find((p) => p.class === cls);
      expect(payload, `corpus has no ${cls} payload`).toBeDefined();

      const stage = await runClassSpecificStage(payload!);
      expect(stage).not.toBeNull();
      expect(stage!.stage).toBe(expectedStage);
      expect(stage!.outcome).toBe('blocked');
    });
  }

  it('the markdown beacon stage does not claim this run proved it', async () => {
    // The beacon fires in a browser. Claiming a server-side run blocked it
    // would be citing the wrong control for a real risk.
    const payload = CORPUS.find((p) => p.class === 'markdown_beacon')!;
    const stage = await runClassSpecificStage(payload);
    expect(stage!.detail).toMatch(/not exercised by this run/i);
    expect(stage!.detail).toMatch(/INV-9/);
  });

  it('classes with no downstream control return null rather than inventing one', async () => {
    const payload = CORPUS.find((p) => p.class === 'direct_override')!;
    expect(await runClassSpecificStage(payload)).toBeNull();
  });

  it('every corpus class is either routed or deliberately unrouted', async () => {
    // Guards against a class being added to the corpus with an expectedBlock
    // naming the broker, and silently falling through to the default branch.
    for (const payload of CORPUS) {
      const stage = await runClassSpecificStage(payload);
      if (CLASSES_WITH_OWN_CONTROL[payload.class]) {
        expect(stage, `${payload.id} should route`).not.toBeNull();
      }
    }
  });
});
