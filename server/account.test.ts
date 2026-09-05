import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TOOL_REGISTRY } from './tools';

/**
 * Export and deletion — Amendment N, INV-22 and INV-23.
 *
 * Source-grep, matching gmail.test.ts and inv8.test.ts: these are claims about
 * code that a runtime test cannot reach without a live project and a real
 * account to destroy. The behavioural half belongs in the emulator suite.
 */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (f: string) => readFileSync(join(process.cwd(), 'server', f), 'utf8');
const ACCOUNT = strip(read('account.ts'));
const ROUTES = strip(read('accountRoutes.ts'));

describe('INV-22 — an export carries no credential', () => {
  it('excludes the private collection from the exported set', () => {
    // users/{uid}/private holds the sealed Gmail and GitHub tokens.
    const exported = ACCOUNT.slice(
      ACCOUNT.indexOf('EXPORTED_COLLECTIONS'),
      ACCOUNT.indexOf('] as const', ACCOUNT.indexOf('EXPORTED_COLLECTIONS')),
    );
    expect(exported).not.toContain('private');
  });

  it('still DELETES the private collection', () => {
    // Excluded from the export, not from the deletion. A token left behind
    // because it was too sensitive to export would be the worst outcome.
    expect(ACCOUNT).toContain("PRIVATE_COLLECTIONS = ['private']");
    expect(ACCOUNT).toContain('...EXPORTED_COLLECTIONS, ...PRIVATE_COLLECTIONS');
  });

  it('exports exactly the collections the rules define under a user', () => {
    for (const c of [
      'entries',
      'sources',
      'artifacts',
      'segments',
      'capabilities',
      'toolcalls',
      'destinations',
      'redteam_runs',
      'audit',
      'perimeter_events',
    ]) {
      expect(ACCOUNT, c).toContain(`'${c}'`);
    }
  });

  it('tells the reader what the export does not prove', () => {
    // A hash chain verifies against the collection it lives in. A JSON copy of
    // it is a record, and letting someone believe otherwise would be worse
    // than not exporting it.
    const src = read('account.ts');
    expect(src).toMatch(/hash-chained log/);
    expect(src).toMatch(/not proof|record, not proof/);
  });
});

describe('INV-23 — deletion is ordered to survive a partial failure', () => {
  it('revokes third-party grants before deleting local state', () => {
    // A token we have forgotten is still a token that works, and after the
    // local record is gone there is nothing left to revoke it with.
    const revoke = ACCOUNT.indexOf('await revoke(uid)');
    const wipe = ACCOUNT.indexOf('recursiveDelete');
    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(wipe);
  });

  it('deletes the Auth user LAST', () => {
    // Deleting the identity first would strand data nobody can authenticate
    // to reach, and therefore nobody can ever remove.
    const wipe = ACCOUNT.indexOf('recursiveDelete');
    const authDelete = ACCOUNT.indexOf('deleteUser(uid)');
    expect(authDelete).toBeGreaterThan(wipe);
  });

  it('revokes sessions before removing the identity', () => {
    expect(ACCOUNT.indexOf('revokeRefreshTokens')).toBeLessThan(
      ACCOUNT.indexOf('deleteUser(uid)'),
    );
  });

  it('reports whether the Auth user actually went', () => {
    // An account that can still sign in to an empty workspace is a confusing
    // state, and the user should be told rather than discover it.
    expect(ACCOUNT).toContain('authUserDeleted');
    expect(ROUTES).toContain('authUserDeleted: report.authUserDeleted');
  });

  it('a provider that refuses to revoke does not strand the deletion', () => {
    const block = ACCOUNT.slice(ACCOUNT.indexOf('await revoke(uid)'));
    expect(block.slice(0, 400)).toContain('catch');
  });
});

describe('INV-3 — neither route can act on another user', () => {
  it('takes the uid from the verified token only', () => {
    expect(ROUTES).toContain('const uid = req.uid!');
    expect(ROUTES).not.toContain('body.uid');
    expect(ROUTES).not.toContain('query.uid');
    expect(ROUTES).not.toContain('params.uid');
  });

  it('both routes require auth', () => {
    const routes = [...ROUTES.matchAll(/accountRouter\.(get|post)\('([^']+)',\s*([a-zA-Z]+)/g)];
    expect(routes.length).toBe(2);
    for (const [, , path, second] of routes) {
      expect(second, path).toBe('requireAuth');
    }
  });

  it('exportAccount takes a uid and nothing that could widen it', () => {
    expect(ACCOUNT).toMatch(/export async function exportAccount\(uid: string\)/);
    expect(ACCOUNT).toMatch(/export async function deleteAccount\(uid: string\)/);
  });
});

describe('the agent cannot export or delete anything', () => {
  it('no tool touches an account', () => {
    // The structural reason an injection fails here: there is nothing to call.
    // Not a refusal, not prompt wording — an empty registry.
    const names = Object.keys(TOOL_REGISTRY);
    for (const forbidden of ['export', 'delete', 'account', 'erase', 'wipe']) {
      expect(names.filter((n) => n.includes(forbidden)), forbidden).toEqual([]);
    }
  });

  it('the tool registry is still only the four known tools', () => {
    // If a fifth appears, this test should be the thing that asks why.
    expect(Object.keys(TOOL_REGISTRY).sort()).toEqual([
      'create_note',
      'search_artifacts',
      'send_digest',
      'summarise_source',
    ]);
  });
});

describe('deletion requires an explicit confirmation, server-side', () => {
  it('refuses without the typed word', () => {
    // A guard that lives only in the UI is a suggestion to anyone holding a
    // token, not a control.
    expect(ROUTES).toContain("body.confirm !== 'DELETE'");
    expect(ROUTES).toContain('confirmation_required');
  });

  it('logs the request BEFORE deleting the collection it logs into', () => {
    const logged = ROUTES.indexOf('account_deletion_requested');
    const deleted = ROUTES.indexOf('await deleteAccount(uid)');
    expect(logged).toBeGreaterThan(-1);
    expect(logged).toBeLessThan(deleted);
  });
});
