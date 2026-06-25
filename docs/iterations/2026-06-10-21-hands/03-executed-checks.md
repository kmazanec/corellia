---
id: F-33
title: run_script + checks that execute
iteration: 03-hands
type: implement
intent: production
status: shipped
dependsOn: []
contracts: [ADR-014, ADR-016]
---

# Feature: `run_script` + deterministic checks that execute

**ID:** F-33 · **Iteration:** 03-hands · **Status:** Shipped (build/03-hands)

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

> Owned by the builder, not the planner.

Built per the rewritten plan. Truncation cap 4096 bytes (tail); outputRef is an opaque correlation key — full-output persistence deferred (recorded debt: iteration 4 proof-artifact work). Capability bounce is a rejected promise before any reservation (zero-spend structurally guaranteed, judged sound). Assembly wired the scrubbed child env and per-goal script-ran attribution F-33's module left open.

## Build plan (approved — rewritten at approval review, 2026-06-11, to apply resolved Blocker 1)

The deterministic gate is made honest by executing a target repo's declared
entry-point scripts **by name** and gating code-emitting evals on the real
exit status. Per **resolved Blocker 1 (option A)**, the barrier extends the
check contract: `DeterministicCheck.run(goal, artifact, ctx?: CheckContext)`
with `CheckContext = { sandboxRoot?: string; runScript?: (name: string) =>
Promise<ScriptResult> }`. The earlier closure-factory approach (capturing a
runner at type-definition time) is rejected: goal-type definitions are static
factory code and cannot close over per-tree runtime state — the context must
arrive at invocation. F-33 delivers the primitives and the context-consuming
check; **the engine passing a real ctx, and the broker exposing `run_script`
as a tool, are assembly work owned by F-37** — F-33 never touches
`src/engine/engine.ts` and stays safely parallel to the serial chain.

### Build chunks

- [x] **ScriptRunner: declared-name resolution + bare-process exec with wall-clock bound and output capture**
  - Delivers: A pure module that, given a repo root, a declared entry-point map, a script name, and a wall-clock ceiling, refuses undeclared names (returns a refusal, never spawns), and for declared names spawns the script as a bare child process (`node:child_process.spawn` with `{cwd, shell: false}` — the structural guarantee) with the worktree as cwd, capturing exit status and stdout/stderr, killing on timeout. Returns `ScriptResult { ok, exitStatus, output, fullOutput, durationMs, timedOut }`. The declared-script map is **supplied by the commission/fixture** (reading `package.json` automatically is iteration-4 comprehension work — recorded decision).
  - Acceptance criteria: AC-1 (cwd + exit status + captured output), AC-2 (undeclared name refused; shell text structurally impossible), wall-clock bound on a hanging script; output truncation to a builder-documented cap.
  - Test targets: `tests/library/script-runner.test.ts` (NEW) — fixture mini-repo in a tmp dir with green/red/hanging declared scripts. Asserts: green→exit 0 + output, red→exit 1, undeclared→refusal with no spawn, shell-metacharacter name treated as undeclared (refused, never executed), hanging→killed at the bound with the immediate child terminated (no leaked process), truncation cap applied with full output preserved on `fullOutput`. No live API.
  - Contract touchpoint: none (consumes the barrier-frozen `ScriptResult` shape if the barrier placed it in `src/contract/`; otherwise exports it locally — builder follows the barrier).

