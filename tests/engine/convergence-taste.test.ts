/**
 * the scripted taste convergence (zero network).
 *
 * A commissioned mini-intent flows through scripted brains end-to-end against a
 * real tmp git fixture repo. The tree:
 *
 *   root (synthetic non-leaf scan-root, deliver family, scan k=3)
 *     │  terraced scan: 3 lens-diverse candidate splits, judge-split ranks,
 *     │  winner deepened, losers → "alternatives considered" findings
 *     └─ winning split, in dependency order:
 *          write-prd      (author leaf, outputSchema → TWO-PHASE emit;
 *                          exploration step, then emit step → PRD passing prdShapeCheck)
 *          design-arch    (author leaf, archSectionCheck; ADR with the four
 *                          required sections; critique-doc judge)
 *          freeze-contract(build leaf, critique-code judge; writes a contract file)
 *          implement      (build leaf, runScriptCheck('test'); tool loop writes a
 *                          REAL file in the worktree, run_script GREEN, then emits)
 *
 * The factory is wired with the FULL assembly: real worktree, scrubbed-env script
 * runner, knowledge wiring (pre-seeded fresh artifacts so the coverage gate passes
 * clean and emits a gate-checked event), and the real 19-type registry rebound by
 * rebindKnowledgeScan.
 *
 * WHAT THIS PROVES, and a HONEST SHORTCUT:
 *   - The whole composed path converges with scripted brains and zero network.
 *   - Every leaf's step-loop harness carried its family skill (build/author).
 *   - The two-phase emit seam (ADR-023) runs for write-prd: the first artifact is
 *     the exploration-complete signal, a second brain.step with outputSchema set
 *     produces the PRD that passes the deterministic prd:shape gate.
 *   - The terraced scan ran (decided + judge-split judge-verdict events) and its
 *     losing candidates surfaced as "alternative considered" findings on the root
 *     report (DESIGN.md's "alternatives considered" falling out of the scan).
 *   - gate-checked, cost (non-zero usage projection), and golden(OFF→zero) events.
 *   - The INTENT DIAL: the critique portion re-run under intent:'spike' with a
 *     scripted judge keyed off the rubric text passes where production gated.
 *
 *   SHORTCUT (declared): DESIGN.md describes design-arch running its OWN tournament
 *   ranked by critique-doc with the winner deepened, losers → alternatives. The
 *   engine's terraced scan is wired only for NON-LEAF decision nodes and ranks
 *   SPLITS via judge-split; design-arch is a leafOnly type, so the `scan` field on
 *   its card is currently INERT at the engine. Two consequences for this test:
 *     1. The scan is exercised at a NON-LEAF root decision node (a synthetic
 *        `scan-root` added alongside the real 19 types — the same convention the
 *        flywheel/judge-intent tests use). That produces exactly the assertions
 * the spec enumerates: judge-split ranks k=3 candidates, the winner is deepened,
 *        the losers become "alternatives considered" findings, the scan is visible
 *        via decided + judge-verdict events.
 *     2. design-arch runs as an ordinary deepened leaf in the winning split.
 *   The critique-doc-ranked artifact-level scan for design-arch is an engine seam
 *   that does not yet exist; building it would be a contract/engine change out of
 *   this iteration's scope (only the scan field on the card was wired; the engine seam is future work).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Full-stack scripted flow spawning real subprocesses (git + declared scripts via
// the worktree sandbox). Like convergence-eyes, the default 5s per-test timeout
// flakes under full-suite parallel contention — give the file a generous timeout
// so subprocess starvation can't produce a spurious "Test timed out" failure.
vi.setConfig({ testTimeout: 30_000 });

import { Engine } from '../../src/engine/engine.js';
import {
  assembleKnowledgeWiring,
  rebindKnowledgeScan,
  type SandboxConfig,
} from '../../src/engine/assembly.js';
import { starterTypes } from '../../src/library/starter-types.js';
import { createRegistry } from '../../src/library/registry.js';
import { writeKnowledge, writeRegionFacts } from '../../src/library/knowledge.js';
import { costSummary, projectKnowledge } from '../../src/eventlog/projections.js';
import { _clearSkillCache } from '../../src/library/skills.js';
import { MemoryEventStore, NoopMemoryView, makeGoal } from './stubs.js';
import type { Brain, BrainContext, StepOutput, StepTranscript } from '../../src/contract/brain.js';
import type { Goal, Metered, Usage } from '../../src/contract/goal.js';
import { ZERO_USAGE } from '../../src/contract/goal.js';
import type { Decision, ChildPlan } from '../../src/contract/decision.js';
import type { Artifact } from '../../src/contract/report.js';
import type { Verdict } from '../../src/contract/verdict.js';
import type { ToolDef } from '../../src/contract/tool.js';
import type { GoalTypeDef } from '../../src/contract/goal-type.js';
import type { KnowledgeArtifact, KnowledgeCategory } from '../../src/contract/knowledge.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

const USAGE: Usage = { promptTokens: 120, completionTokens: 50, costUsd: 0.0031 };
const CONTRACT = 'export const CONTRACT = "frozen";\n';
const IMPL = 'export const impl = () => "done";\n';

/** A valid PRD passing prdShapeCheck. */
const PRD = {
  problem: 'Operators cannot see cache savings.',
  users: ['operators'],
  outcome: 'Operators read cache-hit share in every run.',
  scope: { in: ['cost summary'], out: ['billing'], deferred: ['dashboards'] },
  requirements: [{ id: 'R1', text: 'Print cacheHitShare', traceableTo: 'intent' }],
  acceptanceCriteria: [
    { id: 'A1', given: 'a run reported cached tokens', when: 'the summary prints', then: 'cacheHitShare is shown', requirementRef: 'R1' },
  ],
  openQuestions: [],
};

