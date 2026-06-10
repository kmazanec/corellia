/**
 * The recursive engine — the single operation that is the factory.
 * receive → decide → (satisfy | split | block) → integrate → emit
 */

import type { Goal, Tier, MemoryPointer, Budget } from '../contract/goal.js';
import type { Decision, ChildPlan } from '../contract/decision.js';
import type { Artifact, Report } from '../contract/report.js';
import type { Verdict, Finding } from '../contract/verdict.js';
import type { EventStore } from '../contract/events.js';
import type { Brain, BrainContext } from '../contract/brain.js';
import type { Registry } from '../contract/goal-type.js';
import type { MemoryView } from '../contract/memory.js';
import { subdivide, consume } from './budget.js';

export interface EngineOptions {
  registry: Registry;
  brain: Brain;
  store: EventStore;
  memory: MemoryView;
  now?: () => number;
  /**
   * Called when a goal blocks. The resolution drives the blocked event.
   * Returning 'answered' means the brief was handled (goal can continue or not
   * depending on caller semantics); other values map to onTimeout defaults.
   */
  onBrief?: (
    brief: import('../contract/decision.js').DecisionBrief,
  ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>;
}

export class Engine {
  private readonly registry: Registry;
  private readonly brain: Brain;
  private readonly store: EventStore;
  private readonly memory: MemoryView;
  private readonly now: () => number;
  private readonly onBrief:
    | ((
        brief: import('../contract/decision.js').DecisionBrief,
      ) => Promise<'deny' | 'park' | 'bounce' | 'answered'>)
    | undefined;

  constructor(opts: EngineOptions) {
    this.registry = opts.registry;
    this.brain = opts.brain;
    this.store = opts.store;
    this.memory = opts.memory;
    this.now = opts.now ?? (() => Date.now());
    this.onBrief = opts.onBrief;
  }

