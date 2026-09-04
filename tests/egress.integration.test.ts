import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * The INV-5 demo path, end to end, against a real Firestore.
 *
 * Everything else in the suite tests pure functions. This is the first test
 * that makes the egress path actually *run*: create a destination, ask the
 * broker, execute the tool, and read back what landed in the database.
 *
 * It exists because the parts this exercises had zero runtime coverage, and
 * they are exactly the parts the demo depends on:
 *
 *   - executeTool('send_digest') had never once been called.
 *   - recordSandboxDelivery writes a batch with FieldValue.increment. If that
 *     batch is malformed the demo fails live, on camera, and no unit test
 *     would have said a word.
 *   - Ownership on the destination lookup is claimed to be structural. That
 *     claim deserves a query from a second uid, not a comment.
 *
 * No credentials are needed. The Admin SDK talks to the emulator, and the app
 * is initialised here before the server modules load so that
 * getAdminApp() adopts it instead of calling applicationDefault().
 */

const ALICE = 'alice-int';
const BOB = 'bob-int';

let createSandboxDestination: any;
let getDestination: any;
let recordSandboxDelivery: any;
let listDeliveries: any;
let executeTool: any;
let decideProposal: any;
let adminDb: any;
let claimOneShot: any;
let mintCapability: any;

const liveGrant = (tool: string, resource: string) => ({
  id: 'cap-int',
  tool,
  resource,
  grantedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  oneShot: false,
  usedAt: null,
  revokedAt: null,
});

beforeAll(async () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  // Force the default database: the production config names a database that
  // does not exist in the emulator.
  process.env.FIRESTORE_DATABASE_ID = '(default)';
  process.env.GOOGLE_CLOUD_PROJECT = 'perimeter-rules-test';

  const { initializeApp, getApps } = await import('firebase-admin/app');
  if (!getApps().length) initializeApp({ projectId: 'perimeter-rules-test' });

  ({ createSandboxDestination, getDestination, recordSandboxDelivery, listDeliveries } = await import(
    '../server/destinations'
  ));
  ({ executeTool } = await import('../server/execute'));
  ({ decideProposal } = await import('../server/broker'));
  ({ adminDb } = await import('../server/auth'));
  ({ claimOneShot, mintCapability } = await import('../server/capabilities'));
});

afterAll(async () => {
  for (const uid of [ALICE, BOB]) {
    const caps = await adminDb().collection('users').doc(uid).collection('capabilities').get();
    await Promise.all(caps.docs.map((c: any) => c.ref.delete()));
    const dests = await adminDb().collection('users').doc(uid).collection('destinations').get();
    for (const d of dests.docs) {
      const deliveries = await d.ref.collection('deliveries').get();
      await Promise.all(deliveries.docs.map((x: any) => x.ref.delete()));
      await d.ref.delete();
    }
  }
});