/** An ADR doc carrying the four sections archSectionCheck requires. */
const ADR =
  '# ADR-099\n\n## Decision\nUse the costSummary projection.\n\n## Rationale\nIt already folds usage.\n\n' +
  '## Tradeoffs\nMore fields on UsageTotals.\n\n## Alternatives\nA separate projection (rejected: duplication).\n';

// ── fixture repo with a declared `test` script ──────────────────────────────
function makeFixtureRepo(): { repo: string; headSha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'corellia-taste-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'node check.mjs' } }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'check.mjs'),
    [
      "import { existsSync } from 'node:fs';",
      // Green once the implement leaf has written the in-scope file.
      'if (existsSync("src/feature.ts")) { console.log("ok"); process.exit(0); }',
      'console.error("feature missing"); process.exit(1);',
    ].join('\n') + '\n',
  );
  execFileSync('git', ['add', 'package.json', 'check.mjs'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: dir, stdio: 'pipe' });
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  return { repo: dir, headSha };
}

/** Seed fresh knowledge for the repo so the coverage gate passes clean. */
async function seedKnowledge(store: MemoryEventStore, repo: string, headSha: string): Promise<void> {
  const categories: KnowledgeCategory[] = ['architecture', 'stack', 'conventions', 'test-scaffold'];
  for (const category of categories) {
    const a: KnowledgeArtifact = {
      repoRoot: repo,
      category,
      generatedAtSha: headSha,
      confidence: 'high',
      status: 'provisional',
      pointers: [{ path: 'package.json', note: `seed:${category}` }],
      summary: `seeded ${category}`,
    };
    await writeKnowledge(store, `seed-${category}`, a);
  }
  await writeRegionFacts(store, 'seed-src', {
    repoRoot: repo,
    region: 'src',
    generatedAtSha: headSha,
    facts: [{ claim: 'src holds the feature', anchors: [{ path: 'package.json', line: 1 }], sha: headSha, confidence: 'high' }],
  });
}

/** The winning split: the prd→arch→contract→implement pipeline, in dep order. */
function pipelineChildren(): ChildPlan[] {
  return [
    { localId: 'prd', type: 'write-prd', title: 'PRD', spec: {}, scope: [], budgetShare: 0.25, dependsOn: [] },
    { localId: 'arch', type: 'design-arch', title: 'ADR', spec: {}, scope: [], budgetShare: 0.25, dependsOn: ['prd'] },
    { localId: 'contract', type: 'freeze-contract', title: 'freeze', spec: {}, scope: ['src/'], budgetShare: 0.25, dependsOn: ['arch'] },
    { localId: 'impl', type: 'implement', title: 'implement', spec: {}, scope: ['src/'], budgetShare: 0.25, dependsOn: ['contract'] },
  ];
}

/**
 * The single scripted brain that drives the WHOLE tree:
 *   - decide: at the root, returns a (lens-tagged) split candidate for the scan;
 *     leaf types never reach decide (leafOnly → satisfy).
 *   - judge: judge-split during the scan (pass), critique-* for leaves (per
 *     judgeVerdict).
 *   - step: per-leaf tool loops. write-prd takes the two-phase path; design-arch
 *     and freeze-contract write their docs; implement writes the file + runs test.
 */
