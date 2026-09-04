import { describe, it, expect, vi } from 'vitest';
import { requireAdmin, AuthedRequest } from './auth';

/**
 * INV-13 — Amendment E.
 *
 * requireAdmin reads `req.role`, which requireAuth populates from the VERIFIED
 * token's custom claims and from nowhere else. These tests pin the failure
 * posture, because the whole value of a claim-based role is that anything
 * ambiguous is denied.
 *
 * The case that matters most is the last one: a body, header or query claiming
 * a role must have no effect whatsoever.
 */

function ctx(role: unknown) {
  const req = { role } as unknown as AuthedRequest;
  const res = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('requireAdmin fails closed', () => {
  it('allows exactly the string "admin"', () => {
    const { req, res, next } = ctx('admin');
    requireAdmin(req, res as any, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['user', 'user'],
    ['Admin (wrong case)', 'Admin'],
    ['ADMIN', 'ADMIN'],
    ['admin with space', 'admin '],
    ['true', true],
    ['1', 1],
    ['object', { role: 'admin' }],
    ['array', ['admin']],
  ])('denies %s', (_label, role) => {
    const { req, res, next } = ctx(role);
    requireAdmin(req, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('says nothing about whether an admin role exists', () => {
    // Error text is a disclosure surface (INV-10). "Admin required" tells an
    // attacker there is something to escalate to.
    const { req, res, next } = ctx('user');
    requireAdmin(req, res as any, next);
    expect(String(res.body.error).toLowerCase()).not.toContain('admin');
    expect(String(res.body.error).toLowerCase()).not.toContain('role');
  });

  it('ignores a role claimed anywhere other than the verified token', () => {
    // The escalation this invariant exists for. requireAuth sets req.role from
    // decoded claims; a caller-supplied body/header/query must be inert.
    const req = {
      role: undefined,
      body: { role: 'admin' },
      headers: { 'x-role': 'admin', authorization: 'Bearer forged' },
      query: { role: 'admin' },
    } as unknown as AuthedRequest;
    const res = ctx(undefined).res;
    const next = vi.fn();

    requireAdmin(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });
});