  async run(goal: Goal): Promise<Report> {
    const t = this.now;
    const deadline = t() + goal.budget.wallClockMs;

    // ── RECEIVE ────────────────────────────────────────────────────────────
    await this.store.append({ type: 'goal-received', at: t(), goalId: goal.id, goal });

    // Unknown type → block immediately (no throw)
    if (!this.registry.has(goal.type)) {
      const brief = unknownTypeBrief(goal);
      const resolution = this.onBrief
        ? await this.onBrief(brief)
        : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      const report = blockedReport(`Unknown goal type: ${goal.type}`);
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return report;
    }

    const typeDef = this.registry.get(goal.type);
    const tierLadder = typeDef.tier.ladder;
    let currentTierIndex = 0;
    let currentTier: Tier = typeDef.tier.default;

    // ── DECIDE ─────────────────────────────────────────────────────────────
    // leafOnly types go straight to the attempt loop; non-leaf types decide.
    let decision: Decision;

    if (typeDef.leafOnly) {
      decision = { kind: 'satisfy' };
    } else {
      const ctx: BrainContext = {
        tier: currentTier,
        memories: goal.memories,
      };
      decision = await this.brain.decide(goal, ctx);
    }

    // ── SPLIT EVAL (before committing to a split) ──────────────────────────
    // When the decision is a split, validate it and optionally judge it.
    if (decision.kind === 'split') {
      // leafOnly types must never split
      if (typeDef.leafOnly) {
        const report = blockedReport(
          `Type "${goal.type}" is leafOnly but brain returned a split decision`,
        );
        await this.store.append({
          type: 'decided',
          at: t(),
          goalId: goal.id,
          decision,
        });
        await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
        return report;
      }

      // Validate structural constraints on the split
      let budget = goal.budget;
      let priorVerdict: Verdict | undefined;

      const maxSplitAttempts = budget.attempts;
      let splitAttempts = 0;

      while (true) {
        const structErr = validateSplit(decision.children, budget);
        if (structErr) {
          // Structural violation of the split → fail verdict, re-decide with
          // priorAttempt carrying the rejection
          splitAttempts++;
          const consumed = consume(budget, 'attempts');
          budget = consumed.budget;
          const failVerdict: Verdict = {
            pass: false,
            findings: [
              {
                title: 'Invalid split structure',
                dimension: 'spec',
                severity: 'high',
                gating: true,
                prescription: structErr,
              },
            ],
            failureSignature: `invalid-split:${structErr}`,
          };
          priorVerdict = failVerdict;

          if (consumed.exhausted || splitAttempts >= maxSplitAttempts) {
            await this.store.append({
              type: 'budget-exhausted',
              at: t(),
              goalId: goal.id,
              dimension: 'attempts',
            });
            const report = blockedReport(
              `Split structural validation failed: ${structErr}`,
            );
            await this.store.append({
              type: 'emitted',
              at: t(),
              goalId: goal.id,
              report,
            });
            return report;
          }

          // Re-decide with failure context
          const splitPlanArtifact: Artifact = {
            kind: 'text',
            text: JSON.stringify(decision.children),
          };
          const reDecideCtx: BrainContext = {
            tier: currentTier,
            memories: goal.memories,
            priorAttempt: { artifact: splitPlanArtifact, verdict: failVerdict },
          };
          decision = await this.brain.decide(goal, reDecideCtx);
          if (decision.kind !== 'split') break; // changed its mind
          continue;
        }

        // Structure is valid. If there is a judge-split type, judge the split.
        if (this.registry.has('judge-split')) {
          const splitPlanArtifact: Artifact = {
            kind: 'text',
            text: JSON.stringify(decision.children),
          };
          const rubric =
            'Evaluate the split: is it sound and complete? Are dependencies correct and acyclic? Are budgetShares sensible?';
          const judgeCtx: BrainContext = {
            tier: currentTier,
            memories: goal.memories,
          };
          const splitVerdict = await this.brain.judge(
            goal,
            splitPlanArtifact,
            rubric,
            judgeCtx,
          );

          if (!splitVerdict.pass) {
            splitAttempts++;
            const consumed = consume(budget, 'attempts');
            budget = consumed.budget;

            // Isomorphic failure check
            if (
              priorVerdict &&
              splitVerdict.failureSignature &&
              splitVerdict.failureSignature === priorVerdict.failureSignature
            ) {
              const report = blockedReport(
                `Isomorphic split failure (signature: ${splitVerdict.failureSignature})`,
              );
              await this.store.append({
                type: 'decided',
                at: t(),
                goalId: goal.id,
                decision,
              });
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            }

            priorVerdict = splitVerdict;

            if (consumed.exhausted || splitAttempts >= maxSplitAttempts) {
              await this.store.append({
                type: 'budget-exhausted',
                at: t(),
                goalId: goal.id,
                dimension: 'attempts',
              });
              const report = blockedReport('Split eval failed, budget exhausted');
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            }

            // Re-decide carrying the rejected split
            const splitPlanWithFailure: Artifact = {
              kind: 'text',
              text: JSON.stringify(decision.children),
            };
            const reDecideCtx: BrainContext = {
              tier: currentTier,
              memories: goal.memories,
              priorAttempt: {
                artifact: splitPlanWithFailure,
                verdict: splitVerdict,
              },
            };
            decision = await this.brain.decide(goal, reDecideCtx);
            if (decision.kind !== 'split') break; // changed to satisfy or block
            continue;
          }
        }

        // Split passed validation (and judge if present)
        break;
      }
    }

    await this.store.append({ type: 'decided', at: t(), goalId: goal.id, decision });

    // ── DISPATCH on decision kind ──────────────────────────────────────────
    switch (decision.kind) {
      case 'satisfy':
        return this.runAttemptLoop(goal, currentTier, currentTierIndex, tierLadder, deadline);

      case 'split':
        return this.runSplit(goal, decision.children);

      case 'block':
        return this.runBlock(goal, decision.brief);
    }
  }

