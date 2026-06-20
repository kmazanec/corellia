/**
 * skills-through-engine pin (parameterized sweep).
 *
 * The factory injects each goal-type's FAMILY SKILL through the REAL engine at
 * exactly two seams:
 *
 *   (a) the step-loop HARNESS message  — for tool-granted make/learn leaves that
 *       drive the engine-owned step loop (runStepLoop). The harness carries the
 *       family preamble + the type's section.
 *   (b) the judge RUBRIC               — for every judge type, via enrichRubric.
 *       The rubric carries the judge type's family preamble + intent-dial section
 *       + the type's section.
 *
 * This file sweeps the FULL 19-type registry over BOTH seams and asserts that the
 * representative type for each injection-reaching family carries its family-skill
 * phrase. Each family preamble opens with the distinctive line "The <family>
 * family …", so the phrase is unambiguous and stable.
 *
 * WHY a parameterized sweep: a future family whose types are added to
 * starterTypes() but never wired to a skill file — or a regression that drops
 * skill injection at either seam — fails here loudly, type by type, rather than
 * passing silently. The sweep is driven from the live starterTypes() set, so it
 * tracks the registry as it grows.
 *
 * Families NOT covered here, and why (documented so the gap is intentional, not
 * forgotten): the evolve families `curate` (promote-memory, consolidate-memory)
 * and `improve` (propose-pattern, improve-factory) run via the classic produce
 * path — they carry no step-loop tool grant and no judge type, so they reach
 * neither injection seam. Their skill files exist and are lint-covered; they are
 * simply not injected at runtime by design. The constitution lint (npm run lint)
 * is the gate that every family HAS a skill file; this test gates that the
 * families which DO run through an injection seam actually carry it there.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { Engine } from '../../src/engine/engine.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { loadFamilySkill, _clearSkillCache } from '../../src/library/skills.js';
import { GRANT_TOOL_MAP } from '../../src/contract/tool.js';
import { MemoryEventStore, NoopMemoryView, leafTypeDef, makeGoal } from './stubs.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal, Metered } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { GoalTypeDef, Registry } from '../../src/contract/goal-type.js';

// ── fixtures ────────────────────────────────────────────────────────────────

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
beforeEach(() => _clearSkillCache());

function makeTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-skills-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

const TOOL_GRANTS = new Set(Object.values(GRANT_TOOL_MAP).flat());
function isToolGranted(grants: string[]): boolean {
  return grants.some((g) => TOOL_GRANTS.has(g as never));
}

/** Build a Registry over an arbitrary def set (used to add synthetic worker types). */
function registryOf(defs: GoalTypeDef[]): Registry {
  const map = new Map(defs.map((d) => [d.name, d]));
  return {
    get(name: string): GoalTypeDef {
      const def = map.get(name);
      if (!def) throw new Error(`Unknown type: ${name}`);
      return def;
    },
    has(name: string): boolean {
      return map.has(name);
    },
    names(): string[] {
      return [...map.keys()];
    },
  };
}

/** The distinctive preamble line every family skill opens with. */
function familyPhrase(family: string): string {
  return `The ${family} family`;
}

// ── A brain that captures the step-loop harness, then emits immediately. ─────
function harnessCaptureBrain(): Brain & { harness: string[] } {
  const harness: string[] = [];
  return {
    harness,
    async decide(): Promise<Metered<Decision>> {
      return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      return { value: { kind: 'text', text: '{}' }, usage: ZERO_USAGE };
    },
    async judge(): Promise<Metered<Verdict>> {
      return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
    },
    async repair(): Promise<Metered<Artifact>> {
      throw new Error('repair not used');
    },
    async step(
      _goal: Goal,
      transcript: StepTranscript,
      _tools: ToolDef[],
      _ctx: BrainContext,
    ): Promise<StepOutput> {
      // The first message is the immutable harness prefix; record it.
      const first = transcript.find((m) => m.role === 'context');
      if (first && first.role === 'context') harness.push(first.content);
      // Emit a trivial artifact; outputSchema types take the two-phase path, but
      // the emit step also receives the same harness prefix.
      return { kind: 'artifact', artifact: { kind: 'text', text: '{}' }, usage: ZERO_USAGE };
    },
  };
}

