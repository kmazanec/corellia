/**
 * Operator auth for the control plane: one bearer token (ADR-026's
 * `FRONT_DOOR_TOKEN`), compared in constant time. The single seam where a
 * real identity provider plugs in later.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

export function bearerAuth(token: string): MiddlewareHandler {
  const expected = digest(token);
  return async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (presented === '' || !timingSafeEqual(digest(presented), expected)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  };
}