function convergenceBrain(opts: { judgeVerdict: (rubric: string) => Verdict }): Brain {
  // Per-goal step counters so each leaf's loop is independent.
  const stepIdx = new Map<string, number>();
  const next = (id: string): number => {
    const n = stepIdx.get(id) ?? 0;
    stepIdx.set(id, n + 1);
    return n;
  };

  return {
    async decide(_goal: Goal): Promise<Metered<Decision>> {
      // Every scan candidate is the same pipeline split (lens-diverse in prompt,
      // identical in structure for a deterministic test); judge-split passes all,
      // so the FIRST candidate wins and the other two become alternatives.
      return { value: { kind: 'split', children: pipelineChildren() }, usage: USAGE };
    },
    async produce(): Promise<Metered<Artifact>> {
      throw new Error('produce not used (all leaves are tool-granted)');
    },
    async judge(_goal: Goal, _subject: Artifact, rubric: string): Promise<Metered<Verdict>> {
      if (rubric.startsWith('Evaluate the split')) {
        // judge-split during the terraced scan — always sound here.
        return { value: { pass: true, findings: [] }, usage: USAGE };
      }
      return { value: opts.judgeVerdict(rubric), usage: USAGE };
    },
    async repair(): Promise<Metered<Artifact>> {
      throw new Error('repair not used');
    },
    async step(
      goal: Goal,
      _transcript: StepTranscript,
      _tools: ToolDef[],
      ctx: BrainContext,
    ): Promise<StepOutput> {
      const i = next(goal.id);

      if (goal.type === 'write-prd') {
        // TWO-PHASE: step 0 is the exploration-complete signal (any artifact);
        // the engine then re-invokes step with ctx.outputSchema set — emit the PRD.
        if (ctx.outputSchema !== undefined) {
          return { kind: 'artifact', artifact: { kind: 'text', text: JSON.stringify(PRD) }, usage: USAGE };
        }
        return { kind: 'artifact', artifact: { kind: 'text', text: '{"exploring":true}' }, usage: USAGE };
      }

      if (goal.type === 'design-arch') {
        return { kind: 'artifact', artifact: { kind: 'text', text: ADR }, usage: USAGE };
      }

      if (goal.type === 'freeze-contract') {
        if (i === 0) {
          return {
            kind: 'tool-calls',
            calls: [{ id: 'fc1', name: 'write_file', args: { path: 'src/contract.ts', content: CONTRACT } }],
            usage: USAGE,
          };
        }
        return { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/contract.ts', content: CONTRACT }] }, usage: USAGE };
      }

      // implement: write the real file, run the declared test (GREEN), emit.
      if (i === 0) {
        return {
          kind: 'tool-calls',
          calls: [
            { id: 'im1', name: 'write_file', args: { path: 'src/feature.ts', content: IMPL } },
            { id: 'im2', name: 'run_script', args: { script: 'test' } },
          ],
          usage: USAGE,
        };
      }
      return { kind: 'artifact', artifact: { kind: 'files', files: [{ path: 'src/feature.ts', content: IMPL }] }, usage: USAGE };
    },
  };
}

/**
 * A synthetic non-leaf ROOT scanning type. The engine's terraced scan is wired
 * for NON-LEAF decision nodes with scan.k > 1 (see the SHORTCUT note in the file
 * header); deliver-intent in the library carries no scan field, so we add this
 * scanning root alongside the real 19-type set — the same convention the
 * flywheel/judge-intent tests use to exercise the scan path without touching the
 * library type cards. Its family is `deliver` so any skill lookups resolve.
 */
const SCAN_ROOT_TYPE: GoalTypeDef = {
  name: 'scan-root',
  kind: 'make',
  family: 'deliver',
  leafOnly: false,
  tier: { default: 'high', ladder: ['high'] },
  deterministic: [],
  judgeType: 'judge-integration',
  grants: ['retrieval.api', 'spawn'],
  scan: { k: 3, lenses: ['architect', 'reuse', 'contrarian'] },
};

/** Build the engine wired with the full assembly + knowledge over the fixture. */
function buildEngine(repo: string, store: MemoryEventStore, brain: Brain, goldenCapture = false): Engine {
  const liveTypes = [...rebindKnowledgeScan(starterTypes()), SCAN_ROOT_TYPE];
  const registry = createRegistry(liveTypes);
  const sandbox: SandboxConfig = { repoRoot: repo, declaredScripts: { test: 'check.mjs' }, knowledge: true };
  return new Engine({
    registry,
    brain,
    store,
    memory: new NoopMemoryView(),
    sandbox,
    knowledge: assembleKnowledgeWiring(sandbox, store, registry),
    goldenCapture,
  });
}

function rootGoal(): Goal {
  return makeGoal({
    id: 'taste-root',
    type: 'scan-root',
    title: 'Surface cache-hit share end to end',
    scope: ['src/'],
    intent: 'production',
    budget: { attempts: 6, tokens: 5_000_000, toolCalls: 200, wallClockMs: 600_000 },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — full convergence: scan, two-phase PRD, real implement, gate/cost/golden
// ─────────────────────────────────────────────────────────────────────────────

describe('taste convergence — full scripted flow', () => {
  it('converges prd→arch→contract→implement under a terraced scan, with the wired seams firing', async () => {
    _clearSkillCache();
    const { repo, headSha } = makeFixtureRepo();
    const store = new MemoryEventStore();
    await seedKnowledge(store, repo, headSha);

    const brain = convergenceBrain({ judgeVerdict: () => ({ pass: true, findings: [] }) });
    const engine = buildEngine(repo, store, brain, /* goldenCapture */ false);

    const report = await engine.run(rootGoal());
    const events = await store.list();

    // ── converged: the whole tree passed ─────────────────────────────────────
    expect(report.blockers).toHaveLength(0);

    // ── TWO-PHASE emit ran for write-prd: a knowledge-free leaf that emitted the
    //    PRD via the emit step. The PRD passed prd:shape (no blocker on the prd
    //    leaf) — assert the PRD landed in the merged tree by checking the prd leaf
    //    emitted successfully (no blocker mentioning prd) and that two step events
    //    exist for it (exploration + emit).
    const prdSteps = events.filter((e) => e.type === 'step' && e.goalId === 'taste-root/prd');
    expect(prdSteps.length).toBeGreaterThanOrEqual(2); // exploration + emit
    const prdEmitted = events.find((e) => e.type === 'emitted' && e.goalId === 'taste-root/prd');
    expect(prdEmitted).toBeDefined();

    // ── TERRACED SCAN ran at the root: judge-split judge-verdicts + exactly one
    //    decided for the root + losers as "alternative considered" findings. ─────
    const splitJudges = events.filter((e) => e.type === 'judge-verdict' && e.judgeType === 'judge-split');
    expect(splitJudges.length).toBeGreaterThanOrEqual(3); // k=3 scan candidates
    const rootDecided = events.filter((e) => e.type === 'decided' && e.goalId === 'taste-root');
    expect(rootDecided).toHaveLength(1); // only the winner's decided
    const alts = report.findings.filter((f) => f.startsWith('alternative considered'));
    expect(alts.length).toBeGreaterThanOrEqual(2); // two losing candidates

    // ── the implement leaf wrote a REAL file and the declared test ran GREEN ───
    const scriptRan = events.filter((e) => e.type === 'script-ran');
    expect(scriptRan.length).toBeGreaterThanOrEqual(1);
    expect(scriptRan.some((e) => e.type === 'script-ran' && e.exitStatus === 0)).toBe(true);
    // run_script attributed to the implement leaf, not the root.
    for (const e of scriptRan) {
      if (e.type === 'script-ran') expect(e.goalId).toBe('taste-root/impl');
    }

    // ── gate-checked fired (coverage gate over the seeded-fresh knowledge) ─────
    const gateChecked = events.filter((e) => e.type === 'gate-checked');
    expect(gateChecked.length).toBeGreaterThanOrEqual(1);
    // The root split gate passed clean (seeded architecture+stack are fresh).
    const rootGate = gateChecked.find((e) => e.type === 'gate-checked' && e.goalId === 'taste-root');
    expect(rootGate?.type === 'gate-checked' && rootGate.ok).toBe(true);

    // ── golden capture OFF by default → ZERO golden-candidate events ───────────
    const golden = events.filter((e) => e.type === 'golden-candidate');
    expect(golden).toHaveLength(0);

    // ── cost projection is non-zero (usage-bearing events fed it) ──────────────
    const cost = costSummary(events);
    expect(cost.tree.promptTokens).toBeGreaterThan(0);
    expect(cost.tree.completionTokens).toBeGreaterThan(0);
    expect(cost.tree.costUsd).toBeGreaterThan(0);

    // ── the worktree was collected with commits (clean tree success) ───────────
    const collected = events.filter((e) => e.type === 'worktree-collected');
    expect(collected).toHaveLength(1);

    // ── no knowledge was overwritten by the seeds beyond the four + one dive ───
    const view = projectKnowledge(events);
    expect([...view.artifacts.values()].filter((a) => a.artifact.repoRoot === repo)).toHaveLength(4);
  });

  it('every leaf carried its family skill in the step-loop harness', async () => {
    _clearSkillCache();
    const { repo, headSha } = makeFixtureRepo();
    const store = new MemoryEventStore();
    await seedKnowledge(store, repo, headSha);

    // Wrap the brain to capture, per goal, the immutable harness prefix.
    const harnessByGoal = new Map<string, string>();
    const base = convergenceBrain({ judgeVerdict: () => ({ pass: true, findings: [] }) });
    const brain: Brain = {
      ...base,
      async step(goal: Goal, transcript: StepTranscript, tools: ToolDef[], ctx: BrainContext): Promise<StepOutput> {
        if (!harnessByGoal.has(goal.id)) {
          const first = transcript.find((m) => m.role === 'context');
          if (first && first.role === 'context') harnessByGoal.set(goal.id, first.content);
        }
        return base.step(goal, transcript, tools, ctx);
      },
    };

    const engine = buildEngine(repo, store, brain, false);
    const report = await engine.run(rootGoal());
    expect(report.blockers).toHaveLength(0);

    // write-prd + design-arch are author family; freeze-contract + implement are build family.
    expect(harnessByGoal.get('taste-root/prd')).toContain('The author family');
    expect(harnessByGoal.get('taste-root/arch')).toContain('The author family');
    expect(harnessByGoal.get('taste-root/contract')).toContain('The build family');
    expect(harnessByGoal.get('taste-root/impl')).toContain('The build family');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — the INTENT DIAL at convergence scale
// ─────────────────────────────────────────────────────────────────────────────

describe('taste convergence — intent dial relaxes the critique', () => {
  // A scripted critique judge that keys off the rubric's intent line: it FAILS a
  // gating finding under production but PASSES under spike (mirrors the
  // judge-intent test pattern, at convergence scale). judge-split always passes
  // so the scan still commits.
  function dialJudge(rubric: string): Verdict {
    if (rubric.includes("intent is spike")) {
      return { pass: true, findings: [] };
    }
    return {
      pass: false,
      findings: [{ title: 'production bar: ADR tradeoffs too thin', dimension: 'spec', severity: 'high', gating: true }],
      failureSignature: 'prod-adr-bar',
    };
  }

  async function runWithIntent(intent: 'spike' | 'production') {
    _clearSkillCache();
    const { repo, headSha } = makeFixtureRepo();
    const store = new MemoryEventStore();
    await seedKnowledge(store, repo, headSha);
    const brain = convergenceBrain({ judgeVerdict: dialJudge });
    const engine = buildEngine(repo, store, brain, false);
    const goal = { ...rootGoal(), intent };
    const report = await engine.run(goal);
    return { report, store };
  }

  it('spike PASSES where production GATES on the same scripted critique', async () => {
    // Spike: the critique judge passes → the tree converges.
    const spike = await runWithIntent('spike');
    expect(spike.report.blockers).toHaveLength(0);

    // Production: the critique judge fails its gating finding → the leaf cannot
    // pass within budget → the tree blocks. (The intent line in the rubric is the
    // only thing that changed between the two runs.)
    const prod = await runWithIntent('production');
    expect(prod.report.blockers.length).toBeGreaterThan(0);

    // The dial lived in the rubric: a judge-verdict under spike passed, under
    // production failed — confirm both critique verdicts were recorded.
    const spikeJudges = (await spike.store.list()).filter(
      (e) => e.type === 'judge-verdict' && e.judgeType !== 'judge-split',
    );
    expect(spikeJudges.some((e) => e.type === 'judge-verdict' && e.verdict.pass)).toBe(true);
    const prodJudges = (await prod.store.list()).filter(
      (e) => e.type === 'judge-verdict' && e.judgeType !== 'judge-split',
    );
    expect(prodJudges.some((e) => e.type === 'judge-verdict' && !e.verdict.pass)).toBe(true);
  });
});
