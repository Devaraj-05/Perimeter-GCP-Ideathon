import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { readFileSync } from 'fs';

/**
 * Firestore rules suite - the isolation guarantee, tested adversarially.
 *
 * These cases are written from the attacker's side. A rules file that passes
 * only its author's happy path proves nothing; what matters is that user B
 * cannot reach user A, and that a client cannot edit the fields the security
 * decisions are made from.
 *
 * Requires the Firestore emulator. Run with: npm run test:rules
 */

const PROJECT_ID = 'perimeter-rules-test';

let testEnv: RulesTestEnvironment;

const ALICE = 'alice_uid';
const BOB = 'bob_uid';

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed as admin (bypasses rules), the way the server writes in production.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${ALICE}/entries/e1`), {
      title: 'Alice private entry',
      content: 'secret',
    });
    await setDoc(doc(db, `users/${ALICE}/sources/s1`), { ref: 'acme/widgets', enabled: true });
    await setDoc(doc(db, `users/${ALICE}/artifacts/a1`), {
      sourceId: 's1',
      title: 'Poisoned issue',
      trust: 'untrusted',
      verdict: 'hostile',
      threatScore: 0.95,
    });
    await setDoc(doc(db, `users/${ALICE}/toolcalls/t1`), {
      tool: 'create_note',
      status: 'pending',
      decision: 'CONFIRM',
      turnTaint: false,
    });
    await setDoc(doc(db, `users/${ALICE}/audit/ev1`), {
      type: 'tool_decision',
      decision: 'DENY',
      reason: 'write_from_tainted_turn',
    });
  });
});

const alice = () => testEnv.authenticatedContext(ALICE).firestore();
const bob = () => testEnv.authenticatedContext(BOB).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();

// ---------------------------------------------------------------
// Cross-user isolation - the headline claim
// ---------------------------------------------------------------

describe('HOSTILE: user B reaching user A', () => {
  it('B cannot read A\'s journal entries', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}/entries/e1`)));
  });

  it('B cannot read A\'s artifacts', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}/artifacts/a1`)));
  });

  it('B cannot list A\'s artifacts collection', async () => {
    await assertFails(getDocs(collection(bob(), `users/${ALICE}/artifacts`)));
  });

  it('B cannot read A\'s tool calls', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}/toolcalls/t1`)));
  });

  it('B cannot read A\'s audit log', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}/audit/ev1`)));
  });

  it('B cannot write into A\'s entries', async () => {
    await assertFails(setDoc(doc(bob(), `users/${ALICE}/entries/injected`), { title: 'x' }));
  });

  it('B cannot delete A\'s data', async () => {
    await assertFails(deleteDoc(doc(bob(), `users/${ALICE}/entries/e1`)));
  });

  it('B cannot read A\'s user document', async () => {
    await assertFails(getDoc(doc(bob(), `users/${ALICE}`)));
  });
});

describe('HOSTILE: unauthenticated access', () => {
  it('anonymous cannot read any user document', async () => {
    await assertFails(getDoc(doc(anon(), `users/${ALICE}/entries/e1`)));
  });

  it('anonymous cannot read artifacts', async () => {
    await assertFails(getDoc(doc(anon(), `users/${ALICE}/artifacts/a1`)));
  });

  it('anonymous cannot read the audit log', async () => {
    await assertFails(getDoc(doc(anon(), `users/${ALICE}/audit/ev1`)));
  });

  it('anonymous cannot write anywhere', async () => {
    await assertFails(setDoc(doc(anon(), `users/${ALICE}/entries/x`), { title: 'x' }));
  });

  it('anonymous cannot reach an arbitrary top-level collection', async () => {
    await assertFails(getDoc(doc(anon(), 'anything/else')));
  });
});

// ---------------------------------------------------------------
// Owner-side restrictions - A.6 and B.5
// ---------------------------------------------------------------

describe('HOSTILE: the owner tampering with their own security state', () => {
  it('A cannot launder a hostile verdict on their own artifact', async () => {
    // The whole taint decision reads from this field. If the owner could edit
    // it, they could clear hostile content and then have a write approved.
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/artifacts/a1`), { verdict: 'clean' }));
  });

  it('A cannot lower their own artifact threat score', async () => {
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/artifacts/a1`), { threatScore: 0 }));
  });

  it('A cannot forge a new artifact', async () => {
    await assertFails(
      setDoc(doc(alice(), `users/${ALICE}/artifacts/forged`), { trust: 'first_party' }),
    );
  });

  it('A cannot delete an artifact to hide it', async () => {
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}/artifacts/a1`)));
  });

  it('A cannot approve their own pending tool call by editing status', async () => {
    // Approval must go through /api/agent/approve, which re-evaluates policy.
    await assertFails(
      updateDoc(doc(alice(), `users/${ALICE}/toolcalls/t1`), { status: 'executed' }),
    );
  });

  it('A cannot flip turnTaint to unblock a denied write', async () => {
    await assertFails(
      updateDoc(doc(alice(), `users/${ALICE}/toolcalls/t1`), { turnTaint: false, decision: 'ALLOW' }),
    );
  });

  it('A cannot forge a tool call', async () => {
    await assertFails(
      setDoc(doc(alice(), `users/${ALICE}/toolcalls/forged`), { tool: 'create_note' }),
    );
  });
});

describe('HOSTILE: audit log immutability (B.5)', () => {
  it('A cannot update an audit event', async () => {
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/audit/ev1`), { decision: 'ALLOW' }));
  });

  it('A cannot delete an audit event', async () => {
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}/audit/ev1`)));
  });

  it('A cannot forge an audit event', async () => {
    // create is denied to clients too: every legitimate write comes from the
    // Admin SDK, so denying create means history cannot be fabricated either.
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/audit/forged`), { decision: 'ALLOW' }));
  });

  it('B cannot write into A\'s audit log', async () => {
    await assertFails(setDoc(doc(bob(), `users/${ALICE}/audit/forged`), { decision: 'ALLOW' }));
  });
});

// ---------------------------------------------------------------
// The happy path must still work
// ---------------------------------------------------------------

describe('the owner can still use their own account', () => {
  it('A can read their own entry', async () => {
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/entries/e1`)));
  });

  it('A can write a new journal entry', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/${ALICE}/entries/new`), { title: 'Today' }));
  });

  it('A can add and remove their own sources', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/${ALICE}/sources/s2`), { ref: 'a/b' }));
    await assertSucceeds(deleteDoc(doc(alice(), `users/${ALICE}/sources/s2`)));
  });

  it('A can READ their artifacts, tool calls and audit log', async () => {
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/artifacts/a1`)));
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/toolcalls/t1`)));
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/audit/ev1`)));
  });

  it('B can use their own account normally', async () => {
    await assertSucceeds(setDoc(doc(bob(), `users/${BOB}/entries/b1`), { title: 'Bob' }));
    await assertSucceeds(getDoc(doc(bob(), `users/${BOB}/entries/b1`)));
  });
});
