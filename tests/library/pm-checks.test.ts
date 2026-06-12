/**
 * Engine-path tests for the PM/discovery deterministic checks.
 *
 * Each type gets a red (shape check fails) and a green (check passes) pair.
 * These exercise the check functions directly against synthetic artifacts so
 * they are fast and do not require a running engine.
 *
 * Types covered: write-prd (prdShapeCheck), design-arch (archSectionCheck),
 * research-external (findingsSourceCheck).
 */

import { describe, it, expect } from 'vitest';
import { prdShapeCheck, archSectionCheck, findingsSourceCheck } from '../../src/library/pm-checks.js';
import type { Goal } from '../../src/contract/goal.js';
import type { Artifact } from '../../src/contract/report.js';

// ---------------------------------------------------------------------------
// Minimal test fixtures
// ---------------------------------------------------------------------------

const stubGoal: Goal = {
  id: 'test-goal',
  type: 'write-prd',
  kind: 'make',
  spec: {},
  scope: [],
  intent: 'production',
  memories: [],
};

function textArtifact(text: string): Artifact {
  return { kind: 'text', text };
}

function filesArtifact(content: string, path = 'design.md'): Artifact {
  return { kind: 'files', files: [{ path, content }] };
}

// ---------------------------------------------------------------------------
// prdShapeCheck — write-prd
// ---------------------------------------------------------------------------

const validPrd = {
  problem: 'Users cannot reset their password.',
  users: ['registered user', 'admin'],
  outcome: 'Password reset completion rate reaches 95% within 30 days of launch.',
  scope: {
    in: ['password reset flow', 'email delivery'],
    out: ['social login', 'SSO'],
    deferred: ['SMS reset'],
  },
  requirements: [
    {
      id: 'R1',
      text: 'The system sends a reset link to the verified email address.',
      traceableTo: 'problem',
    },
  ],
  acceptanceCriteria: [
    {
      id: 'AC1',
      given: 'a registered user with a verified email',
      when: 'they request a password reset',
      then: 'they receive a reset link within 60 seconds',
      requirementRef: 'R1',
    },
  ],
  openQuestions: [],
};

