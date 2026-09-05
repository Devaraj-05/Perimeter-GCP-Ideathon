import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * A correlation id on every request — L2.
 *
 * Debugging this deployment meant grepping Cloud Run's textPayload and hoping
 * two log lines belonged to the same request. They often did not, and there
 * was no way to tell. An id per request, echoed to the client and printed on
 * one completion line, turns "something failed" into "request abc123 failed",
 * and a user reporting a problem can hand you the id from the response header.
 *
 * INV-10 still holds: the completion line carries the method, the path, the
 * status, the duration and the uid when known — never a body, a query value,
 * or a token. The path is logged WITHOUT its query string for the same reason.
 */
export interface WithRequestId extends Request {
  id?: string;
  uid?: string;
}

export function requestId(req: WithRequestId, res: Response, next: NextFunction): void {
  // Honour an upstream id if a proxy set one, so a trace spans hops; otherwise
  // mint one. Bounded and sanitised: a client-supplied header is untrusted
  // input like any other, and an id is only ever letters, digits and dashes.
  const upstream = req.header('x-request-id');
  const id =
    typeof upstream === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(upstream)
      ? upstream
      : randomUUID();

  req.id = id;
  res.setHeader('x-request-id', id);

  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    // The path only. req.path excludes the query string; req.originalUrl would
    // include it, and a query value can carry user content.
    const uid = req.uid ? ` uid=${req.uid}` : '';
    console.log(
      `[req ${id}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms${uid}`,
    );
  });

  next();
}