  // ── ATTEMPT LOOP (the control loop) ──────────────────────────────────────
  private async runAttemptLoop(
    goal: Goal,
    initialTier: Tier,
    initialTierIndex: number,
    tierLadder: Tier[],
    deadline: number,
  ): Promise<Report> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);
    let budget = goal.budget;
    let tier: Tier = initialTier;
    let tierIndex: number = initialTierIndex;
    let priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined;

    while (true) {
      // Check wall-clock budget before each attempt
      if (t() >= deadline) {
        await this.store.append({
          type: 'budget-exhausted',
          at: t(),
          goalId: goal.id,
          dimension: 'wallClockMs',
        });
        return this.runBlock(goal, exhaustedBrief(goal, 'wallClockMs'));
      }

      // Check attempts budget before producing
      if (budget.attempts <= 0) {
        await this.store.append({
          type: 'budget-exhausted',
          at: t(),
          goalId: goal.id,
          dimension: 'attempts',
        });
        return this.runBlock(goal, exhaustedBrief(goal, 'attempts'));
      }

      // Consume one attempt
      const consumed = consume(budget, 'attempts');
      budget = consumed.budget;

      const ctx: BrainContext = priorAttempt
        ? { tier, memories: goal.memories, priorAttempt }
        : { tier, memories: goal.memories };
      const artifact = await this.brain.produce(goal, ctx);

      // Account for tokens used by this produce call
      {
        const tokensUsed = Math.ceil(JSON.stringify(artifact ?? '').length / 4);
        const tkConsumed = consumeN(budget, 'tokens', tokensUsed);
        budget = tkConsumed.budget;
        if (tkConsumed.exhausted) {
          await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'tokens' });
          return this.runBlock(goal, exhaustedBrief(goal, 'tokens'));
        }
      }

      // ── DETERMINISTIC CHECKS ───────────────────────────────────────────
      let deterministicVerdict: Verdict | null = null;
      if (typeDef.deterministic.length > 0) {
        const findings: Finding[] = [];
        let allOk = true;
        let toolCallsUsed = 0;

        for (const check of typeDef.deterministic) {
          toolCallsUsed++;
          const result = await check.run(goal, artifact);
          if (!result.ok) {
            allOk = false;
            // Deterministic checks produce objective failures — detail is an
            // explanation, not a repair prescription. The repair rung is for
            // judge findings with explicit prescriptions.
            findings.push({
              title: `${check.name}: ${result.detail}`,
              dimension: 'spec',
              severity: 'high',
              gating: true,
            });
          }
        }

        // Track tool calls spent
        const tcConsumed = consumeN(budget, 'toolCalls', toolCallsUsed);
        budget = tcConsumed.budget;
        if (tcConsumed.exhausted) {
          await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'toolCalls' });
          return this.runBlock(goal, exhaustedBrief(goal, 'toolCalls'));
        }

        deterministicVerdict = {
          pass: allOk,
          findings,
          ...(allOk ? {} : { failureSignature: `deterministic:${findings.map((f) => f.title).join(',')}` }),
        };

        await this.store.append({
          type: 'deterministic-checked',
          at: t(),
          goalId: goal.id,
          verdict: deterministicVerdict,
        });

        if (!deterministicVerdict.pass) {
          // Deterministic fail → try repair rung, then escalate, never judge
          const resolution = await this.handleFailure(
            goal,
            artifact,
            deterministicVerdict,
            budget,
            tier,
            tierIndex,
            tierLadder,
            priorAttempt,
          );

          if (resolution.kind === 'repaired') {
            // Repaired: loop again with the repaired artifact as context
            budget = resolution.budget;
            priorAttempt = {
              artifact: resolution.artifact,
              verdict: deterministicVerdict,
            };
            // Re-run checks on the repaired artifact immediately (repair is part of
            // the same attempt that produced the flawed artifact — no extra consume)
            const recheck = await this.recheckAndJudge(
              goal,
              resolution.artifact,
              budget,
              tier,
            );
            budget = recheck.budget;

            if (recheck.passed) {
              const report = buildReport(goal, resolution.artifact);
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            } else {
              // Repair didn't hold — continue loop with failure context
              priorAttempt = {
                artifact: resolution.artifact,
                verdict: recheck.verdict!,
              };
              if (recheck.tier !== tier) {
                tier = recheck.tier;
                tierIndex = tierLadder.indexOf(tier);
              }
              continue;
            }
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            priorAttempt = { artifact, verdict: deterministicVerdict };
            continue;
          } else {
            // blocked
            return resolution.report;
          }
        }
      }

      // ── LLM JUDGE (only if deterministic passed) ─────────────────────────
      if (typeDef.judgeType !== null) {
        const rubric = `Judge this artifact as a ${typeDef.judgeType} for goal type ${typeDef.name}`;
        const judgeCtx: BrainContext = { tier, memories: goal.memories };
        const verdict = await this.brain.judge(goal, artifact, rubric, judgeCtx);

        // Account for tokens used by this judge call
        {
          const tokensUsed = Math.ceil(JSON.stringify(verdict ?? '').length / 4);
          const tkConsumed = consumeN(budget, 'tokens', tokensUsed);
          budget = tkConsumed.budget;
          if (tkConsumed.exhausted) {
            await this.store.append({ type: 'budget-exhausted', at: t(), goalId: goal.id, dimension: 'tokens' });
            return this.runBlock(goal, exhaustedBrief(goal, 'tokens'));
          }
        }

        await this.store.append({
          type: 'judge-verdict',
          at: t(),
          goalId: goal.id,
          judgeType: typeDef.judgeType,
          verdict,
          tier,
        });

        if (!verdict.pass) {
          const resolution = await this.handleFailure(
            goal,
            artifact,
            verdict,
            budget,
            tier,
            tierIndex,
            tierLadder,
            priorAttempt,
          );

          if (resolution.kind === 'repaired') {
            budget = resolution.budget;
            priorAttempt = {
              artifact: resolution.artifact,
              verdict,
            };
            // Repair is part of the same attempt — no extra consume
            const recheck = await this.recheckAndJudge(
              goal,
              resolution.artifact,
              budget,
              tier,
            );
            budget = recheck.budget;

            if (recheck.passed) {
              const report = buildReport(goal, resolution.artifact);
              await this.store.append({
                type: 'emitted',
                at: t(),
                goalId: goal.id,
                report,
              });
              return report;
            } else {
              priorAttempt = {
                artifact: resolution.artifact,
                verdict: recheck.verdict!,
              };
              if (recheck.tier !== tier) {
                tier = recheck.tier;
                tierIndex = tierLadder.indexOf(tier);
              }
              continue;
            }
          } else if (resolution.kind === 'escalated') {
            tier = resolution.tier;
            tierIndex = tierLadder.indexOf(tier);
            budget = resolution.budget;
            priorAttempt = { artifact, verdict };
            continue;
          } else {
            return resolution.report;
          }
        }
      }

      // Both gates passed (or no judge) — emit the report
      const report = buildReport(goal, artifact);
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return report;
    }
  }

  /**
   * Re-run all deterministic checks (and judge if applicable) on a repaired
   * artifact. Returns whether it passed and the updated budget.
   */
  private async recheckAndJudge(
    goal: Goal,
    artifact: Artifact,
    budget: Budget,
    tier: Tier,
  ): Promise<{ passed: boolean; budget: Budget; verdict: Verdict | null; tier: Tier }> {
    const t = this.now;
    const typeDef = this.registry.get(goal.type);

    // Re-run deterministic
    if (typeDef.deterministic.length > 0) {
      const findings: Finding[] = [];
      let allOk = true;
      let toolCallsUsed = 0;

      for (const check of typeDef.deterministic) {
        toolCallsUsed++;
        const result = await check.run(goal, artifact);
        if (!result.ok) {
          allOk = false;
          findings.push({
            title: `${check.name}: ${result.detail}`,
            dimension: 'spec',
            severity: 'high',
            gating: true,
          });
        }
      }

      const tcConsumed = consumeN(budget, 'toolCalls', toolCallsUsed);
      budget = tcConsumed.budget;

      const detVerdict: Verdict = {
        pass: allOk,
        findings,
        ...(allOk ? {} : { failureSignature: `deterministic:${findings.map((f) => f.title).join(',')}` }),
      };

      await this.store.append({
        type: 'deterministic-checked',
        at: t(),
        goalId: goal.id,
        verdict: detVerdict,
      });

      if (!detVerdict.pass) {
        return { passed: false, budget, verdict: detVerdict, tier };
      }
    }

    // Re-run judge
    if (typeDef.judgeType !== null) {
      const rubric = `Judge this artifact as a ${typeDef.judgeType} for goal type ${typeDef.name}`;
      const judgeCtx: BrainContext = { tier, memories: goal.memories };
      const verdict = await this.brain.judge(goal, artifact, rubric, judgeCtx);

      await this.store.append({
        type: 'judge-verdict',
        at: t(),
        goalId: goal.id,
        judgeType: typeDef.judgeType,
        verdict,
        tier,
      });

      if (!verdict.pass) {
        return { passed: false, budget, verdict, tier };
      }
    }

    return { passed: true, budget, verdict: null, tier };
  }

  /**
   * After a failing verdict, decide what to do:
   * - escalated finding → block
   * - has prescriptions → repair rung
   * - no prescription → tier escalation
   * - isomorphic failure → block early
   */
  private async handleFailure(
    goal: Goal,
    artifact: Artifact,
    verdict: Verdict,
    budget: Budget,
    tier: Tier,
    tierIndex: number,
    tierLadder: Tier[],
    priorAttempt: { artifact: Artifact | null; verdict: Verdict } | undefined,
  ): Promise<
    | { kind: 'repaired'; artifact: Artifact; budget: Budget }
    | { kind: 'escalated'; tier: Tier; budget: Budget }
    | { kind: 'blocked'; report: Report }
  > {
    const t = this.now;

    // Check for escalated findings — human decision required
    const escalatedFinding = verdict.findings.find(
      (f) => f.gating && f.escalated,
    );
    if (escalatedFinding) {
      const report = blockedReport(
        `Escalated finding requires human decision: ${escalatedFinding.title}`,
        verdict.findings.map((f) => f.title),
      );
      const brief = escalatedBrief(goal, escalatedFinding);
      const resolution = this.onBrief ? await this.onBrief(brief) : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return { kind: 'blocked', report };
    }

    // Isomorphic failure check
    if (
      priorAttempt &&
      verdict.failureSignature &&
      priorAttempt.verdict.failureSignature === verdict.failureSignature
    ) {
      const report = blockedReport(
        `Isomorphic failure detected (signature: ${verdict.failureSignature}) — escalating to block`,
        verdict.findings.map((f) => f.title),
      );
      const brief = isomorphicBrief(goal, verdict.failureSignature);
      const resolution = this.onBrief ? await this.onBrief(brief) : brief.onTimeout;
      await this.store.append({
        type: 'blocked',
        at: t(),
        goalId: goal.id,
        brief,
        resolution,
      });
      await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
      return { kind: 'blocked', report };
    }

    // Repair rung: gating findings with prescriptions that are not escalated
    const prescribedFindings = verdict.findings.filter(
      (f) => f.gating && f.prescription && !f.escalated,
    );

    if (prescribedFindings.length > 0) {
      const prescriptions = prescribedFindings.map((f) => f.prescription!);
      const repairCtx: BrainContext = { tier, memories: goal.memories };
      const repairedArtifact = await this.brain.repair(
        goal,
        artifact,
        prescriptions,
        repairCtx,
      );
      await this.store.append({
        type: 'repair-applied',
        at: t(),
        goalId: goal.id,
        prescriptions,
      });
      return { kind: 'repaired', artifact: repairedArtifact, budget };
    }

    // No prescriptions → escalate tier
    const nextTierIndex = tierIndex + 1;
    if (nextTierIndex < tierLadder.length) {
      const nextTier = tierLadder[nextTierIndex];
      if (nextTier === undefined) {
        // Ladder exhausted
        return this.blockOnBudgetExhaustion(goal, budget, 'attempts');
      }
      await this.store.append({
        type: 'tier-escalated',
        at: t(),
        goalId: goal.id,
        from: tier,
        to: nextTier,
      });
      return { kind: 'escalated', tier: nextTier, budget };
    }

    // Tier ladder exhausted → block
    return this.blockOnBudgetExhaustion(goal, budget, 'attempts');
  }

  private async blockOnBudgetExhaustion(
    goal: Goal,
    budget: Budget,
    dim: keyof Budget,
  ): Promise<{ kind: 'blocked'; report: Report }> {
    const t = this.now;
    const brief = exhaustedBrief(goal, dim);
    await this.store.append({
      type: 'budget-exhausted',
      at: t(),
      goalId: goal.id,
      dimension: dim,
    });
    const report = await this.runBlock(goal, brief);
    return { kind: 'blocked', report };
  }

  // ── SPLIT PATH ────────────────────────────────────────────────────────────
  private async runSplit(goal: Goal, children: ChildPlan[]): Promise<Report> {
    const t = this.now;

    // Subdivide the budget by each child's share
    const shares = children.map((c) => c.budgetShare);
    const budgets = subdivide(goal.budget, shares);

    // Build child goals, injecting memories via memory.query (spawner-mediated)
    const childGoals: Goal[] = await Promise.all(children.map(async (child, i) => {
      const childMemories = await this.memory.query(child.title, child.scope);
      const childBudget = budgets[i] ?? {
        attempts: 1,
        tokens: 1,
        toolCalls: 1,
        wallClockMs: 1,
      };
      return {
        id: `${goal.id}/${child.localId}`,
        type: child.type,
        parentId: goal.id,
        title: child.title,
        spec: child.spec,
        intent: child.intent ?? goal.intent,
        scope: child.scope,
        budget: childBudget,
        memories: childMemories,
      };
    }));

    // Emit child-spawned events
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childGoal = childGoals[i]!;
      await this.store.append({
        type: 'child-spawned',
        at: t(),
        goalId: goal.id,
        childId: childGoal.id,
        childType: child.type,
        dependsOn: child.dependsOn.map((localId) => `${goal.id}/${localId}`),
      });
    }

    // Build a promise map: localId → Promise<Report>
    // Children run when all dependsOn siblings' reports are available.
    const reportMap = new Map<string, Promise<Report>>();
    const localIdToIndex = new Map<string, number>();
    children.forEach((c, i) => localIdToIndex.set(c.localId, i));

    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      const childGoal = childGoals[i]!;

      const depPromises = child.dependsOn.map((depLocalId) => {
        const p = reportMap.get(depLocalId);
        if (!p) throw new Error(`Dependency "${depLocalId}" not found — this should have been caught in validateSplit`);
        return p;
      });

      // This child's promise awaits its deps then runs
      const childPromise = (async () => {
        try {
          // Await all dependencies
          const depReports = await Promise.all(depPromises);

          // If any dependency failed or blocked, this child is blocked too
          const failedDep = depReports.find((r) => r.blockers.length > 0);
          if (failedDep) {
            const report = blockedReport(
              `Blocked because a dependency failed: ${failedDep.blockers[0] ?? 'unknown'}`,
            );
            await this.store.append({
              type: 'emitted',
              at: t(),
              goalId: childGoal.id,
              report,
            });
            return report;
          }

          // Run the child through the engine
          return await this.run(childGoal);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const report = blockedReport(`child threw: ${msg}`);
          await this.store.append({ type: 'emitted', at: t(), goalId: childGoal.id, report });
          return report;
        }
      })();

      reportMap.set(child.localId, childPromise);
    }

    // Await all children
    const allPromises = children.map((c) => reportMap.get(c.localId)!);
    const childReports = await Promise.all(allPromises);

    // ── INTEGRATE ────────────────────────────────────────────────────────────
    // Merge artifacts
    const allFiles: { path: string; content: string }[] = [];
    const allTexts: string[] = [];
    let hasFiles = false;
    let hasText = false;

    for (const r of childReports) {
      if (r.artifact) {
        if (r.artifact.kind === 'files' && r.artifact.files) {
          allFiles.push(...r.artifact.files);
          hasFiles = true;
        } else if (r.artifact.kind === 'text' && r.artifact.text) {
          allTexts.push(r.artifact.text);
          hasText = true;
        }
      }
    }

    let mergedArtifact: import('../contract/report.js').Artifact | null = null;
    if (hasFiles) {
      mergedArtifact = { kind: 'files', files: allFiles };
    } else if (hasText) {
      mergedArtifact = { kind: 'text', text: allTexts.join('\n') };
    }

    // Integration eval: if registry has judge-integration, judge the assembly
    const integrationFindings: string[] = [];
    const integrationBlockers: string[] = [];
    if (this.registry.has('judge-integration') && mergedArtifact) {
      const rubric = `Does the integrated artifact satisfy the original goal: "${goal.title}"?`;
      const integTypeDef = this.registry.get(goal.type);
      const judgeCtx: BrainContext = {
        tier: integTypeDef.tier.default,
        memories: goal.memories,
      };
      const intVerdict = await this.brain.judge(
        goal,
        mergedArtifact,
        rubric,
        judgeCtx,
      );
      if (!intVerdict.pass) {
        // Failing integration is a hard blocker — emit failure honestly
        const msg = `Integration eval failed: ${intVerdict.findings.map((f) => f.title).join(', ')}`;
        integrationBlockers.push(msg);
        integrationFindings.push(msg);
      }
    }

    // ── PROMOTE: lessons and memory reinforcement ─────────────────────────
    const allLessons: string[] = [];
    const allLearnedLines: string[] = [];

    for (let i = 0; i < childReports.length; i++) {
      const r = childReports[i]!;
      const childGoal = childGoals[i]!;
      const succeeded = r.blockers.length === 0;

      // Promote each lesson as a provisional memory write
      for (const lesson of r.lessons) {
        const pointer: MemoryPointer = {
          id: `${childGoal.id}:lesson:${lesson.slice(0, 40)}`,
          layer: 'project',
          content: lesson,
          provenance: 'provisional',
        };
        await this.store.append({
          type: 'memory-written',
          at: t(),
          goalId: childGoal.id,
          pointer,
        });
        allLessons.push(lesson);
      }

      // Reinforce memories actually used
      for (const memId of r.memoriesUsed) {
        await this.store.append({
          type: 'memory-reinforced',
          at: t(),
          goalId: childGoal.id,
          memoryId: memId,
          outcome: succeeded ? 'success' : 'failure',
        });
      }

      if (r.learned) allLearnedLines.push(r.learned);
    }

    // Deduplicate lessons
    const uniqueLessons = [...new Set(allLessons)];
    const uniqueLearnedLines = [...new Set(allLearnedLines)];

    // Collect all blockers and child findings
    const allBlockers: string[] = [...integrationBlockers];
    const allFindings: string[] = [...integrationFindings];
    for (const r of childReports) {
      allBlockers.push(...r.blockers);
      allFindings.push(...r.findings);
    }

    const report: Report = {
      artifact: mergedArtifact,
      proof: [],
      lessons: uniqueLessons,
      memoriesUsed: childReports.flatMap((r) => r.memoriesUsed),
      blockers: allBlockers,
      findings: allFindings,
      learned: uniqueLearnedLines.join('\n'),
    };

    await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
    return report;
  }

  // ── BLOCK PATH ────────────────────────────────────────────────────────────
  private async runBlock(
    goal: Goal,
    brief: import('../contract/decision.js').DecisionBrief,
  ): Promise<Report> {
    const t = this.now;
    const resolution = this.onBrief
      ? await this.onBrief(brief)
      : brief.onTimeout;
    await this.store.append({
      type: 'blocked',
      at: t(),
      goalId: goal.id,
      brief,
      resolution,
    });
    const report = blockedReport(brief.question);
    await this.store.append({ type: 'emitted', at: t(), goalId: goal.id, report });
    return report;
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────────────

/**
 * Validate structural constraints on a proposed split.
 * Returns an error message if invalid, or null if valid.
 */
function validateSplit(children: ChildPlan[], budget: Budget): string | null {
  if (children.length === 0) return 'Split must have at least one child';

  // Fan-out guard: child count must not exceed the parent attempt budget
  if (children.length > budget.attempts) {
    return `Fan-out of ${children.length} children exceeds parent attempt budget of ${budget.attempts}`;
  }

  const localIds = new Set(children.map((c) => c.localId));

  // localIds must be unique
  if (localIds.size !== children.length) return 'Duplicate localIds in split';

  // budgetShares must sum to ≤ 1
  const totalShare = children.reduce((s, c) => s + c.budgetShare, 0);
  if (totalShare > 1.0001) {
    return `budgetShares sum to ${totalShare.toFixed(4)}, must be ≤ 1`;
  }

  // dependsOn must reference sibling localIds
  for (const child of children) {
    for (const dep of child.dependsOn) {
      if (!localIds.has(dep)) {
        return `Child "${child.localId}" depends on unknown sibling "${dep}"`;
      }
      if (dep === child.localId) {
        return `Child "${child.localId}" depends on itself`;
      }
    }
  }

  // dependsOn must be acyclic (DFS cycle detection)
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const depMap = new Map(children.map((c) => [c.localId, c.dependsOn]));

  function hasCycle(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    for (const dep of depMap.get(id) ?? []) {
      if (hasCycle(dep)) return true;
    }
    inStack.delete(id);
    return false;
  }

  for (const child of children) {
    if (hasCycle(child.localId)) {
      return `Cyclic dependency detected in split`;
    }
  }

  return null;
}

function blockedReport(reason: string, findings: string[] = []): Report {
  return {
    artifact: null,
    proof: [],
    lessons: [],
    memoriesUsed: [],
    blockers: [reason],
    findings,
    learned: '',
  };
}

function buildReport(goal: Goal, artifact: Artifact): Report {
  return {
    artifact,
    proof: [],
    lessons: [],
    memoriesUsed: goal.memories.map((m) => m.id),
    blockers: [],
    findings: [],
    learned: '',
  };
}

function unknownTypeBrief(
  goal: Goal,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Unknown goal type: "${goal.type}". How should this goal be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function exhaustedBrief(
  goal: Goal,
  dim: keyof Budget,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" exhausted its ${dim} budget. How should it be handled?`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function escalatedBrief(
  goal: Goal,
  finding: Finding,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" has an escalated finding requiring human decision: "${finding.title}"`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

function isomorphicBrief(
  goal: Goal,
  signature: string,
): import('../contract/decision.js').DecisionBrief {
  return {
    question: `Goal "${goal.title}" is repeating the same failure (signature: "${signature}"). Needs human resolution.`,
    options: ['deny', 'park', 'bounce'],
    links: [goal.id],
    deadlineMs: 30_000,
    onTimeout: 'deny',
  };
}

/**
 * Consume N units of a budget dimension at once.
 */
function consumeN(
  budget: Budget,
  dim: keyof Budget,
  n: number,
): { budget: Budget; exhausted: boolean } {
  const next: Budget = { ...budget, [dim]: budget[dim] - n };
  return { budget: next, exhausted: next[dim] <= 0 };
}