- [x] **`runScriptTool` — the broker-registrable ToolImpl**
  - Delivers: `runScriptTool(runner)` exporting a **ToolImpl** (the barrier-frozen registration shape in `src/contract/tool.ts`: a `ToolDef` named `run_script` plus its execute function) so the broker's injectable dispatch table (F-31) can register it **at assembly (F-37) without F-31 and F-33 ever touching the same file**. Args: `{ script: string }`. Output: truncated exit-status + output text suitable for a model transcript; refusal (`ok:false`) for undeclared names, flowing through the broker's ordinary refusal path.
  - Acceptance criteria: AC-1/AC-2 exercised through the tool shape (the broker-mediated form the convergence demo's model actually calls).
  - Test targets: `tests/library/script-runner.test.ts` (EXTEND) — invoke the ToolImpl directly against the fixture repo: declared green/red scripts produce ok results carrying exit status; undeclared name produces `ok:false` with reason.
  - Contract touchpoint: consumes `ToolImpl`/`ToolDef`/`ToolResult` from the barrier; introduces nothing.

- [x] **`runScriptCheck(scriptName)` — the executing deterministic check, consuming CheckContext**
  - Delivers: A factory in `src/library/checks.ts` returning a `DeterministicCheck` whose `run(goal, artifact, ctx)` calls `ctx.runScript(scriptName)` and returns `{ok: exitStatus===0, detail}` with truncated output in detail. **Absent ctx (or absent `ctx.runScript`) → `ok:false` with reason "no exec context"** — fail-safe, never a silent pass. Existing artifact-only checks ignore the new optional parameter (the barrier widened the signature additively).
  - Acceptance criteria: AC-3, deterministic half (red exit fails the gate; green passes). The engine-path half — engine supplies the real ctx and a red gate means the judge is never consulted — **is owned by F-37's scripted convergence test**.
  - Test targets: `tests/library/checks.test.ts` (EXTEND) — describe('runScriptCheck'): explicit stub ctx with green run → ok:true; red run → ok:false with exit status + truncated output in detail; refusal → ok:false with the refusal reason; absent ctx → ok:false "no exec context".
  - Contract touchpoint: consumes `CheckContext` + the widened `DeterministicCheck.run` from the barrier (`src/contract/goal-type.ts`, resolved Blocker 1); introduces nothing.

- [x] **`script-ran` event + the logging runner wrapper**
  - Delivers: `loggingScriptRunner(store, runner)` — wraps any ScriptRunner so every run appends one `script-ran` event `{type:'script-ran'; at; goalId; command; exitStatus; durationMs; outputRef}` (exitStatus null when killed at the bound; outputRef an opaque key/path to the full output — keep minimal, no new store). At assembly (F-37), **both** the CheckContext's `runScript` and the broker's `run_script` ToolImpl receive the wrapped runner, so every script execution is logged through one wrapper regardless of which path invoked it.
  - Acceptance criteria: AC-5 (script runs appear as events with command, exit status, duration, output reference), AC-1 (full output addressable via outputRef).
  - Test targets: `tests/library/script-runner.test.ts` (EXTEND) — stub EventStore: exactly one `script-ran` per run with the four required fields. `tests/eventlog/stores.test.ts` (EXTEND) — round-trip the new member through the memory store and `list({...})`.
  - Contract touchpoint: consumes the barrier-frozen `script-ran` member of `FactoryEvent` (`src/contract/events.ts`); introduces nothing.

- [x] **Capability check at receive: bounce a repo missing declared entry points with zero subtree spend**
  - Delivers: `verifyEntryPoints(repoRoot, declaredScripts)` called at the root/listener intake; on a miss the commission bounces at receive with a stated reason and no subtree is spawned (zero spend).
  - Acceptance criteria: AC-4.
  - Test targets: `tests/library/script-runner.test.ts` (EXTEND) — all-present→ok; missing→`{ok:false, reason}` naming the missing entry point. `tests/listener/listener.test.ts` (EXTEND) — a commission whose declared scripts are absent bounces at receive; assert zero subtree-spend events (no child-spawned, no deterministic-checked).
  - Contract touchpoint: none (placement mirrors how risk/classify already gate at intake).

### Test strategy

Unit-heavy and hermetic — fixture mini-repos in tmp dirs, no live API, no
mocking of `spawn` for the ScriptRunner itself (exit-status truth and the
wall-clock kill are the load-bearing behaviors; mock them and the test proves
nothing). The check factory and logging wrapper use stub runners/stores for
speed. The two engine-integration behaviors this feature does NOT test —
engine-supplied CheckContext driving the deterministic-fail path, and the
broker dispatching `run_script` — are explicitly owned by F-37's scripted
convergence test (this feature's tests must not import the engine). Risks
demanding extra coverage: (a) the hanging-script kill asserts the child is
actually terminated, not just that the promise settles; (b) AC-2's
"structurally impossible" is proven by feeding a name containing shell
metacharacters and asserting refusal-as-undeclared with `shell:false` set.
Per-chunk: run only the named files via `npx vitest run <path>`; one repo
`npm run typecheck` + full `npm test` at feature end.

### Contract touchpoints

| Contract | Action | Signature |
|----------|--------|-----------|
| `CheckContext` + widened `DeterministicCheck.run` (src/contract/goal-type.ts) | consumes | Barrier (resolved Blocker 1): `run(goal, artifact, ctx?: CheckContext)`; `CheckContext = { sandboxRoot?: string; runScript?: (name: string) => Promise<ScriptResult> }`. Additive optional param — existing checks compile unchanged. |
| `ToolImpl` registration shape (src/contract/tool.ts) | consumes | Barrier: `ToolImpl = { def: ToolDef; execute(goal, args): Promise<ToolResult-payload> }` (exact frozen form per barrier). F-33 exports `runScriptTool` as one; F-31's broker accepts `ToolImpl[]` at construction. |
| `FactoryEvent` `script-ran` member (src/contract/events.ts) | consumes | Barrier: `{ type: 'script-ran'; at: number; goalId: string; command: string; exitStatus: number | null; durationMs: number; outputRef: string }`. Exhaustive switches handled at the barrier. |

### Risks

- **Truncation cap is unstated** — builder picks and documents a constant
  (e.g. 4KB / N lines), surfaces it in verdict detail; the test pins it.
- **outputRef storage is a builder decision** — keep minimal (a key or tmp
  path); no new store.
- **spawn kill footgun** — a killed child may not reap its own children;
  v1 accepts the residual risk (ADR-016 posture); the test asserts the
  immediate child dies.
- **AC-3's engine half lives in F-37** — if F-37 is descoped, AC-3 is only
  half-proven; do not mark the iteration done on unit tests alone.

### Manual setup

None.
