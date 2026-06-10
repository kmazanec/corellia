/**
 * A judge's output. Authoritative verdicts are rendered at the parent's
 * integrate edge; a child's "done" is only a claim until a verdict says
 * otherwise. The verdict is executable, not merely visible — its findings carry
 * prescriptions the repair rung applies.
 */

/**
 * One thing a judge found wrong, along a single review dimension. A finding is
 * the unit the control loop acts on: a gating finding with a prescription is
 * repaired by a cheap fixer; an escalated finding bypasses the ladder and blocks.
 */
export interface Finding {
  /** Short label for the issue. */
  title: string;
  /**
   * The review dimension this finding belongs to — the six-dimension single-read
   * rubric: does it meet the spec; is it secure; does the contrarian lens object;
   * is it robust; is it efficient and simple; does it follow convention?
   */
  dimension: 'spec' | 'security' | 'contrarian' | 'robustness' | 'efficiency' | 'convention';
  /** How bad it is; high-severity security/spec findings are what a skeptic re-checks. */
  severity: 'high' | 'medium' | 'low';
  /** Whether this finding blocks the verdict from passing. Non-gating findings are advisory. */
  gating: boolean;
  /**
   * A concrete, localized fix the repair rung applies verbatim. Present only when
   * a localized fix is possible; its absence is what pushes the loop to escalate
   * the tier instead of repairing.
   */
  prescription?: string;
  /**
   * Set when the fix needs a frozen-contract change or a re-architecture rather
   * than a localized edit. Such a finding skips the tier ladder and goes straight
   * to block: that decision is the human's, not a bigger model's.
   */
  escalated?: boolean;
}

/**
 * A judge's verdict on a subject artifact. Pass/fail drives the control loop;
 * the findings carry the prescriptions repair applies.
 */
export interface Verdict {
  /** Whether the subject passed. False with gating findings drives repair / escalation / block. */
  pass: boolean;
  /** Everything the judge found, gating and advisory. */
  findings: Finding[];
  /**
   * A stable signature of the failure shape, used to detect when attempt N+1's
   * failure is isomorphic to attempt N's — the cue to jump out of the ladder
   * early instead of climbing rung by mechanical rung. Absent on a pass.
   */
  failureSignature?: string;
}
