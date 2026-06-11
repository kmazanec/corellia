---
id: F-33
title: run_script + checks that execute
iteration: 03-hands
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-014, ADR-016]
---

# Feature: `run_script` + deterministic checks that execute

**ID:** F-33 · **Iteration:** 03-hands · **Status:** Not started

## What this delivers (before → after)

**Before:** deterministic checks inspect artifact strings; nothing ever
compiles or runs; "tests pass" is a text pattern.
**After:** the `run_script` tool executes a target repo's declared
entry-point scripts (by name, never shell text) as bare processes in the
sandbox, and code-emitting goal-type evals gate on the real exit status; a
repo missing its declared entry points bounces at the capability check
before any tree spend.

## How it fits the roadmap

This is what makes the goal-type eval honest (PRD R10) and the regression
guard real later (iteration 4's full-suite-at-root reuses it). No hard
dependencies.

## Reading brief

`docs/adrs/ADR-016` (scripts-by-name, bare exec, the trust posture) ·
`docs/adrs/ADR-014` (tool shape) · `src/library/checks.ts` (the check
interface being upgraded) · DESIGN.md § "Eval economics" (deterministic
before judge) and § "The root's receive is the intake" (capability check).

## Requirements traced (from the PRD)

R10, R12 · AC-5, AC-8, AC-17 (the gate half — baseline semantics arrive with
iteration 4's comprehension).

## Dependencies (must exist before this starts)

None — builds against the frozen tool shapes.

## Unblocks (what waits on this)

Nothing hard-waits; F-36's live demo and the iteration's convergence check
consume it.

## Contracts touched

Tool shapes (ADR-014) — consumed. The check-definition shape gains an
executing variant — if that requires touching `src/contract/goal-type.ts`,
it belongs in the barrier; flag at plan time.

## Acceptance criteria (product behavior)

1. Given a repo declaring a test entry point, when `run_script("test")` is
   called, then the script runs with the sandbox worktree as cwd and the
   result carries exit status and captured output (truncated to a stated
   cap for transcripts; full output in the event).
2. Given a script name not in the repo's declared set, then the call is
   refused with the reason — model-composed shell text is structurally
   impossible.
3. Given an `implement` leaf whose goal-type eval declares an executing
   check, then a red exit status fails the deterministic gate (the judge is
   never consulted on a red gate) and a green one proceeds to the judge.
4. Given a commission against a repo missing the declared entry points, then
   it bounces at receive with a stated reason and zero subtree spend.
5. Script runs appear as events with command name, exit status, duration,
   and output reference.

## Testing requirements

Fixture mini-repo (tmp dir with declared scripts: one green, one red, one
hanging) covering: green gate, red gate, refusal of undeclared names,
output capture/truncation, wall-clock bound on a hanging script. No live
API usage.

## Manual setup required

None.

## Implementation notes (filled in by the building agent)

> Owned by the builder, not the planner. Starts empty.

## Build plan (approved)

The deterministic gate is made honest by executing a target repo's declared entry-point scripts by name and gating code-emitting evals on the real exit status. The approach is the smallest well-factored slice that satisfies the criteria without building the full ADR-014 ToolBroker (which does not exist in the tree and is not a hard dependency): (1) a plain `ScriptRunner` primitive that resolves a script name against a repo's declared entry-point set and spawns it as a bare child process with the worktree as cwd, wall-clock bounded, capturing exit status and output; (2) an executing `DeterministicCheck` produced by a factory that closes over a ScriptRunner + script name, keeping the frozen `DeterministicCheck.run(goal, artifact)` signature untouched; (3) one additive `script-ran` member on the `FactoryEvent` union for AC-5; (4) a small `verifyEntryPoints` capability check the listener/root calls at receive to bounce a repo missing declared entry points before any subtree spend (AC-4). This avoids building the broker now because the broker is a separate, larger contract surface the spec explicitly lets us defer, and the gate's honesty needs only the bare-exec primitive plus a closure.

### Build chunks

- [ ] **ScriptRunner: declared-name resolution + bare-process exec with wall-clock bound and output capture**
  - Delivers: A pure function/module that, given a repo root, a declared entry-point map, a script name, and a wall-clock ceiling, refuses undeclared names (returns a refusal, never spawns), and for declared names spawns the script as a bare child process with the repo worktree as cwd, capturing exit status and stdout/stderr, killing on timeout. No model-composed shell text is ever accepted — the input is a name, looked up in the declared set.
  - Acceptance criteria: AC-1 (runs with worktree as cwd; result carries exit status + captured output), AC-2 (undeclared name refused with reason; shell text structurally impossible — only a name is an input), testing-requirements: wall-clock bound on a hanging script; output capture/truncation.
  - Test targets: `tests/library/script-runner.test.ts` (NEW) — uses a fixture mini-repo built in a tmp dir (node:os tmpdir + node:fs/promises) with three declared scripts: green (exit 0, prints to stdout), red (exit 1), hanging (sleeps past the bound). Asserts: green→{exit:0, output}, red→{exit:1}, undeclared name→refusal {ok:false, reason} with no spawn, hanging→killed at the wall-clock bound with a timed-out result, output truncated to the stated cap while full output is preserved on the runner's full-output field. No live API.
  - Contract touchpoint: None. (ADR-016 bare-exec primitive as a standalone function; uses node:child_process.spawn with {cwd, shell:false} — shell:false is the structural guarantee for AC-2.)

- [ ] **Executing deterministic check (closure factory) + truncation cap surfaced to verdict detail**
  - Delivers: A `runScriptCheck(runner, scriptName)` factory in src/library/checks.ts returning a DeterministicCheck whose `run(goal, artifact)` invokes the captured runner against the script name and returns {ok: exitStatus===0, detail} with output truncated to the stated transcript cap. The frozen DeterministicCheck signature is NOT changed — the runner is closed over, exactly the pattern fileContains already uses for parameterized checks.
  - Acceptance criteria: AC-3 (red exit fails the deterministic gate; green proceeds — the engine's existing deterministic-fail branch already skips the judge, so this chunk only has to return ok:false on red).
  - Test targets: `tests/library/checks.test.ts` (EXTEND, existing file) — add a describe('runScriptCheck') feeding a fake/stub ScriptRunner: green run → {ok:true}, red run → {ok:false, detail includes exit status + truncated output}, refusal/undeclared → {ok:false} with the refusal reason. Plus `tests/engine/gates.test.ts` (EXTEND) one case proving a red executing check drives the deterministic-fail path and the judge is never consulted (assert no judge-verdict event appended).
  - Contract touchpoint: None. (Closure factory keeps DeterministicCheck.run(goal, artifact) frozen — this is the explicit way to avoid touching src/contract/goal-type.ts the spec flagged.)

- [ ] **script-ran event on the FactoryEvent union + emission from the executing check path**
  - Delivers: One additive discriminated-union member `{ type: 'script-ran'; at; goalId; command; exitStatus; durationMs; outputRef }` appended whenever an executing check runs a script, carrying command name, exit status, duration, and an output reference (the full output stored/keyed so the event references it rather than inlines the truncated transcript).
  - Acceptance criteria: AC-5 (script runs appear as events with command name, exit status, duration, and output reference), AC-1 (full output in the event).
  - Test targets: `tests/eventlog/stores.test.ts` (EXTEND) — round-trip a 'script-ran' event through memory-store and list(filter:{type:'script-ran'}). `tests/library/checks.test.ts` (EXTEND) — assert the executing check appends exactly one 'script-ran' event with the four required fields via an injected EventStore stub. `tests/eventlog/projections.test.ts` only if a projection switches on event type and must stay exhaustive.
  - Contract touchpoint: `FactoryEvent` (events.ts). (ADR-003 discipline: any exhaustive switch over FactoryEvent must be made to handle 'script-ran' — grep for switch(e.type)/never-exhaustiveness in projections.ts and engine.ts and add the case.)

- [ ] **Capability check at receive: bounce a repo missing declared entry points with zero subtree spend**
  - Delivers: A `verifyEntryPoints(repoRoot, declaredScripts)` function called at the root/listener intake that confirms each declared entry point is resolvable/present in the target repo; on a miss it bounces the commission at receive with a stated reason and spawns no subtree (zero spend).
  - Acceptance criteria: AC-4 (commission against a repo missing declared entry points bounces at receive with a stated reason and zero subtree spend).
  - Test targets: `tests/library/script-runner.test.ts` (EXTEND) for verifyEntryPoints unit: all-present→ok, missing→{ok:false, reason naming the missing entry point}. `tests/listener/listener.test.ts` (EXTEND) — a commission whose declared scripts are absent resolves as a bounce at receive and no child-spawned / no deterministic-checked events are appended (assert zero subtree-spend events).
  - Contract touchpoint: None. (Capability-check-before-spend is the DESIGN.md 'root's receive is the intake' rule; placement is the listener/root, mirroring how risk/classify already gate at intake.)

### Test strategy

Unit-heavy with one integration case, all hermetic — the spec mandates a fixture mini-repo in a tmp dir and forbids live API. Unit: ScriptRunner (real child_process.spawn against a real tmp-dir fixture repo with green/red/hanging declared scripts — this is the load-bearing test because exit-status truth and the wall-clock kill are what make the gate honest; do NOT mock spawn here), the runScriptCheck closure (stub runner — fast, deterministic), verifyEntryPoints (real tmp fs). Integration: one engine/gates.test.ts case proving red executing check → deterministic gate fails → judge never consulted (asserts absence of judge-verdict event), and one listener.test.ts case proving the missing-entry-point bounce emits zero subtree-spend events. Contract: a stores.test.ts round-trip of the new script-ran event. Architecture-named risks demanding extra coverage: (a) the hanging-script wall-clock kill must assert the child process is actually terminated (no leaked process) not just that the promise rejects; (b) AC-2's 'structurally impossible' claim must be a test that the only input is a name and shell:false is set — assert by feeding a name containing shell metacharacters and confirming it is treated as an undeclared name (refused), never executed. Per-chunk targets are named so the build runs JUST those files via `vitest run <path>`, not the whole suite. The repo typecheck gate (`tsc --noEmit`) runs once at feature end and will catch any non-exhaustive switch over the extended FactoryEvent union.

### Contract touchpoints

| Contract | Action | Signature |
|----------|--------|-----------|
| FactoryEvent (src/contract/events.ts) | extends | Add one union member: `\| { type: 'script-ran'; at: number; goalId: string; command: string; exitStatus: number \| null; durationMs: number; outputRef: string }` (exitStatus is null when the run was killed by the wall-clock bound). Every exhaustive switch over FactoryEvent['type'] — currently in src/eventlog/projections.ts and any never-exhaustiveness assertion in src/engine/engine.ts — must add a 'script-ran' case to stay exhaustive (ADR-003). No other contract field changes; DeterministicCheck and GoalTypeDef in src/contract/goal-type.ts are deliberately NOT touched (the executing variant is a closure-produced DeterministicCheck, not a new contract shape). |

### Risks

- **dependsOn:[] is almost certainly WRONG.** F-33's spec says it 'builds against the frozen tool shapes' (ADR-014: ToolDef/ToolCall/ToolResult/ToolBroker), but NONE of that exists in the tree — no src/contract/tool.ts, no broker, no run_script, no sandbox/worktree machinery, no tool event in FactoryEvent. Either an earlier iteration-3 feature that builds the broker was supposed to precede this and was missed, or run_script is expected standalone. The plan routes AROUND this by building run_script as a standalone ScriptRunner primitive (ADR-016 bare-exec) NOT wired through a ToolBroker; confirm with the orchestrator whether the broker is a real upstream dependency before build, or this slice silently diverges from ADR-014's 'one broker mediates every call'.

- **ADR-016's worktree lifecycle** (create branch / collect / teardown under .claude/worktrees/<tree-id>/) is declared 'engine-side tree machinery' and does NOT exist either. AC-1 requires 'the sandbox worktree as cwd'. This plan treats the cwd as an injected repoRoot/worktree path the caller supplies and does NOT build worktree create/teardown (out of scope, not in F-33's criteria). If no worktree machinery exists at build time, the integration/QA must run against a plain tmp-dir repo as cwd — acceptable for the tests, but means AC-1's 'sandbox worktree' is satisfied only by interface, not by real worktree isolation. Flag if the orchestrator expected worktree machinery here.

- **AC-1 'truncated to a stated cap'** — the spec never states the cap number. Builder must pick and document a constant (e.g. 4KB or N lines) and surface it in the verdict detail; the truncation test pins whatever constant is chosen. Untestable until the number is fixed by the builder.

- **AC-5 'output reference' shape is unspecified** — could be an event-log key, a tmp file path, or an in-memory id. Plan uses an opaque string outputRef + stores full output addressably; the exact storage mechanism (where full output lives) is a builder decision the spec does not constrain, risking over-engineering. Keep it minimal: a key into the same event-store payload or a tmp file path, no new store.

- **AC-3's 'green proceeds to the judge'** is only HALF-testable here: the executing check returning ok:true is testable, but 'proceeds to the judge' depends on a judge actually being wired for the implement type and on live-vs-scripted brain. Test the deterministic outcome (green→pass, red→fail+no judge event) and treat full green→judge→verdict flow as covered by the existing engine judge path, not re-proven in this feature.

- **child_process.spawn wall-clock kill is a known footgun:** a killed parent does not always reap a detached child tree (the hanging script may spawn its own children). v1 mitigation per ADR-016 is acceptable (operator owns the repos), but the kill test must assert the immediate child is terminated; deep process-tree reaping is out of scope and a documented residual risk.

### Manual setup

None.