/** A brain that captures every judge rubric and always passes. */
function rubricCaptureBrain(): Brain & { rubrics: string[] } {
  const rubrics: string[] = [];
  return {
    rubrics,
    async decide(): Promise<Metered<Decision>> {
      return { value: { kind: 'satisfy' }, usage: ZERO_USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      return { value: { kind: 'text', text: 'doc' }, usage: ZERO_USAGE };
    },
    async judge(_g: Goal, _a: Artifact, rubric: string): Promise<Metered<Verdict>> {
      rubrics.push(rubric);
      return { value: { pass: true, findings: [] }, usage: ZERO_USAGE };
    },
    async repair(): Promise<Metered<Artifact>> {
      throw new Error('repair not used');
    },
    async step(): Promise<StepOutput> {
      throw new Error('step not used');
    },
  };
}

// ── Build the sweep tables from the live registry ────────────────────────────

const ALL_TYPES = starterTypes();

/**
 * One representative tool-granted make/learn type per family that reaches the
 * STEP-LOOP harness seam. The step loop runs for any tool-granted make/learn type
 * whose attempt loop executes — a leafOnly type goes straight there, and a
 * non-leaf type reaches it on the SATISFY branch of its decide path (ADR-029: the
 * comprehend family is no longer leafOnly yet still drives the step loop when it
 * decides to satisfy rather than split). Skips judge/evolve kinds and types with
 * no step-loop tool grant.
 */
function stepLoopReps(): GoalTypeDef[] {
  const seen = new Set<string>();
  const reps: GoalTypeDef[] = [];
  for (const d of ALL_TYPES) {
    if (seen.has(d.family)) continue;
    if (d.kind === 'judge' || d.kind === 'evolve') continue;
    if (!isToolGranted(d.grants)) continue;
    seen.add(d.family);
    reps.push(d);
  }
  return reps;
}

/** Every judge-kind type — each reaches the JUDGE-RUBRIC seam via enrichRubric. */
function judgeReps(): GoalTypeDef[] {
  return ALL_TYPES.filter((d) => d.kind === 'judge');
}

// ── SWEEP 1: step-loop harness carries the family skill ──────────────────────

describe('skills-wiring sweep — step-loop harness carries each family skill', () => {
  const reps = stepLoopReps();

  it('covers at least the build, comprehend, author, and research families', () => {
    const fams = new Set(reps.map((d) => d.family));
    for (const f of ['build', 'comprehend', 'author', 'research']) {
      expect(fams.has(f)).toBe(true);
    }
  });

  for (const rep of reps) {
    it(`harness for "${rep.name}" (family ${rep.family}) carries "${familyPhrase(rep.family)}"`, async () => {
      // Precondition: the family skill file actually exists and its preamble
      // opens with the phrase (guards the assertion against a wrong phrase).
      const skill = loadFamilySkill(rep.family);
      expect(skill).not.toBeNull();
      expect(skill!.full).toContain(familyPhrase(rep.family));

      const repo = makeTempRepo();
      const store = new MemoryEventStore();
      const brain = harnessCaptureBrain();

      // Register the rep alone with its judgeType (if any) stubbed as a judge
      // kind so enrichRubric can resolve it; the brain passes the judge so the
      // tree converges.
      const defs: GoalTypeDef[] = [rep];
      if (rep.judgeType) {
        defs.push(leafTypeDef({ name: rep.judgeType, kind: 'judge', family: rep.family, judgeType: null }));
      }
      const engine = new Engine({
        registry: registryOf(defs),
        brain,
        store,
        memory: new NoopMemoryView(),
        sandbox: { repoRoot: repo, declaredScripts: {} },
      });

      await engine.run(makeGoal({ id: `sweep-${rep.name}`, type: rep.name, scope: ['src/'] }));

      expect(brain.harness.length).toBeGreaterThanOrEqual(1);
      expect(brain.harness[0]).toContain(familyPhrase(rep.family));
    });
  }
});

// ── SWEEP 2: judge rubric carries the judge family skill ─────────────────────

describe('skills-wiring sweep — judge rubric carries each judge family skill', () => {
  const judges = judgeReps();

  it('covers at least the arbiter and critique families', () => {
    const fams = new Set(judges.map((d) => d.family));
    for (const f of ['arbiter', 'critique']) {
      expect(fams.has(f)).toBe(true);
    }
  });

  for (const judge of judges) {
    it(`rubric for judge "${judge.name}" (family ${judge.family}) carries "${familyPhrase(judge.family)}"`, async () => {
      const skill = loadFamilySkill(judge.family);
      expect(skill).not.toBeNull();
      expect(skill!.full).toContain(familyPhrase(judge.family));

      const store = new MemoryEventStore();
      const brain = rubricCaptureBrain();

      // A non-tool-granted worker leaf whose judgeType is this judge type, so a
      // single brain.judge call fires through enrichRubric with the judge's family.
      const worker = leafTypeDef({
        name: `worker-for-${judge.name}`,
        kind: 'make',
        family: judge.family,
        judgeType: judge.name,
        deterministic: [],
        grants: [],
      });
      const engine = new Engine({
        registry: registryOf([worker, judge]),
        brain,
        store,
        memory: new NoopMemoryView(),
      });

      await engine.run(makeGoal({ id: `sweep-judge-${judge.name}`, type: worker.name, intent: 'production' }));

      expect(brain.rubrics.length).toBeGreaterThanOrEqual(1);
      expect(brain.rubrics[0]).toContain(familyPhrase(judge.family));
    });
  }
});

// ── Full-registry wiring sanity: 19 types, lint-clean families, all reachable ─

describe('full 19-type registry wiring', () => {
  it('starterTypes() exposes the full 19-type set across all 10 families', () => {
    expect(ALL_TYPES).toHaveLength(19);
    const families = new Set(ALL_TYPES.map((d) => d.family));
    expect([...families].sort()).toEqual(
      ['arbiter', 'author', 'build', 'comprehend', 'critique', 'curate', 'deliver', 'diagnose', 'improve', 'research'].sort(),
    );
  });

  it('every family in the registry resolves a skill file whose preamble names it', () => {
    const families = [...new Set(ALL_TYPES.map((d) => d.family))];
    for (const family of families) {
      const skill = loadFamilySkill(family);
      expect(skill, `family "${family}" must have a skill file`).not.toBeNull();
      expect(skill!.full).toContain(familyPhrase(family));
    }
  });
});
