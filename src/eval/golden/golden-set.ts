/**
 * The versioned golden set — the durable half of judge calibration.
 *
 * The epistemic rule (DESIGN.md): a thing validatable only by its OUTCOME is a
 * versioned artifact, and the justification regress terminates at exogenous
 * ground truth. A golden pair is exactly that: a judged artifact + rubric,
 * pinned with the SHA and rubric digest it shipped against, plus the EXOGENOUS
 * label (a merge/rejection or human verdict — never another eval). It lives as a
 * factory-repo fixture so it is versioned, reviewable, and replayable — not in
 * the event log, which remembers the candidate but deliberately does not
 * duplicate artifact bodies.
 *
 * A judge is calibrated by replaying its golden set: run each pair through the
 * judge and score its verdict against the pair's label. Drift becomes a query.
 */

/** The exogenous outcome a pair is calibrated against; mirrors the label event. */
export type GoldenOutcome = 'merged' | 'rejected' | 'confirmed' | 'refuted';

/**
 * One golden pair: the judged context (artifact + rubric), the exogenous label,
 * and the pinning provenance. Stored as one JSON fixture under
 * `fixtures/golden/<goalType>/<id>.json`.
 */
export interface GoldenPair {
  /** Stable id within the goal-type's set — the fixture's basename. */
  id: string;
  /** The goal-type whose judge this pair calibrates (e.g. `implement`). */
  goalType: string;
  /** The judge type that rendered the original verdict (e.g. `critique-code`). */
  judgeType: string;
  /** The artifact the judge saw — the versioned subject. */
  artifact: import('../../contract/report.js').Artifact;
  /** The enriched rubric the judge saw. */
  rubric: string;
  /**
   * The exogenous ground truth this pair encodes as a pass/fail EXPECTATION for
   * the judge: `merged`/`confirmed` → the judge should PASS the artifact;
   * `rejected`/`refuted` → the judge should FAIL it. This mapping is the whole
   * calibration signal.
   */
  label: GoldenOutcome;
  /** The source that delivered the label (an operator, a PR-merge listener). */
  labelSource: string;
  /** The commit SHA the artifact shipped against — the point-in-time pin. */
  sha: string;
  /** Digests carried forward from the original candidate, for provenance. */
  artifactDigest: string;
  rubricDigest: string;
  /** Optional free-text note from curation. */
  note?: string;
}

/**
 * The pass/fail EXPECTATION a label places on the judge. `merged`/`confirmed`
 * are positive ground truth (the work was good → the judge should have passed);
 * `rejected`/`refuted` are negative (the work was bad → the judge should have
 * failed). This is the single place the outcome→expectation mapping lives.
 */
export function expectedPass(label: GoldenOutcome): boolean {
  return label === 'merged' || label === 'confirmed';
}
