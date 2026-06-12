import type { GoalTypeDef } from '../../contract/goal-type.js';
import { artifactPresent } from '../checks.js';
import { findingsSourceCheck } from '../pm-checks.js';
import { FINDINGS_SCHEMA } from '../pm-schemas.js';

export function researchTypes(): GoalTypeDef[] {
  return [
    /**
     * `research-external` — answer a question from external sources and emit
     * a cited findings artifact. Every claim carries a source; load-bearing
     * claims are corroborated by at least two independent sources. Key claims
     * are tagged for optional adversarial spot-check (judge delegation, not
     * per-claim fan-out). Facts are marked provisional and never written to
     * memory directly — the spawner promotes them.
     *
     * Tier: mid → high.
     * Grants: web search/fetch; external docs read. No fs.write — findings
     * are provisional artifacts, not durable state.
     * Per ADR-023: outputSchema drives structured emission.
     */
    {
      name: 'research-external',
      kind: 'learn',
      family: 'research',
      leafOnly: true,
      tier: { default: 'mid', ladder: ['mid', 'high'] },
      deterministic: [artifactPresent, findingsSourceCheck],
      judgeType: null,
      grants: ['web.search', 'web.fetch', 'retrieval.api'],
      outputSchema: FINDINGS_SCHEMA,
    },
  ];
}