describe('INV-5 egress path, end to end', () => {
  it('creates a sandbox destination and executes a digest into it', async () => {
    const dest = await createSandboxDestination(ALICE, 'Demo sandbox');
    expect(dest.kind).toBe('sandbox');
    expect(dest.deliveryCount).toBe(0);

    // send_digest is write-class, so a matching grant on a clean turn is still
    // held for a human click (S2). Assert that first — it is the gate this test
    // used to walk straight past — then confirm and continue, because what this
    // test is actually about is the execution path after approval.
    const proposal = {
      tool: 'send_digest',
      args: { destinationId: dest.id, body: 'week in review' },
    };
    const capability = liveGrant('send_digest', `destination:${dest.id}`);

    const held = decideProposal({ proposal, capability, turnTaint: false });
    expect(held.allow).toBe(false);
    expect((held as any).needsConfirmation).toBe(true);
    expect((held as any).reason).toContain('write_requires_confirmation');

    // What /api/agent/approve does: re-decide with the human's click recorded,
    // which suppresses the confirmation branches and nothing else.
    const decision = decideProposal({ proposal, capability, turnTaint: false, confirmed: true });
    expect(decision.allow, `broker denied a confirmed, granted egress: ${JSON.stringify(decision)}`)
      .toBe(true);

    const result = await executeTool(ALICE, 'send_digest', {
      destinationId: dest.id,
      body: 'week in review',
    });

    expect(result.ok, `execution failed: ${result.error}`).toBe(true);
    expect(result.result.sandbox).toBe(true);
    expect(result.result.destination).toBe('Demo sandbox');
  });

  it('records the delivery and increments the counter atomically', async () => {
    // FieldValue.increment inside a batch had never executed. If it is wrong,
    // this is where it shows up rather than during the demo.
    const dest = await createSandboxDestination(ALICE, 'Counter check');

    await recordSandboxDelivery(ALICE, dest.id, 'first');
    await recordSandboxDelivery(ALICE, dest.id, 'second');

    const after = await getDestination(ALICE, dest.id);
    expect(after.deliveryCount).toBe(2);

    const deliveries = await adminDb()
      .collection('users').doc(ALICE)
      .collection('destinations').doc(dest.id)
      .collection('deliveries').get();
    expect(deliveries.size).toBe(2);
  });

  it('stores a hash and a preview, never a second full copy of the body', async () => {
    // Constitution §7: the log proves what was sent without duplicating
    // potentially sensitive journal text into another collection.
    const dest = await createSandboxDestination(ALICE, 'Preview check');
    const body = 'SENSITIVE '.repeat(200);

    const delivery = await recordSandboxDelivery(ALICE, dest.id, body);

    expect(delivery.bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(delivery.bodyLength).toBe(body.length);
    expect(delivery.preview.length).toBeLessThanOrEqual(200);
    expect(delivery.preview.length).toBeLessThan(body.length);
  });

  it("cannot execute against another user's destination", async () => {
    // Ownership is claimed to be structural because the path is uid-scoped.
    // This is that claim, executed.
    const bobDest = await createSandboxDestination(BOB, "Bob's sandbox");

    const result = await executeTool(ALICE, 'send_digest', {
      destinationId: bobDest.id,
      body: 'exfiltrate',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Destination not found.');

    const bobAfter = await getDestination(BOB, bobDest.id);
    expect(bobAfter.deliveryCount).toBe(0);
  });

  it('refuses an id the model invented', async () => {
    // The phantom-tool failure mode: a hallucinated id must fail closed.
    const result = await executeTool(ALICE, 'send_digest', {
      destinationId: 'attacker-endpoint-999',
      body: 'x',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Destination not found.');
  });

  it('holds the digest when the turn touched external content', async () => {
    // The demo's first half. Same grant, same destination, tainted turn.
    const dest = await createSandboxDestination(ALICE, 'Taint check');

    const decision = decideProposal({
      proposal: { tool: 'send_digest', args: { destinationId: dest.id, body: 'journal' } },
      capability: liveGrant('send_digest', `destination:${dest.id}`),
      turnTaint: true,
    });

    expect(decision.allow).toBe(false);
    expect((decision as any).invariant).toBe('INV-5');

    // And nothing was written, because execution never happened.
    const after = await getDestination(ALICE, dest.id);
    expect(after.deliveryCount).toBe(0);
  });

  it('reads back the evidence a user is shown', async () => {
    // This is what makes the refusal visible. Until this path existed the
    // delivery record was written and shown to nobody, so a held send and a
    // successful send looked identical on screen.
    const dest = await createSandboxDestination(ALICE, 'Evidence check');
    await recordSandboxDelivery(ALICE, dest.id, 'first body');
    await recordSandboxDelivery(ALICE, dest.id, 'second body that is longer');

    const rows = await listDeliveries(ALICE, dest.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].bodySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.map((r: any) => r.preview)).toContain('first body');
    expect(rows.find((r: any) => r.preview === 'first body').bodyLength).toBe(10);
  });

  it("does not read another user's evidence", async () => {
    const bobDest = await createSandboxDestination(BOB, 'Bob evidence');
    await recordSandboxDelivery(BOB, bobDest.id, "bob's private text");

    // Same destination id, wrong uid: the path simply does not resolve.
    expect(await listDeliveries(ALICE, bobDest.id)).toEqual([]);
  });

  it('enforces the destination cap', async () => {
    await expect(
      (async () => {
        for (let i = 0; i < 10; i++) await createSandboxDestination(BOB, `d${i}`);
      })(),
    ).rejects.toThrow(/at most/i);
  });
});


describe('INV-4 one-shot grants are at-most-once under concurrency', () => {
  /**
   * findLiveCapability -> decideProposal -> executeTool -> consumeCapability
   * put a read, a decision and a write either side of a network call with no
   * atomicity between them. Two concurrent turns both read the same live
   * one-shot grant, both satisfied the broker, and both executed — so a
   * "one-time permission" was at-LEAST-once, while the UI told the user it had
   * "already been used".
   *
   * These fire the claim concurrently, which is the only way the old code was
   * ever wrong. A sequential test passed against the broken version.
   */
  it('lets exactly one of N concurrent claims win', async () => {
    const cap = await mintCapability(ALICE, {
      tool: 'send_digest',
      resource: 'destination:x',
      oneShot: true,
      hours: 1,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimOneShot(ALICE, cap.id)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((r: boolean) => !r)).toHaveLength(7);
  });

  it('marks the grant used so a later sequential claim also loses', async () => {
    const cap = await mintCapability(ALICE, {
      tool: 'send_digest',
      resource: 'destination:y',
      oneShot: true,
      hours: 1,
    });

    expect(await claimOneShot(ALICE, cap.id)).toBe(true);
    expect(await claimOneShot(ALICE, cap.id)).toBe(false);
  });

  it('is a no-op that succeeds repeatedly for a standing grant', async () => {
    const cap = await mintCapability(ALICE, {
      tool: 'send_digest',
      resource: 'destination:z',
      oneShot: false,
      hours: 1,
    });

    expect(await claimOneShot(ALICE, cap.id)).toBe(true);
    expect(await claimOneShot(ALICE, cap.id)).toBe(true);
  });

  it('fails closed on a grant that does not exist', async () => {
    expect(await claimOneShot(ALICE, 'no-such-capability')).toBe(false);
  });

  it("cannot claim another user's grant", async () => {
    const cap = await mintCapability(BOB, {
      tool: 'send_digest',
      resource: 'destination:bob',
      oneShot: true,
      hours: 1,
    });

    // Scoped by uid path, so Alice's claim looks up a document that is not there.
    expect(await claimOneShot(ALICE, cap.id)).toBe(false);
    expect(await claimOneShot(BOB, cap.id)).toBe(true);
  });
});
