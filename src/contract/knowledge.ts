/**
 * Knowledge artifacts: the factory's typed project memory about a target repo —
 * what `map-repo` and `deep-dive-region` learn so the split gate, retrieval API,
 * and regression guard can consume it. These are the frozen shapes; the storage
 * home is the event log (ADR-019: appended as `knowledge-written` events,
 * materialized by a `projectKnowledge` projection — one substrate, no new
 * machinery).
 *
 * The governing design rules, encoded in these shapes:
 *   - **pointers-not-bodies** — an artifact carries paths + line anchors + short
 *     notes, never the file contents. The repo remains the body; consumers
 *     re-read the touched region for content (context cost paid per touch).
 *   - **verify-on-read** — every artifact is SHA-anchored (`generatedAtSha`) and
 *     every dive fact carries `file:line` anchors at a SHA, so freshness is a
 *     mechanical recheck (SHA match, or the category's cheap self-validation)
 *     rather than a trust assumption. A stale fact is never silently used.
 */

/**
 * The kinds of knowledge the factory can hold about a repo. The full union is
 * frozen now (seven members) even though iteration 04 ships only the first four
 * (`architecture`, `stack`, `conventions`, `test-scaffold`) — freezing the
 * vocabulary keeps the projection key and the coverage policy table stable as
 * the remaining categories come online.
 */
export type KnowledgeCategory =
  | 'architecture'
  | 'stack'
  | 'conventions'
  | 'design-system'
  | 'deps'
  | 'test-scaffold'
  | 'credentials';

/**
 * A single pointer into the repo: where to look, not what is there. The `note`
 * orients the reader to why this location matters; the body is fetched by
 * re-reading the repo at `path` (optionally `line`) — pointers-not-bodies.
 */
export interface KnowledgePointer {
  /** Repo-relative path the pointer references. */
  path: string;
  /** Optional 1-based line anchor within the file. */
  line?: number;
  /** Short prose: why this location matters to the category. */
  note: string;
}

/**
 * One materialized unit of project memory: the latest knowledge of a given
 * `category` about a `repoRoot`, anchored to the SHA it was generated against.
 *
 * `confidence` is the producer's self-assessment; `status` is the freshness/trust
 * lifecycle — `provisional` until corroborated, `trusted` once it has earned it.
 * `generatedAtSha` is the verify-on-read anchor: a consumer compares it against
 * the repo's current HEAD and, on mismatch, runs the category's cheap
 * self-validation before reusing or refreshing (ADR-019's checkpoint rule).
 *
 * `pointers` and `summary` together obey pointers-not-bodies: `summary` is a
 * short prose orientation (a few sentences), not a dump of file contents.
 */
export interface KnowledgeArtifact {
  /** Absolute root of the repo this artifact describes. */
  repoRoot: string;
  /** Which kind of knowledge this artifact holds. */
  category: KnowledgeCategory;
  /** The repo SHA this artifact was generated against — the freshness anchor. */
  generatedAtSha: string;
  /** The producer's self-assessed confidence in the artifact. */
  confidence: 'low' | 'medium' | 'high';
  /** Freshness/trust lifecycle state: provisional until corroborated. */
  status: 'provisional' | 'trusted';
  /** Where to look in the repo — paths + line anchors + notes, never bodies. */
  pointers: KnowledgePointer[];
  /** Short prose orientation to the category; not a body dump. */
  summary: string;
}

/**
 * One semantic claim produced by a deep dive, made verifiable-on-read by its
 * `file:line` anchors at a `sha`. Dive facts enrich judgment (runtime coupling,
 * conventions, "how guarded is this") but the mechanical coverage check and the
 * impacted-slice never depend on them — facts get a fact-grade mechanism, this
 * layer is the judge's semantics (ADR-020).
 */
export interface DiveFact {
  /** The claim being asserted about the region. */
  claim: string;
  /** Anchors that make the claim verifiable-on-read at `sha`. */
  anchors: { path: string; line: number }[];
  /** The repo SHA the anchors are valid against. */
  sha: string;
  /** The dive's self-assessed confidence in the claim. */
  confidence: 'low' | 'medium' | 'high';
}

/**
 * The output of one `deep-dive-region` run: a set of anchored semantic facts
 * about a named `region` of a repo, generated against a SHA. Evented separately
 * from `KnowledgeArtifact` so dive provenance ("which dive wrote this fact")
 * falls out of the log per ADR-003/ADR-019.
 */
export interface RegionFacts {
  /** Absolute root of the repo the region belongs to. */
  repoRoot: string;
  /** The region the dive examined (e.g. a directory or module path). */
  region: string;
  /** The repo SHA the dive ran against. */
  generatedAtSha: string;
  /** The anchored semantic facts the dive produced. */
  facts: DiveFact[];
}
