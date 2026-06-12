/**
 * Deterministic checks for PM/discovery goal types: write-prd, design-arch,
 * research-external.
 *
 * Shape-level only: these checks verify that the artifact has the required
 * structural fields. They are not semantic judges — they do not read prose for
 * quality. Semantic quality is delegated to the judge types.
 *
 * - prdShapeCheck:        write-prd artifact has problem/users/outcome/scope/
 *                         requirements/acceptanceCriteria/openQuestions.
 * - archSectionCheck:     design-arch artifact has decision/rationale/tradeoffs/
 *                         alternatives sections (shape-level, doc text check).
 * - findingsSourceCheck:  research-external artifact: every finding carries a
 *                         non-empty source string.
 */

import type { DeterministicCheck } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { Artifact } from '../contract/report.js';
import { extractArtifactPayload } from './knowledge-checks.js';

// ---------------------------------------------------------------------------
// Shared JSON parse helper
// ---------------------------------------------------------------------------

function parsePayloadJson(
  artifact: Artifact | null,
): { ok: true; value: unknown } | { ok: false; detail: string } {
  if (artifact === null) {
    return { ok: false, detail: 'No artifact was produced.' };
  }
  const text = extractArtifactPayload(artifact);
  if (text === null) {
    return {
      ok: false,
      detail: `Expected a text artifact (or one fenced block); got kind "${artifact.kind}".`,
    };
  }
  if (text.length === 0) {
    return { ok: false, detail: 'Artifact text is empty.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Artifact is not valid JSON: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// write-prd shape check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `write-prd` artifact by
 * verifying the required top-level fields are present and the structural
 * invariants hold:
 *   - problem, users, outcome: non-empty strings / array
 *   - scope: object with in/out/deferred arrays
 *   - requirements: non-empty array, each item has id + text + traceableTo
 *   - acceptanceCriteria: non-empty array, each item has given/when/then
 *   - openQuestions: array (may be empty)
 */
export const prdShapeCheck: DeterministicCheck = {
  name: 'prd:shape',
  async run(
    _goal: Goal,
    artifact: Artifact | null,
  ): Promise<{ ok: boolean; detail: string }> {
    const parsed = parsePayloadJson(artifact);
    if (!parsed.ok) return { ok: false, detail: parsed.detail };

    const v = parsed.value as Record<string, unknown>;
    const missing: string[] = [];

    if (typeof v['problem'] !== 'string' || v['problem'].length === 0) {
      missing.push('problem (non-empty string)');
    }
    if (!Array.isArray(v['users'])) {
      missing.push('users (array)');
    }
    if (typeof v['outcome'] !== 'string' || v['outcome'].length === 0) {
      missing.push('outcome (non-empty string)');
    }

    // scope: object with in/out/deferred arrays
    if (
      typeof v['scope'] !== 'object' ||
      v['scope'] === null ||
      !Array.isArray((v['scope'] as Record<string, unknown>)['in']) ||
      !Array.isArray((v['scope'] as Record<string, unknown>)['out']) ||
      !Array.isArray((v['scope'] as Record<string, unknown>)['deferred'])
    ) {
      missing.push('scope.{in,out,deferred} (arrays)');
    }

    // requirements: non-empty array, each item has id+text+traceableTo
    if (!Array.isArray(v['requirements']) || v['requirements'].length === 0) {
      missing.push('requirements (non-empty array)');
    } else {
      const reqs = v['requirements'] as unknown[];
      const badReqs = reqs.filter(
        (r) =>
          typeof r !== 'object' ||
          r === null ||
          typeof (r as Record<string, unknown>)['id'] !== 'string' ||
          typeof (r as Record<string, unknown>)['text'] !== 'string' ||
          typeof (r as Record<string, unknown>)['traceableTo'] !== 'string',
      );
      if (badReqs.length > 0) {
        missing.push(`requirements[*].{id,text,traceableTo} (${badReqs.length} item(s) malformed)`);
      }
    }

    // acceptanceCriteria: non-empty array, each item has given/when/then
    if (!Array.isArray(v['acceptanceCriteria']) || v['acceptanceCriteria'].length === 0) {
      missing.push('acceptanceCriteria (non-empty array)');
    } else {
      const acs = v['acceptanceCriteria'] as unknown[];
      const badAcs = acs.filter(
        (a) =>
          typeof a !== 'object' ||
          a === null ||
          typeof (a as Record<string, unknown>)['given'] !== 'string' ||
          typeof (a as Record<string, unknown>)['when'] !== 'string' ||
          typeof (a as Record<string, unknown>)['then'] !== 'string',
      );
      if (badAcs.length > 0) {
        missing.push(`acceptanceCriteria[*].{given,when,then} (${badAcs.length} item(s) malformed)`);
      }
    }

    // openQuestions: array (may be empty)
    if (!Array.isArray(v['openQuestions'])) {
      missing.push('openQuestions (array)');
    }

    if (missing.length > 0) {
      return {
        ok: false,
        detail: `PRD shape check failed — missing or malformed: ${missing.join('; ')}`,
      };
    }

    const reqCount = (v['requirements'] as unknown[]).length;
    const acCount = (v['acceptanceCriteria'] as unknown[]).length;
    return {
      ok: true,
      detail: `PRD shape valid: ${reqCount} requirement(s), ${acCount} acceptance criterion(a).`,
    };
  },
};

// ---------------------------------------------------------------------------
// design-arch section check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `design-arch` artifact by
 * verifying the document text contains the four required section headings:
 * decision, rationale, tradeoffs, alternatives.
 *
 * The check is intentionally case-insensitive and accepts both Markdown heading
 * and plain-label forms, since model output varies in capitalization. Shape
 * only — content quality is delegated to critique-doc.
 */
export const archSectionCheck: DeterministicCheck = {
  name: 'arch:sections',
  async run(
    _goal: Goal,
    artifact: Artifact | null,
  ): Promise<{ ok: boolean; detail: string }> {
    if (artifact === null) {
      return { ok: false, detail: 'No artifact was produced.' };
    }

    // ADRs are doc artifacts: either a text artifact or a files artifact.
    // Extract all text content for section scanning.
    let text = '';
    if (artifact.kind === 'text') {
      text = artifact.text ?? '';
    } else if (artifact.kind === 'files') {
      text = (artifact.files ?? []).map((f) => f.content).join('\n');
    }

    if (text.length === 0) {
      return { ok: false, detail: 'Artifact text is empty.' };
    }

    const lower = text.toLowerCase();
    const required = ['decision', 'rationale', 'tradeoffs', 'alternatives'];
    const missing = required.filter((s) => !lower.includes(s));

    if (missing.length > 0) {
      return {
        ok: false,
        detail: `ADR/design artifact missing required section(s): ${missing.join(', ')}`,
      };
    }

    return {
      ok: true,
      detail: 'ADR/design artifact contains all required sections: decision, rationale, tradeoffs, alternatives.',
    };
  },
};

// ---------------------------------------------------------------------------
// research-external findings source check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `research-external` artifact
 * by parsing the JSON and verifying every finding carries a non-empty source
 * string. A finding without a source is an unsupported claim.
 */
export const findingsSourceCheck: DeterministicCheck = {
  name: 'findings:sources-present',
  async run(
    _goal: Goal,
    artifact: Artifact | null,
  ): Promise<{ ok: boolean; detail: string }> {
    const parsed = parsePayloadJson(artifact);
    if (!parsed.ok) return { ok: false, detail: parsed.detail };

    const v = parsed.value as Record<string, unknown>;

    if (!Array.isArray(v['findings'])) {
      return { ok: false, detail: 'Findings artifact missing "findings" array.' };
    }

    const findings = v['findings'] as unknown[];
    if (findings.length === 0) {
      return { ok: false, detail: 'Findings artifact has an empty "findings" array; at least one finding required.' };
    }

    const unsourced = findings.filter(
      (f) =>
        typeof f !== 'object' ||
        f === null ||
        typeof (f as Record<string, unknown>)['source'] !== 'string' ||
        ((f as Record<string, unknown>)['source'] as string).trim().length === 0,
    );

    if (unsourced.length > 0) {
      return {
        ok: false,
        detail: `${unsourced.length} finding(s) have a missing or empty source — every claim requires a source.`,
      };
    }

    return {
      ok: true,
      detail: `Findings shape valid: ${findings.length} finding(s), all sourced.`,
    };
  },
};
