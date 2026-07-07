/**
 * Curation — the deliberate ceremony that promotes a labeled golden candidate
 * into a versioned golden pair (ADR-024: promotion is human, never automatic).
 *
 * The event log remembers the candidate (digests, verdict, label) but NOT the
 * artifact/rubric bodies. Curation is where those bodies re-enter: the operator
 * supplies the exact artifact the judge saw and the enriched rubric, this step
 * verifies they match the candidate's pinned digests, and writes the pair as a
 * factory-repo fixture pinned at the SHA it shipped against.
 */

import { createHash } from 'node:crypto';
import type { GoldenCandidate, GoldenLabel } from '../../eventlog/projections.js';
import type { Artifact } from '../../contract/report.js';
import type { GoldenPair, GoldenOutcome } from './golden-set.js';
import type { GoldenStore } from './golden-store.js';

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

function artifactDigestInput(artifact: Artifact): string {
  return artifact.kind === 'text' ? (artifact.text ?? '') : JSON.stringify(artifact.files ?? []);
}

/** The inputs a curator supplies to promote one labeled candidate. */
export interface CurationInput {
  /** A labeled candidate from the `goldenCandidates` projection. */
  candidate: GoldenCandidate & { label: GoldenLabel };
  /** The goal-type whose judge this pair calibrates. */
  goalType: string;
  /** The exact artifact the judge saw — must match the candidate's digest. */
  artifact: Artifact;
  /** The enriched rubric the judge saw — must match the candidate's digest. */
  rubric: string;
  /** The commit SHA the artifact shipped against. */
  sha: string;
  /** The fixture id (basename); defaults to the candidate's goalId. */
  id?: string;
}

/**
 * Build a {@link GoldenPair} from a labeled candidate + its bodies, verifying
 * the supplied artifact and rubric hash to the candidate's pinned digests. A
 * mismatch means the operator supplied the wrong body for the pinned candidate —
 * a hard error, because a golden pair whose subject drifted from what the judge
 * actually saw would calibrate against a fiction.
 */
export function buildGoldenPair(input: CurationInput): GoldenPair {
  const artifactDigest = sha1(artifactDigestInput(input.artifact));
  if (artifactDigest !== input.candidate.artifactDigest) {
    throw new Error(
      `curate: artifact digest mismatch for ${input.candidate.goalId} — ` +
        `supplied ${artifactDigest}, candidate pinned ${input.candidate.artifactDigest}. ` +
        `The artifact body does not match the judged candidate.`,
    );
  }
  const rubricDigest = sha1(input.rubric);
  if (rubricDigest !== input.candidate.rubricDigest) {
    throw new Error(
      `curate: rubric digest mismatch for ${input.candidate.goalId} — ` +
        `supplied ${rubricDigest}, candidate pinned ${input.candidate.rubricDigest}. ` +
        `The rubric does not match the judged candidate.`,
    );
  }

  const pair: GoldenPair = {
    id: input.id ?? input.candidate.goalId,
    goalType: input.goalType,
    judgeType: input.candidate.judgeType,
    artifact: input.artifact,
    rubric: input.rubric,
    label: input.candidate.label.outcome as GoldenOutcome,
    labelSource: input.candidate.label.source,
    sha: input.sha,
    artifactDigest,
    rubricDigest,
    ...(input.candidate.label.note !== undefined ? { note: input.candidate.label.note } : {}),
  };
  return pair;
}

/** Promote a labeled candidate: build the pair and write it to the store. */
export async function curateGoldenPair(input: CurationInput, store: GoldenStore): Promise<GoldenPair> {
  const pair = buildGoldenPair(input);
  await store.save(pair);
  return pair;
}
