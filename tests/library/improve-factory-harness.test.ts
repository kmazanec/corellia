/**
 * F-63 Chunk 3 — improve-factory deep harness tests.
 *
 * These tests run against the REAL improve-factory skill file at
 * src/library/skills/improve.md — NOT a synthetic stand-in.
 * This is the iteration-05 lesson: prompt-content blind spots are caught by
 * asserting against the real artifact.
 *
 * Verifies that the skill file contains the required harness elements:
 * - Event-log pointer read section.
 * - Generality routing decision (repo-specific → memory write; repo-agnostic → PR).
 * - PR discipline (architecture-locked; allowed/prohibited PR content).
 * - push_branch / open_pr tool usage.
 * - Runaway-loop guard instruction.
 * - "done" criteria for both routes.
 *
 * Also verifies the improve-factory GoalTypeDef:
 * - Tier default is 'high'.
 * - Ladder is non-empty and starts at 'high' (allows escalation for uncertain
 *   generality judgment — ADR-027).
 * - Required grants: event-log.read, repo.branch, repo.pr.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { improveTypes } from '../../src/library/types/improve.js';
import { loadFamilySkill, _clearSkillCache } from '../../src/library/skills.js';

// ── The real skill file path ──────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REAL_SKILL_FILE = join(__dirname, '../../src/library/skills/improve.md');

// ── Skill file content tests ──────────────────────────────────────────────────

describe('improve-factory skill file — the real src/library/skills/improve.md', () => {
  const content = readFileSync(REAL_SKILL_FILE, 'utf-8');

  it('contains the improve-factory section header', () => {
    expect(content).toContain('## improve-factory');
  });

  it('contains event-log pointer reading instruction', () => {
    // Must instruct the model to read the event log before anything else.
    expect(content).toMatch(/event.?log\s+pointer|eventLogPointer|event log.*before/i);
  });

  it('contains generality routing decision', () => {
    // Must have both Route A (repo-specific → memory) and Route B (repo-agnostic → PR).
    expect(content).toMatch(/repo.specific.*memory|memory.*repo.specific/i);
    expect(content).toMatch(/repo.agnostic.*PR|PR.*repo.agnostic/i);
  });

  it('contains explicit "Route A" and "Route B" labels', () => {
    expect(content).toContain('Route A');
    expect(content).toContain('Route B');
  });

  it('instructs memory write for repo-specific lessons (no PR)', () => {
    // Route A must explicitly say no PR.
    expect(content).toMatch(/no PR|NOT.*open.*PR|no.*branch|Do NOT open/i);
  });

  it('instructs branch + PR for repo-agnostic fixes', () => {
    // Route B must mention both push_branch and open_pr.
    expect(content).toContain('push_branch');
    expect(content).toContain('open_pr');
  });

  it('enforces "the architecture is locked" constraint', () => {
    expect(content).toMatch(/architecture is locked|architecture.*locked/i);
  });

  it('lists allowed PR content: prompts, skills, scripts, eval sets, type defs', () => {
    expect(content).toMatch(/skill/i);
    expect(content).toMatch(/prompt/i);
    expect(content).toMatch(/eval.set/i);
    expect(content).toMatch(/type.def|GoalTypeDef|goal.type/i);
  });

  it('lists prohibited PR content: structural engine changes, merge/approve grants', () => {
    expect(content).toMatch(/may NOT|must NOT|prohibited|not.*merge|not.*approve/i);
  });

  it('instructs open_pr idempotence (one PR per tree)', () => {
    expect(content).toMatch(/idempotent|one.shot|one PR/i);
  });

  it('contains "done" criteria for both routes', () => {
    // Use /s flag (dotAll) so . matches newlines — the "done" section spans multiple lines.
    expect(content).toMatch(/done.*memory.written|memory.written.*done/is);
    expect(content).toMatch(/done.*pr.opened|pr.opened.*done/is);
  });

  it('contains runaway-loop guard instruction', () => {
    // Must tell the model not to emit blockers that would re-trigger the mint path.
    expect(content).toMatch(/runaway|NEVER.*report.*blocker|do not.*set.*blocker|never.*mint/i);
  });

  it('mentions the generality-uncertainty escalation path', () => {
    // When uncertain about generality, escalate — do not guess.
    expect(content).toMatch(/uncertain|escalat/i);
  });
});

// ── GoalTypeDef tests ─────────────────────────────────────────────────────────

describe('improve-factory GoalTypeDef', () => {
  const defs = improveTypes();
  const def = defs.find((d) => d.name === 'improve-factory')!;

  it('the improve-factory type is registered', () => {
    expect(def).toBeDefined();
  });

  it('kind is "evolve"', () => {
    expect(def.kind).toBe('evolve');
  });

  it('tier default is "high" (bad harness output poisons every run)', () => {
    expect(def.tier.default).toBe('high');
  });

  it('tier ladder is non-empty and starts at the default tier', () => {
    expect(def.tier.ladder.length).toBeGreaterThan(0);
    expect(def.tier.ladder[0]).toBe(def.tier.default);
  });

  it('grants include event-log.read for reading the event log pointer', () => {
    expect(def.grants).toContain('event-log.read');
  });

  it('grants include repo.branch (push_branch tool)', () => {
    expect(def.grants).toContain('repo.branch');
  });

  it('grants include repo.pr (open_pr tool)', () => {
    expect(def.grants).toContain('repo.pr');
  });

  it('leafOnly is false (may spawn children for investigate/draft/test)', () => {
    expect(def.leafOnly).toBe(false);
  });

  it('family is "improve"', () => {
    expect(def.family).toBe('improve');
  });
});

// ── loadFamilySkill integration test (real file via the production loader) ───

describe('improve-factory family skill via loadFamilySkill', () => {
  beforeEach(() => {
    // Clear the module-level cache so each test gets a fresh load from disk.
    _clearSkillCache();
  });
  it('loadFamilySkill("improve") finds the real skill file and returns a non-null skill', () => {
    const skill = loadFamilySkill('improve');
    expect(skill).not.toBeNull();
  });

  it('the skill file has a section for "improve-factory"', () => {
    const skill = loadFamilySkill('improve');
    expect(skill).not.toBeNull();
    const section = skill!.sectionFor('improve-factory');
    expect(section).not.toBeNull();
    expect(section!.length).toBeGreaterThan(0);
  });

  it('the skill file has a section for "propose-pattern"', () => {
    const skill = loadFamilySkill('improve');
    expect(skill).not.toBeNull();
    const section = skill!.sectionFor('propose-pattern');
    expect(section).not.toBeNull();
  });
});
