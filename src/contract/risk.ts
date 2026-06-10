/**
 * The risk vocabulary the factory classifies goals and scopes against before
 * any fan-out. Risk is orthogonal to intent: a relaxed-judge spike that touches
 * an authentication path is still high-risk and still gated. Risk is a property
 * of the instance — the reach a goal actually has — not of the type's capability.
 */

/**
 * The blast-radius band a goal or a touched scope falls into. Drives whether a
 * goal must route through a human gate before its children spawn:
 *
 * - `low`    — local, reversible, no sensitive surface; proceeds unattended.
 * - `medium` — wider reach or partial reversibility; weighed, not auto-gated.
 * - `high`   — touches a sensitive surface; routed through a human brief.
 */
export type RiskClass = 'low' | 'medium' | 'high';

/**
 * A recorded fact that touching a path or scope pattern raises an instance's
 * risk. Sensitivity is learned and ambient — a path/scope pattern whose touch
 * lifts the risk band of any goal whose scope intersects it, with the reason the
 * human can read at gate time.
 */
export interface SensitivityFact {
  /** The path or scope pattern whose touch carries risk (e.g. `src/auth/**`). */
  pattern: string;
  /** Why touching this pattern is sensitive, surfaced in the gate brief. */
  reason: string;
  /** The risk band a goal inherits when its scope intersects this pattern. */
  risk: RiskClass;
}
