import { describe, it, expect } from 'vitest';
import { classifyRisk, DEFAULT_SENSITIVITY } from '../../src/library/risk.js';
import type { SensitivityFact } from '../../src/contract/risk.js';

const highFact: SensitivityFact = { pattern: 'auth', reason: 'auth surface', risk: 'high' };
const medFact: SensitivityFact = { pattern: 'deploy', reason: 'deploy config', risk: 'medium' };
const lowFact: SensitivityFact = { pattern: 'readme', reason: 'docs only', risk: 'low' };

// ── No match → low ────────────────────────────────────────────────────────

describe('classifyRisk — no match', () => {
  it('returns low when paths is empty', () => {
    expect(classifyRisk([], [highFact])).toBe('low');
  });

  it('returns low when facts is empty', () => {
    expect(classifyRisk(['src/auth/login.ts'], [])).toBe('low');
  });

  it('returns low when no path intersects any fact pattern', () => {
    expect(classifyRisk(['src/components/button.ts'], [highFact, medFact])).toBe('low');
  });
});

// ── Single match ──────────────────────────────────────────────────────────

describe('classifyRisk — single match', () => {
  it('returns high when a path starts with the high-risk pattern', () => {
    expect(classifyRisk(['auth/session.ts'], [highFact])).toBe('high');
  });

  it('returns high when a path contains the pattern as a substring', () => {
    expect(classifyRisk(['src/auth/session.ts'], [highFact])).toBe('high');
  });

  it('returns medium when a path matches a medium fact', () => {
    expect(classifyRisk(['deploy/prod.yml'], [medFact])).toBe('medium');
  });

  it('returns low when a path matches a low fact', () => {
    expect(classifyRisk(['readme.md'], [lowFact])).toBe('low');
  });
});

// ── Multi-match: highest wins ─────────────────────────────────────────────

describe('classifyRisk — multi-match takes highest', () => {
  it('returns high when one path is high-risk and another is medium', () => {
    const paths = ['deploy/config.yml', 'src/auth/login.ts'];
    expect(classifyRisk(paths, [highFact, medFact])).toBe('high');
  });

  it('returns medium when only medium and low facts match', () => {
    const paths = ['deploy/config.yml', 'readme.md'];
    expect(classifyRisk(paths, [medFact, lowFact])).toBe('medium');
  });

  it('returns high as soon as any path matches a high-risk fact (short-circuit)', () => {
    // Multiple paths, last one matches high — still returns high
    const paths = ['src/utils.ts', 'src/helpers.ts', 'src/auth/tokens.ts'];
    expect(classifyRisk(paths, [highFact, medFact])).toBe('high');
  });
});

// ── Prefix vs substring ───────────────────────────────────────────────────

describe('classifyRisk — prefix and substring both match', () => {
  it('matches when path starts with pattern (prefix)', () => {
    expect(classifyRisk(['auth/index.ts'], [highFact])).toBe('high');
  });

  it('matches when pattern appears as substring in path', () => {
    expect(classifyRisk(['src/features/auth-service/index.ts'], [highFact])).toBe('high');
  });

  it('does not match when pattern is not in path at all', () => {
    expect(classifyRisk(['src/features/authorization.ts'.replace('auth', 'NOTAUTH')], [highFact])).toBe('low');
  });
});

// ── DEFAULT_SENSITIVITY covers expected patterns ──────────────────────────

describe('DEFAULT_SENSITIVITY', () => {
  it('classifies .env paths as high', () => {
    expect(classifyRisk(['.env.production'], DEFAULT_SENSITIVITY)).toBe('high');
  });

  it('classifies auth paths as high', () => {
    expect(classifyRisk(['src/auth/guard.ts'], DEFAULT_SENSITIVITY)).toBe('high');
  });

  it('classifies migration paths as high', () => {
    expect(classifyRisk(['db/migrations/001_add_users.sql'], DEFAULT_SENSITIVITY)).toBe('high');
  });

  it('classifies secret paths as high', () => {
    expect(classifyRisk(['config/secrets.json'], DEFAULT_SENSITIVITY)).toBe('high');
  });

  it('classifies deploy paths as medium', () => {
    expect(classifyRisk(['deploy/staging.yml'], DEFAULT_SENSITIVITY)).toBe('medium');
  });

  it('classifies .github/ paths as medium', () => {
    expect(classifyRisk(['.github/workflows/ci.yml'], DEFAULT_SENSITIVITY)).toBe('medium');
  });

  it('classifies unrelated paths as low', () => {
    expect(classifyRisk(['src/components/button.tsx'], DEFAULT_SENSITIVITY)).toBe('low');
  });
});
