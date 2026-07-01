import type { EventStore } from '../contract/events.js';
import type { PatternStore } from '../contract/pattern.js';

export async function promotePatternTrust(params: {
  patterns: PatternStore;
  store: EventStore;
  now: () => number;
  goalId: string;
  shape: string;
  to: 'provisional' | 'trusted';
  signer: string;
  rationale: string;
}): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> {
  const memo = await params.patterns.match(params.shape);
  if (memo === null) {
    return { ok: false, reason: `No split memo recorded for shape "${params.shape}"` };
  }

  if (memo.status === params.to) {
    return { ok: true, changed: false };
  }

  await params.store.append({
    type: 'pattern-trust-signed',
    at: params.now(),
    goalId: params.goalId,
    shape: params.shape,
    from: memo.status,
    to: params.to,
    signer: params.signer,
    rationale: params.rationale,
  });
  await params.patterns.promote(params.shape, params.to);

  return { ok: true, changed: true };
}
