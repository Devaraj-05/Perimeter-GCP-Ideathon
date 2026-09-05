import { describe, it, expect, vi } from 'vitest';
import { requestId, type WithRequestId } from './requestId';
import type { Response } from 'express';

/**
 * L2 — a correlation id per request, and INV-10 on the line it prints.
 */

function fakeReqRes(headers: Record<string, string> = {}, method = 'POST', path = '/api/agent/chat') {
  let finish: (() => void) | undefined;
  const setHeaders: Record<string, string> = {};
  const req = {
    method,
    path,
    header: (h: string) => headers[h.toLowerCase()],
  } as unknown as WithRequestId;
  const res = {
    statusCode: 200,
    setHeader: (k: string, v: string) => {
      setHeaders[k.toLowerCase()] = v;
    },
    on: (ev: string, cb: () => void) => {
      if (ev === 'finish') finish = cb;
    },
  } as unknown as Response;
  return { req, res, setHeaders, fire: () => finish?.() };
}

describe('every request gets an id', () => {
  it('mints one and echoes it to the client', () => {
    const { req, res, setHeaders } = fakeReqRes();
    requestId(req, res, () => {});
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeaders['x-request-id']).toBe(req.id);
  });

  it('honours a valid upstream id so a trace spans hops', () => {
    const { req, res } = fakeReqRes({ 'x-request-id': 'edge-abc-123' });
    requestId(req, res, () => {});
    expect(req.id).toBe('edge-abc-123');
  });

  it('rejects a malformed upstream id rather than trusting it', () => {
    // A header is untrusted input. A newline in it would forge a log line.
    const { req, res } = fakeReqRes({ 'x-request-id': 'evil\n[req x] injected' });
    requestId(req, res, () => {});
    expect(req.id).not.toContain('injected');
    expect(req.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('calls next so the request proceeds', () => {
    const next = vi.fn();
    const { req, res } = fakeReqRes();
    requestId(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('the completion line carries the id and nothing sensitive', () => {
  it('logs the id, method, path, status and duration', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { req, res, fire } = fakeReqRes();
    requestId(req, res, () => {});
    fire();
    const line = log.mock.calls[0][0] as string;
    expect(line).toContain(req.id!);
    expect(line).toContain('POST');
    expect(line).toContain('/api/agent/chat');
    expect(line).toContain('200');
    log.mockRestore();
  });

  it('logs req.path, never a query string that could carry user content', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // req.path is the pathname; the middleware must not reach for originalUrl.
    const { req, res, fire } = fakeReqRes({}, 'GET', '/api/ingest/artifacts');
    requestId(req, res, () => {});
    fire();
    const line = log.mock.calls[0][0] as string;
    expect(line).not.toContain('?');
    log.mockRestore();
  });

  it('includes the uid once auth has set it, and not before', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { req, res, fire } = fakeReqRes();
    requestId(req, res, () => {});
    req.uid = 'user-9'; // auth middleware runs after this one
    fire();
    expect(log.mock.calls[0][0]).toContain('uid=user-9');
    log.mockRestore();
  });
});