describe('prdShapeCheck — write-prd', () => {
  it('red: fails when artifact is null', async () => {
    const result = await prdShapeCheck.run(stubGoal, null);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('No artifact');
  });

  it('red: fails when artifact text is empty', async () => {
    const result = await prdShapeCheck.run(stubGoal, textArtifact(''));
    expect(result.ok).toBe(false);
  });

  it('red: fails when problem field is missing', async () => {
    const bad = { ...validPrd, problem: '' };
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('problem');
  });

  it('red: fails when requirements array is empty', async () => {
    const bad = { ...validPrd, requirements: [] };
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('requirements');
  });

  it('red: fails when acceptanceCriteria items lack given/when/then', async () => {
    const bad = {
      ...validPrd,
      acceptanceCriteria: [{ id: 'AC1', requirementRef: 'R1' }],
    };
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('acceptanceCriteria');
  });

  it('red: fails when scope is missing deferred array', async () => {
    const bad = {
      ...validPrd,
      scope: { in: [], out: [] },
    };
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('scope');
  });

  it('green: passes for a well-formed PRD artifact', async () => {
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(validPrd)));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('PRD shape valid');
  });

  it('green: passes for a PRD in a fenced code block', async () => {
    const fenced = '```json\n' + JSON.stringify(validPrd) + '\n```';
    const result = await prdShapeCheck.run(stubGoal, textArtifact(fenced));
    expect(result.ok).toBe(true);
  });

  it('green: passes for an open-questions array with items', async () => {
    const withQ = {
      ...validPrd,
      openQuestions: [{ id: 'Q1', question: 'Who owns the email service?', impact: 'delivery SLA' }],
    };
    const result = await prdShapeCheck.run(stubGoal, textArtifact(JSON.stringify(withQ)));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// archSectionCheck — design-arch
// ---------------------------------------------------------------------------

const validAdr = `
# ADR-001: Authentication approach

## Context
We need a stateless auth mechanism for the API.

## Options
- JWT tokens
- Session cookies

## Decision
Use JWT tokens.

## Rationale
JWTs are stateless and suit our distributed setup.
Sessions would require shared storage.

## Tradeoffs
Token revocation requires a denylist; session invalidation is simpler.

## Alternatives
Session-cookie approach was explored and rejected due to the shared-storage
requirement as documented in this section.
`;

describe('archSectionCheck — design-arch', () => {
  it('red: fails when artifact is null', async () => {
    const result = await archSectionCheck.run(stubGoal, null);
    expect(result.ok).toBe(false);
  });

  it('red: fails when decision section is absent', async () => {
    const noDecision = validAdr.replace(/## Decision[\s\S]*?## Rationale/, '## Rationale');
    const result = await archSectionCheck.run(stubGoal, textArtifact(noDecision));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('decision');
  });

  it('red: fails when rationale section is absent', async () => {
    const noRationale = validAdr.replace('Rationale', 'Background');
    const result = await archSectionCheck.run(stubGoal, textArtifact(noRationale));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('rationale');
  });

  it('red: fails when tradeoffs section is absent', async () => {
    const noTradeoffs = validAdr.replace('Tradeoffs', 'Notes');
    const result = await archSectionCheck.run(stubGoal, textArtifact(noTradeoffs));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('tradeoffs');
  });

  it('red: fails when alternatives section is absent', async () => {
    const noAlt = validAdr.replace('Alternatives', 'Further reading');
    const result = await archSectionCheck.run(stubGoal, textArtifact(noAlt));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('alternatives');
  });

  it('green: passes for a well-formed ADR text artifact', async () => {
    const result = await archSectionCheck.run(stubGoal, textArtifact(validAdr));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('required sections');
  });

  it('green: passes for a well-formed ADR files artifact', async () => {
    const result = await archSectionCheck.run(stubGoal, filesArtifact(validAdr, 'docs/ADR-001.md'));
    expect(result.ok).toBe(true);
  });

  it('green: is case-insensitive for section headings', async () => {
    const lowercase = validAdr
      .replace('Decision', 'decision')
      .replace('Rationale', 'rationale')
      .replace('Tradeoffs', 'tradeoffs')
      .replace('Alternatives', 'alternatives');
    const result = await archSectionCheck.run(stubGoal, textArtifact(lowercase));
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findingsSourceCheck — research-external
// ---------------------------------------------------------------------------

const validFindings = {
  question: 'What are the performance characteristics of WebSockets vs SSE?',
  findings: [
    {
      claim: 'WebSockets have lower latency for bidirectional communication.',
      source: 'https://example.com/websockets-perf',
      loadBearing: true,
      confidence: 'high',
    },
    {
      claim: 'SSE is simpler to implement for server-push-only scenarios.',
      source: 'https://example.com/sse-overview',
      loadBearing: false,
      confidence: 'medium',
    },
  ],
  confidence: 'high',
  openQuestions: ['What is the browser reconnect behavior under network drop?'],
};

describe('findingsSourceCheck — research-external', () => {
  it('red: fails when artifact is null', async () => {
    const result = await findingsSourceCheck.run(stubGoal, null);
    expect(result.ok).toBe(false);
  });

  it('red: fails when findings array is missing', async () => {
    const bad = { question: 'Q?', confidence: 'low', openQuestions: [] };
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('findings');
  });

  it('red: fails when findings array is empty', async () => {
    const bad = { ...validFindings, findings: [] };
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('empty');
  });

  it('red: fails when a finding has a missing source', async () => {
    const bad = {
      ...validFindings,
      findings: [
        { claim: 'WebSockets are fast.', loadBearing: true, confidence: 'high' },
      ],
    };
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('source');
  });

  it('red: fails when a finding has an empty source string', async () => {
    const bad = {
      ...validFindings,
      findings: [
        { claim: 'WebSockets are fast.', source: '   ', loadBearing: true, confidence: 'high' },
      ],
    };
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(bad)));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('source');
  });

  it('green: passes for a well-formed findings artifact', async () => {
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(validFindings)));
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('Findings shape valid');
  });

  it('green: passes for a single finding with a source', async () => {
    const single = {
      ...validFindings,
      findings: [validFindings.findings[0]],
    };
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(JSON.stringify(single)));
    expect(result.ok).toBe(true);
  });

  it('green: passes for a findings artifact in a fenced block', async () => {
    const fenced = '```json\n' + JSON.stringify(validFindings) + '\n```';
    const result = await findingsSourceCheck.run(stubGoal, textArtifact(fenced));
    expect(result.ok).toBe(true);
  });
});
