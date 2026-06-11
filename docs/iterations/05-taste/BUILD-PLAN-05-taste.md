# Build plan — 05-taste

**Status:** Awaiting approval · **Iteration goal:** After this iteration the
library stands at all 19 types with real per-family skill bundles (the
generic-prompt ceiling removed), artifact emission is provider-guaranteed
JSON (explore-then-emit), the intent dial modulates judges (never
deterministic gates), golden-set capture accrues from live runs, retries
carry what the failed attempt learned, and a commissioned mini-intent flows
PRD → architecture → contract → implementation fully scripted — with the
live mapping retest targeting 5/5 on the new cost-optimized tier models.
· **Iteration slug:** `05-taste`

Planned by the orchestrator directly. Gate-brief decisions locked
2026-06-11: **ADR-022** (markdown family skill files), **ADR-023**
(two-phase structured emission), **ADR-024** (golden capture as events);
scope = full 19 types with the evolve family thin (deep evolve content is
iteration 6's improvement loop). Model tier bindings already swapped
(ADR-005 amendment): deepseek-v4-flash / deepseek-v4-pro / kimi-k2.6.

## Blockers

None.

## Frozen contracts (one barrier commit on `build/05-taste`)

| Contract | Source of truth | Frozen signature (file) | Consumers |
|---|---|---|---|
| `GoalTypeDef.family: string` (required) + missing-skill lint | ADR-022 | EXTEND `src/contract/goal-type.ts`; lint in constitution | F-52 (loader), F-53/54/55 (cards), engine injection |
| `GoalTypeDef.outputSchema?` + `BrainContext.outputSchema?` | ADR-023 | EXTEND `goal-type.ts` + `brain.ts` (additive optionals) | F-51 (engine+adapter), F-53 (write-prd), learn cards |
| `FactoryEvent` += `golden-candidate {at, goalId, judgeType, artifactDigest, rubricDigest, verdictPass, tier, model?}` | ADR-024 | EXTEND `events.ts` (additive; switch arms at barrier) | F-56, F-57 |
| `Usage.cachedPromptTokens?` | ADR-017 (additive) | EXTEND `goal.ts` | F-56 (parsing + summary) |
| Skill-loader surface `loadFamilySkill(family) => {family, full, sectionFor(type)}` | ADR-022 | Library-side frozen surface `src/library/skills.ts` | F-52 implements; engine + F-53/54/55 consume |

**Barrier compiles green** (standing rule): `family` is REQUIRED on
GoalTypeDef — the barrier sets it on all 10 existing type cards
mechanically (families per GOAL-TYPES) and adds switch arms; everything
else is additive-optional.

## Features & build order

| Feature | Spec | After (scheduling) |
|---|---|---|
| F-51 structured emission | [01](01-structured-emission.md) | *(barrier)* — trunk (engine.ts + llm.ts) |
| F-52 skill loader + refactor + port | [02](02-skill-loader.md) | *(barrier)* — worktree; **folds back before F-53/54/55 start** (they own the per-family modules its refactor creates) |
| F-53 PM/discovery types | [03](03-pm-types.md) | F-52 fold *(family-module files)* — worktree |
| F-54 judge completion + intent dial | [04](04-judge-completion.md) | F-52 fold — worktree |
| F-55 evolve thin | [05](05-evolve-thin.md) | F-52 fold — worktree |
| F-56 carried debt | [06](06-flywheel-debt.md) | F-51 *(engine.ts overlap)* — trunk |
| F-57 assembly + convergence | [07](07-assembly-taste.md) | F-51..F-56 *(hard)* — trunk, last |

Waves: barrier → wave 1: F-51 (trunk) ∥ F-52 (worktree) → fold F-52 →
wave 2: F-53 ∥ F-54 ∥ F-55 (worktrees, disjoint family modules) ∥ F-56
(trunk, after F-51) → fold → F-57. Same judge/repair rung per feature;
process-clean sweep; scripted convergence before any live call; live runs
orchestrator-only.

## Standing decisions carried forward

Engine sole debitor · adapter purity · builders never touch docs/ or run
live scripts · process-clean code AND test labels · barrier compiles green
with mechanical propagation · live evidence is reported honestly, variance
and all.

## Reconciliation self-review (five points)

1. Cross-feature contradictions: none — F-52's refactor creates the
   disjoint per-family files F-53/54/55 own; the fold-before rule prevents
   the starter-types collision.
2. Decision propagation: ADR-022/023/024 cited on every consuming spec.
3. Orphaned work: F-57 owns all wiring; the engine's skill-injection seam
   is F-52's (named), the two-phase seam F-51's (named).
4. Barrier compiles standalone: yes — one required-field addition with
   mechanical card updates at the barrier; rest additive-optional.
5. Assembly ownership: F-57, honest hard deps, scripted-before-live.

Named soft spot: F-56's carried-exploration digest (what summarizes a
transcript, how big) is a builder judgment — bound it (e.g. last N tool
results, capped chars) and report; don't improvise broadly.

## The live retest (the iteration's headline evidence)

live:eyes on corellia must be re-run after F-57 with structured emission +
the new tiers: the iteration-04 baseline was never-5/5 with $2-6/run; the
target is 5/5 artifacts validated at well under $1/run. Report whatever
happens, honestly.
