/**
 * The upward half of the one handoff contract: a child's return is never a bare
 * artifact but a typed report whose streams are each routed differently at the
 * parent's integrate edge.
 */

/**
 * What a goal produced. The output contract of every make-kind type, including
 * its proof: a discriminated body that is either a set of files (a diff) or a
 * block of text (a document, a finding).
 */
export interface Artifact {
  /** Whether this artifact is a file set or a text body. */
  kind: 'files' | 'text';
  /** The files, when `kind` is `files`. Each is path + full content. */
  files?: { path: string; content: string }[];
  /** The text body, when `kind` is `text`. */
  text?: string;
  /**
   * Set ONLY on an empty artifact the producer could not fill: the diagnosed
   * reason it came back empty, after a targeted re-ask and a mid-band fallback
   * failed to recover content. Lets the deterministic artifact-present gate and
   * the resulting block brief name WHY the artifact is empty (truncation, a
   * refusal, a parse-drop, or a bare empty response) instead of a generic "no
   * actionable repair." Absent on any non-empty artifact.
   */
  emptyDiagnosis?: EmptyDiagnosis;
}

/**
 * Why a producer's artifact came back empty. A diagnosable failure mode plus a
 * short raw sample so an operator can see what the provider actually returned:
 *
 * - `truncated`      — the provider cut the output off (finish_reason 'length').
 * - `refusal`        — the model declined ("I can't / I cannot / sorry …").
 * - `parse-drop`     — the model returned content, but post-processing (fenced-block
 *   parsing) dropped it all to nothing.
 * - `empty-response` — the provider returned no content at all (whitespace or blank).
 */
export interface EmptyDiagnosis {
  reason: 'truncated' | 'refusal' | 'parse-drop' | 'empty-response';
  /** A short excerpt of the raw completion (bounded) for the block brief and the log. */
  rawSample: string;
}

/**
 * The typed report a goal emits upward. Each field is a stream the integrate
 * edge routes on its own: the artifact and proof feed the integration eval;
 * lessons feed eval-gated promotion to memory; memories-used feed reinforcement
 * writes; blockers feed the improvement loop; findings become proposed root
 * goals (tickets); `learned` leaves the human smarter than they arrived.
 */
export interface Report {
  /** The produced artifact, or null when the goal produced no artifact (e.g. a pure block). */
  artifact: Artifact | null;
  /** The proof artifact for the goal-type — tests, screenshots, a rollback plan, an evidence chain. */
  proof: string[];
  /** Lessons encountered, offered up for eval-gated promotion to memory by the parent. */
  lessons: string[];
  /** Ids of the memories this goal actually used — the causal signal for reinforcement and decay. */
  memoriesUsed: string[];
  /** Friction reports; out-of-tree work the goal could not do, escalated as blockers. */
  blockers: string[];
  /** Out-of-scope discoveries — proposed root goals (tickets), never in-tree fixes. */
  findings: string[];
  /** Two-to-four plain sentences of what building this taught — carried at every boundary handoff. */
  learned: string;
  /**
   * Set when the goal's actual work could not stay inside its declared scope.
   * The goal cannot emit; the parent expands the scope or re-splits, consuming
   * an attempt. Absent means the work stayed in scope.
   */
  scopeInsufficiency?: string;
}
