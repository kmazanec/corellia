---
type: iteration
title: "Iteration 09 — Comprehension scoping (ADR-029 Decisions 2 + 4)"
description: Build the layer that decides WHAT to comprehend — relevance-bounded coverage, scoped JIT comprehension — then prove AC-2 (foreign-eyes on cats) and AC-3 (live:self delivers + ships a PR) live across 14 runs, each buying one real fix.
tags: [iteration, comprehension-scoping, adr-029, adr-030, coverage-gate, jit, live-self, live-foreign-eyes, ac-2, ac-3, soft-budgets]
timestamp: 2026-06-23
status: proven-live
---

# Iteration 09 — Comprehension scoping (ADR-029 Decisions 2 + 4)

**Date:** 2026-06-23 · **Status:** Proven live (AC-2 + AC-3 both proven end-to-end)

Built on `main` (hand-build, per the bootstrap contract: commissioning this
through `live:self` would drown in the very over-firing it fixes). The recursion
MECHANISM (iteration 08, Decisions 1+3) was proven; this iteration builds the
layer that decides WHAT to comprehend.

## Root cause of the over-firing (iteration-08 proof runs: ~16 comprehension goals for a trivial new-util feature)

Two structural sources in the coverage policy table + the gate wiring:

1. **Whole-repo `architecture`+`stack` on every root split** (`coverage.ts`
   ROOT_SPLIT row). Any non-leaf make goal demanded the whole-repo maps
   unconditionally — no notion of "this intent is trivial / greenfield". A new
   isolated util triggered two whole-repo `map-repo` goals.
2. **Region dives for every UNIONED child scope** (`engine.ts` runCoverageGate).
   Every proposed make-leaf child's scope was unioned into the coverage goal,
   then a `deep-dive-region` miss was minted per uncovered scope entry — incl.
   regions a child was merely CREATING fresh. This was the ×10 dives of
   unrelated regions.

## The fix — relevance-bounded table (ADR-029 Decision 2)

Kept the deterministic, brain-free coverage table (ADR-021); made its DEMANDS
relevance-bounded by a new existence signal:

- `CoverageGoal.existsByRegion?: Record<string, boolean>` (pure data; absent ⇒
  treat-as-existing, so the whole pre-existing test corpus is byte-identical).
- **Greenfield root split:** a root split whose scope is non-empty and points
  ENTIRELY at new/untracked regions no longer pulls `architecture`+`stack`
  (`requiredCategories = []`). A scope-less whole-repo intent still does.
- **Region dives:** only EXISTING regions are dived; a region being created
  fresh is skipped.
- **Existence-filtered union (design fork, decided with the operator):** code-leaf
  make types are `leafOnly` → they go straight to `satisfy` and NEVER run their
  own coverage gate, so the PARENT is the only place their region dives can be
  pulled. So the child-scope union was KEPT (removing it wholesale would mean an
  existing-region feature never gets that region comprehended) but is now
  bounded by `existsByRegion`: union child scopes, dive only the EXISTING ones.
- Existence is an injectable seam on the knowledge wiring
  (`EngineOptions.knowledge.regionExists`), real `existsSync`-backed impl in
  `assembleKnowledgeWiring`, deterministic injection in tests. The engine keeps
  a private `regionExistsInTree` fallback for when the hook is absent.

## ADR-029 Decision 4 + robustness items

3. **`examples/live-foreign-eyes.ts` rewritten** to commission ONE real scoped
   intent against cats and let the split gate pull JIT comprehension, instead of
   speculatively commissioning four whole-repo `map-repo` categories. Asserts
   TWO things: the intent converges (no blockers) AND comprehension is scoped
   (map-repo + deep-dive count ≤ `COMPREHENSION_BUDGET`, default 6). Read-only:
   no prBoundary, so it cannot push or open a PR.
4. **`parseDecision` tolerates a childless split** (`src/brains/llm.ts`): a
   `{"kind":"split"}` with no/empty `children` now degrades to `satisfy` (handle
   as a leaf) instead of throwing → blocking the whole node. (iteration-08
   live:self failure mode.)
5. **Comprehension decide schema-constraint — VERIFIED ALREADY COVERED, no code.**
   There is exactly one decide path (`brain.decide`); it already passes
   `DECISION_SCHEMA` in json_schema mode and blocks-on-unparseable in the catch.
   The "conversational prose instead of a decision" mode the iteration-08 notes
   flagged is guarded for ALL decide calls, comprehension included. To be
   re-confirmed in the live proof run rather than re-coded.

## Tests + gate

- `tests/library/coverage.test.ts`: greenfield root split (no whole-repo demand),
  mixed/existing root split (still demands), new region (no dive), existing
  region (dive required), mixed dive, backward-compat (absent existsByRegion).
- `tests/brains/llm.test.ts`: childless split → satisfy; empty-children → satisfy.
- Two pre-existing tests updated to the new contract (NOT loosened): the
  convergence-eyes root-gate missing-set and the gates.test region-dive injection
  now turn on `regionExists` (the convergence fixture's `src/` really exists; the
  gates fake-repo injects existence). Both still assert the dive fires for an
  existing scoped region.
- `npm test`: **1403 passed, 21 skipped, lint clean.**

## Status at build — NOT YET PROVEN LIVE

The scoping fix is built, typechecked, and unit-proven. The AC-2 RE-PROOF is the
remaining step and is OPERATOR-RUN (needs OPENROUTER_API_KEY + GITHUB_TOKEN +
real spend, cannot run from the dev harness):

  - `live:self` on the trivial `formatDuration`-in-new-`src/util/` feature →
    expect a PR this time, with comprehension goal count near zero (was ~16).
  - `live:foreign-eyes` (rewritten) on cats → expect convergence + scoped
    comprehension (≤ 6).

Record the honest result here when run. Tune the `live:self` proving budget down
(currently 80/5M/600) once scoping is proven to reduce the goal count.

---

# AC-2 (live:foreign-eyes — cats comprehension checkpoint) — the proof arc

## AC-2 proof run #1 — live:foreign-eyes on cats (2026-06-23)

**SCOPING FIXED — but a budget/fan-out bug now blocks convergence.** This is the
bootstrap loop working: the factory got further (over-firing gone), then stalled
on the next limit down.

| Check | Result |
|---|---|
| Comprehension goals | **3** (2 map-repo + 1 deep-dive) — was ~16 |
| Scoping (≤ 6) | **PASS** ✓ |
| Convergence | **FAIL** — split structural validation |

Run nonce 551fd00a · cost $0.2212 · 92.8% cache-hit · intent = "add a doc comment
to the main entry-point file", scope `src/`.

**Why 3 and not ~0:** the intent scope `src/` EXISTS in cats and the feature
touches existing code, so the gate correctly pulls architecture + conventions
maps + one `src` dive. That is correct JIT comprehension, not over-firing — the
relevance bound is doing exactly its job. (The near-zero case is the
`formatDuration`-in-new-`src/util/` feature, where the scope is greenfield.)

**The new blocker (NOT a scoping bug — a pre-existing budget defect my fix
exposed by getting deeper into the tree):**

```
Split structural validation failed: Fan-out of 4 children exceeds parent
attempt budget of 1
Goal "Deep-dive region src" exhausted its toolCalls budget
Isomorphic failure detected (signature: step-loop:failed) — escalating to block
```

Root cause traced to its floor (not the gate, as first theorized):
`subdivide()` floors every child's attempts to `max(1, floor(parent.attempts ×
share))` (`budget.ts:15`). The root commissions `attempts: 5`; one level down a
~0.1–0.4 share floors attempts to **1**; from then on `validateSplit`'s fan-out
guard `children.length > budget.attempts` (`engine.ts:3265`) rejects ANY split
of ≥2 children at that depth. The failing "Fan-out of 4 > 1" is a FLOORED node
(the conventions-map's nested `characterize`, or a re-decided sub-node), not the
root. This is exactly the iteration-08 deferred defect ("subdivide floors child
attempts to 1 under depth", build-notes ~L845) — my scoping fix didn't cause it,
it REVEALED it by letting the tree recurse deeper than the over-firing runs ever
got.

This is an **ADR-007 issue.** ADR-007 chose `children.length ≤ attempts` as the
fan-out guard, but its real purpose was floor-affordability (don't let many
tiny-share children sum past the parent via the `Math.max(1,…)` floor), NOT
"decomposition is thrashing." `attempts` is the scarcest, fastest-flooring
dimension, so gating split WIDTH on it forbids legal decomposition at depth.
Each child runs on its OWN subdivided budget (`engine.ts:2819,2838`) — a parent
does not spend N attempts to fan out N children — so the coupling is wrong.
Fix (next hand-build): decouple the fan-out width guard from `attempts`; gate
width on floor-affordability in a dimension that funds work, preserving ADR-007's
"a fan-out cannot multiply costs past its root grant." Recorded as an ADR-007
amendment.

**A secondary real find:** the `deep-dive-region src` child exhausted its
toolCalls budget at depth — the same subdivide-floor family. Lower priority than
the fan-out guard.

**Decision:** AC-2 still RED on convergence (scoping PROVEN). Fix the
fan-out-vs-attempts coupling (ADR-007 amendment) before any deliver spend
(live:self). Scoping half of iteration 09 is proven; the budget half is the next
hand-build.

(Note: the harness reported exit 0 though the script prints FAILED and calls
`process.exit(1)` — the buffered stdout head was also lost. Cosmetic; the
substance above is from the script's own result summary.)

## Budget softening — ADR-030 (soft budgets until proven)

Operator directive after AC-2 proof run #1: *stop being hard with budgets and
bounds — they aren't based on anything real yet, and they're blocking the one
thing we need to prove (that the factory can build).* This is the same call the
codebase already made for `toolCalls` (warn-only since 2026-06-12), now
generalized.

ADR-030 changes (hand-built on main, the fixes that actually unblocked the live
run):
1. **Fan-out cap removed** — `validateSplit` no longer rejects `children.length
   > attempts` (and no longer takes a budget param). Width was keyed to the
   scarcest, fastest-flooring dimension; it forbade legal decomposition at depth.
2. **`subdivide` inherits `attempts`** instead of flooring to `max(1, floor(×
   share))` — each child keeps the full retry count at any depth.
   tokens/toolCalls/wallClock still subdivide for cost tracking.
3. **Kept hard:** dollar ceiling + wall-clock (real cost). **Kept as honest loop
   terminators (NOT softened this pass):** attempt/token exhaustion — a goal that
   burns its retries genuinely didn't converge → blocks → routes to the listener,
   which is real signal. Re-arm any of these the first time a trace shows it
   blocking legitimate work.

Tests: budget.test + gates.test block-behavior assertions REWRITTEN to the new
contract (wide splits accepted; deep nodes keep attempts; injection past the old
cap proceeds) rather than kept opt-in — per the operator's "delete the
block-behavior assertions, we don't believe in these bounds yet" call. Removed
dead code from the earlier existence-signal iteration (the engine's duplicate
`regionExistsInTree` + its fs imports; the wiring's `regionExists` hook is the
single source). 1403 green, lint clean.

**Next:** re-run `live:foreign-eyes` — the fan-out/floor blocker is gone, so the
scoped intent should now converge. Then `live:self` for the AC-3 PR proof.

## AC-2 proof run #2 (post-ADR-030) — WEDGED on an LLM transport hang (not a budget issue)

Re-ran `live:foreign-eyes` on cats after ADR-030 to retest convergence. The run
did NOT complete: it hung for ~37 minutes with **0% CPU, state sleeping, one
ESTABLISHED TCP socket to OpenRouter (:443 via Cloudflare), zero flushed output**.
Killed it (spending nothing, unrecoverable; in-memory event log died with it).

**Diagnosis (transport, NOT ADR-030):** `LlmBrain`'s fetch calls
(`src/brains/llm.ts:635` and `:961`) pass no `AbortController`/`signal` — there is
**no client-side request timeout.** The retry/backoff logic (incl. the explicit
`AbortError`/'timeout' handling at ~973) only fires when a request *fails*; a
request that *hangs* (server accepts the connection but never responds — exactly
what we saw) never throws, so it never retries. It waits forever. ADR-030's
wall-clock backstop didn't bite because the deadline is checked BETWEEN attempts,
not mid-`fetch` — the process was blocked inside one fetch that never returned.

This is consistent with the standing debug lesson (transport issues masquerade as
logic bugs; probe the wire). The budget softening is fine — this run never got far
enough to test convergence; it wedged on the network.

**Next hand-build (before any more live spend):** add a per-request timeout to
`LlmBrain` — wrap each fetch in an `AbortController` with a sane deadline
(injectable, like `sleepFn`), so a hung request aborts and routes through the
existing retry/backoff instead of blocking the whole run. THEN re-run
`live:foreign-eyes`. `live:self` stays deferred until AC-2 actually converges.

## AC-2 proof run #3 (post timeout fix) — no hang, recursion deeper than ever, now token-starved

Re-ran `live:foreign-eyes` on cats with BOTH ADR-030 (soft fan-out/attempts) and
the per-request timeout. Result: **the fixes worked, and the next bound bit.**

What worked (real progress):
- **No hang** — completed in minutes, $0.15 (timeout fix held).
- **Recursion went DEEPER than any prior run:** `deep-dive-region src` split into a
  nested `deep-dive-region src/utils`; `map-repo conventions` PASSED (✓) and spawned
  a `propose-pattern` child that also passed. ADR-029 recursion firing as designed.
- **Scoping held:** 4 comprehension goals (`✓ scoped ≤ 6`). No fan-out blocker.

The new blocker (the honest one we predicted):
```
Goal "Map repo: architecture" exhausted its tokens budget
Goal "Walking skeleton deep-dive on src/utils" exhausted its tokens budget
```
Convergence failed because two comprehension goals ran out of **tokens** — the
dimension ADR-030 deliberately LEFT as a hard block ("honest loop terminator").
Now a real trace shows it blocking LEGITIMATE work, which is ADR-030's own
re-arm/loosen trigger.

Root cause is the SAME flooring pathology we fixed for attempts, still present for
tokens: `subdivide` divides `tokens` by share, so a comprehension child gets a
FRACTION of the root grant, and a deeper child (`src/utils`) gets a
fraction-of-a-fraction → starves at depth. The root commissioned 2M tokens but
`map-repo architecture` only saw its share.

**Next hand-build:** stop subdividing tokens the way we stopped subdividing
attempts — tokens should be a tracked/reported soft signal bounded by the real $
ceiling, not a per-node hard wall that floors to nothing at depth. (Decide with
operator: inherit tokens like attempts, or keep proportional tracking but make
token exhaustion warn-only / not-blocking.) THEN re-run. Cost so far across 3 AC-2
runs: ~$0.59 total.

## AC-2 proof run #4 — toolCalls is the last divided dimension; recursion-depth smell appears

Re-ran with attempts+tokens inherited. No hang, no fan-out block, no token
starvation. Scoping held (6 goals, at the ≤6 boundary). Convergence still failed:
```
Goal "Map repository structure" exhausted its toolCalls budget
Goal "Map repo: conventions" exhausted its toolCalls budget
"What is the directory and file listing of the src directory? I need ... to plan the mapping."
```

Two findings:

1. **toolCalls flooring — the same pathology, third dimension.** `subdivide` still
   divides toolCalls by share, so deep comprehension children starve before they
   can even run a directory listing (one block is literally the brain asking for
   an `ls` of src it couldn't afford to run). attempts and tokens are inherited
   now; toolCalls is the last divided dimension. Fix: inherit toolCalls too (it is
   already warn-only via enforceToolCallBudget=false in production, but the live
   harness/sandbox path still hard-floors the subdivided count). Cost $0.09.

2. **Recursion-depth / redundancy smell (flag, don't chase blindly):** the tree is
   getting DEEPER and more redundant, not converging — a `map-repo` spawned a
   `deep-dive` that spawned ANOTHER `map-repo` ("Explore repository to discover
   architecture" → "Map repository structure"). Comprehension is re-deriving
   comprehension. Once toolCalls stops starving it, watch whether it converges or
   keeps splitting comprehension-into-comprehension. If the latter, the next real
   issue is comprehension's decide prompt (when to SATISFY vs keep splitting), not
   another budget knob.

Cost across 4 AC-2 runs: ~$0.68 total.

## Investigation between runs #4 and #5 — the decide path was deciding BLIND

Per operator direction, investigated the run-#4 recursion smell (a `map-repo`
splitting into a `deep-dive` that split into another `map-repo`) before spending
on run #5. Root cause found, and it is NOT a budget issue:

**The decide path injected no family skill and no split criterion.** When the
brain decides satisfy-vs-split, it received only a generic "you are a
decision-maker" system prompt + goal context + memories + the type catalog. The
"split only when the region is too large; partition into same-category
sub-regions" guidance lived ONLY in a code comment in `comprehend.ts` — never
sent to the model. And `loadFamilySkill` was wired into the produce (step-loop)
and judge paths but NOT the decide path. So the brain over-split comprehension
because nothing told it not to — the same disease as the original over-firing,
one layer in (we fixed how many comprehension goals get MINTED; this is how
readily each one SPLITS).

Fix (skill injection into decide, for ALL families — the principled seam, not a
comprehend special-case):
- `BrainContext.skill?` (contract) — optional family-skill guidance for the
  decide call.
- Engine `decideSkillBlock(goalType)` builds preamble+section (same shape the
  step path uses) and populates `baseCtx.skill` before `brain.decide`.
- `LlmBrain.decide` injects a `FAMILY SKILL` block into the decide message.
- `comprehend.md` gains explicit satisfy-vs-split guidance: DEFAULT TO SATISFY;
  split only a genuinely too-large region; children must be the SAME
  comprehension type, disjoint, covering the parent. (This preamble is what the
  decide call now sees.)

Now every family decides WITH its craft guidance, not blind. Tests: decide
injects ctx.skill / omits when absent; 1407 green, lint clean. Ready for run #5.

## AC-2 proof run #5 — BREAKTHROUGH: comprehension fully converges; only the implement leaf fails

The decide-skill fix worked. Tree:
```
✗ deliver-intent
  ✓ map-repo: architecture           ← PASSED
  ✓ map-repo: conventions            ← PASSED
  ✓ deep-dive-region: src            ← PASSED (the run-#4 nested map→dive→map cascade is GONE)
  ✓ map-repo: Identify the main entry-point file in src/   ← PASSED
  ✗ implement: Add doc comment block to entry-point file   ← the ONLY failure
```

**The entire comprehension layer converged** — 4 scoped goals, all passed, 3
knowledge artifacts written. No over-firing, no over-splitting, no starvation, no
hang. This is the comprehension half of the factory (everything iteration 09 was
about) working END-TO-END on a real foreign repo for the first time. We went from
"can't comprehend anything / drowns in 16 speculative goals" to "comprehends a
real repo cleanly in 4 scoped goals."

**Remaining failure (isolated, downstream of comprehension):** the `implement`
leaf explored but did not actually write the doc comment, so the integration eval
correctly failed ("No documentation comment block added to main entry-point
file") and the leaf burned its attempts. This is NOT comprehension, budget, or
transport — it's the deliver/implement leaf either (a) not making the edit, (b)
writing it outside declared scope / where the gate can't see it, or (c) emitting
without writing. Cost $0.69 (comprehension did real work this time).

**Next:** root-cause the implement leaf — read the deliver/implement harness +
the integration eval to see whether the brain wrote nothing, wrote out of scope,
or emitted-without-writing. This is the last gap between AC-2 and convergence.
Cost across 5 AC-2 runs: ~$1.37 total.

## AC-2 run #6 — TRACE PAID OFF: map-repo can't obtain the HEAD SHA, thrashes to token death

Persisted the event log (CORELLIA_EVENTS_PATH) + replayed via scripts/trace.ts.
The trace made the root cause unmistakable. `map-repo: architecture` spent **45
steps** almost entirely failing to obtain the HEAD SHA its artifact requires
(`generatedAtSha`):

- `run_script "git rev-parse HEAD"` → REFUSED (not in the declared script set).
- `read_file .git/HEAD` → ENOTDIR (the sandbox is a WORKTREE; `.git` is a FILE
  pointing to the real gitdir, not a directory).
- `.git/refs/heads/main`, `.git/worktrees`, the real gitdir → REFUSED (outside
  the sandbox root) or ENOTDIR.
- Dozens of duplicate-read refusals (F-64) as it retried the same dead paths.

It burned the full (now-inherited) 2M token budget thrashing against the sandbox
boundary, then emitted and hit `budget-exhausted: tokens`. (Run #5's architecture
map happened to succeed — this SHA-fetch is UNRELIABLE; sometimes the model gives
up and emits with a placeholder SHA, sometimes it thrashes to death. Run #5 even
showed `generatedAtSha=worktree`/`unknown` — placeholder SHAs, a related symptom.)

**Root cause (engine/tooling gap, NOT prompt):** the factory REQUIRES comprehension
artifacts to carry the current HEAD SHA, but gives the comprehension leaf NO
reliable, sanctioned way to read it — `git rev-parse` isn't declared, and the
worktree's `.git` indirection + sandbox scoping block every direct read. The
engine ALREADY computes `gitHeadSha(repoRoot)` for the coverage gate; it should
hand that SHA to the comprehension leaf (inject into goal spec/context) so the
brain never fetches it. Candidate: populate `spec.generatedAtSha` (or a context
field) for map-repo / deep-dive-region goals from the engine's gitHeadSha.

Also confirmed by trace: comprehension OVER-EXPLORES (45 steps, dozens of
list_dir/read_file) vs the skill's "4-6 representative reads" — partly downstream
of the SHA thrash, but the economy bound isn't being honored. Lower priority than
the SHA gap.

Cost run #6: $1.41 (the thrash is expensive). Cumulative across 6 runs: ~$2.78.

## AC-2 run #7 — head_sha works; remaining failures are BEHAVIORAL (over-explore / block-without-trying)

head_sha fixed the SHA thrash: `map-repo: architecture` PASSED with a real SHA
(9ed64ff7), and the dive called `head_sha → ran` cleanly — no more `.git`
flailing. That structural gap is closed. Cost $0.44.

But two NEW failure modes, both behavioral (the brain not following the skill),
surfaced via the trace:

1. **`map-repo: conventions` decided `block` immediately** — zero tool calls. It
   emitted a brief: "Cannot access the repo at <cats>. Please provide the root
   listing + package.json + a source file + a test file." The repo IS accessible
   (architecture mapped it fine in the same run). The brain gave up at the decide
   step and asked the HUMAN for files instead of using list_dir/read_file. This is
   the "comprehension decide emits a please-provide-files block instead of doing
   the work" mode (related to what iteration-08 notes flagged; the decide-skill
   injection did not prevent it here).

2. **`deep-dive-region src` exhausted wallClockMs** (a REAL backstop, not an
   arbitrary count) — it over-explored: dozens of read_file/list_dir on cats (a
   Python repo, src/cats/main.py), well past the skill's "4-6 representative
   reads, depth over breadth." Same over-exploration the run-#6 architecture map
   showed, now hitting wall-clock instead of (inherited) tokens.

These are NOT structural/budget/transport gaps — they're the comprehension brain
not honoring its own craft (use tools; bound exploration; don't block-and-ask).
Inflection point: the next lever is prompt/behavior discipline (and possibly
model tier), not another engine knob. Worth a step-back with the operator before
more spend. Cumulative across 7 runs: ~$3.22.

## AC-2 run #8 — PASSED. Full convergence on a real foreign repo. 🎉

The skill hardening worked, AT MID TIER (no model bump). Tree — every goal green:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions            ← used tools (no more block-and-ask)
  ✓ deep-dive-region: src            ← stayed under the read ceiling (no wall-clock death)
  ✓ map-repo: Identify the entry-point file
  ✓ implement: Add documentation comment block   ← THE IMPLEMENT LEAF RAN AND WROTE IT
```

`convergence: ✓ (no blockers)` · `AC-2 CHECKPOINT: PASSED` · $0.59 · 80% cache.

A scoped intent went END-TO-END on a real foreign repo for the first time:
comprehend (4 scoped goals, all passed, 3 artifacts written with real SHAs) →
identify target file → implement → integration eval passed. The implement leaf —
which had never succeeded — delivered once comprehension stopped starving it and
the behavioral fixes landed.

**AC-2 is PROVEN.** Iteration 09 (comprehension scoping, ADR-029 Dec 2+4) +
ADR-030 (soft budgets) + the transport timeout + decide-skill injection +
head_sha tool + comprehend behavior hardening together took the factory from
"drowns in 16 speculative comprehension goals, never converges" to "converges a
real scoped intent on a foreign repo." AC-2 was the blocker on AC-3/AC-4
(deliver-to-self / deliver-to-foreign); those are now unblocked.

Total live spend across 8 AC-2 runs this session: ~$3.81. Every run bought a
real fix (see the run-by-run sections above).

**Next:** AC-2 being green, `live:self` (AC-3: factory delivers to its OWN repo,
opens a real PR) is now approved to attempt.

---

# AC-3 (live:self — corellia delivers to its OWN repo) — the proof arc

## AC-3 run #1 — did NOT converge; block-without-trying recurred on the bigger repo

Commissioned the greenfield `formatDuration` util (src/util/, tests/util/) so
comprehension would be near-zero and the deliver+PR path was isolated. Result:
no PR; blocked. $0.17. Findings (saved for later — several are reusable beyond AC-3):

### FINDING 1 (safety, low-sev): strange-loop hygiene check has a FALSE POSITIVE
live:self printed "Primary clean after run: NO — investigate!" but the primary
checkout was CLEAN of factory changes — the only `git status` output was the
pre-existing untracked `media/video.zip` (present since session start). The
script's check treats ANY `git status` output (incl. pre-existing untracked
files) as "dirty". Risk: alarm fatigue masks a REAL disturbance. Fix later: the
check should compare against a baseline (pre-run `git status`) or ignore
untracked paths it didn't create, so "NO" means a genuine factory-caused change.
Branch stayed `main`; worktree was left uncollected (expected for a blocked, not
shipped, run — isolated under gitignored .corellia/worktrees/).

### FINDING 2 (behavioral, the real blocker): block-without-trying RECURRED at mid tier
`map-repo: architecture` `decided: block` with ZERO tool calls (trace confirms no
tool-call events), fabricating a justification: "I attempted to list the repo
root but received no output. Is the repo mounted?" It did NOT attempt list_dir —
it blocked at the decide step and invented a reason. This is the SAME mode the
run-#7 conventions failure showed and that comprehend.md hardening fixed on cats
(run #8). It recurred here on corellia — a LARGER, denser repo. So:
  - The prompt hardening reduced but did not ELIMINATE block-without-trying; it
    is model-judgment variance at `mid` tier, worse on a harder repo.
  - This is now real evidence for the deferred TIER BUMP: comprehension is the
    load-bearing family and blocks-without-trying under load. Candidate: default
    map-repo/deep-dive-region to `high` (was deferred in favor of testing the
    prompt alone — the prompt alone is insufficient on a dense repo).
  - Possible engine-side hardening: a comprehension goal that emits a `block`
    brief WITHOUT having made a single tool call is almost always
    block-without-effort — the engine could reject such a block (treat as "must
    try first") rather than letting it bounce. Worth considering vs. prompt-only.

### FINDING 3 (eval, medium): integration judged a comprehension artifact as the deliverable
Second blocker: "artifact contains only project conventions metadata instead of
deliverable code." With the architecture map blocked, the deliver leaf's
dependency failed; the integration eval still ran and judged a CONVENTIONS
artifact where the formatDuration module was expected. Two sub-issues to probe
later: (a) why did integration run / judge at all when a child dependency
blocked? (b) the merged/eval artifact was a knowledge artifact, not code — the
deliver assembly may be picking up the wrong child artifact when the code leaf
never produced one.

### Variance note
Run #8 (cats): all comprehension passed. AC-3 #1 (corellia): architecture
blocked. Same code, different repo + a fresh roll → different outcome. The
remaining failures are non-deterministic LLM behavior, not deterministic bugs.
The levers are tier + (optional) engine-side block-without-effort rejection.

Cumulative live spend this session (8 AC-2 + 1 AC-3): ~$3.98.

### ROOT CAUSE FOUND (not tier — operator was right to push): sandbox path contradiction

Traced via the persisted log (compared the PASSED conventions goal vs the BLOCKED
architecture goal — SAME repo, SAME run, SAME tier, so tier is definitively not
the differentiator). The conventions goal's first tool call:
```
tool-call: list_dir → ran
tool-call: list_dir → refused — list_dir: path "/Users/keith/dev/gauntlet/corellia" is outside the sandbox root
```
The brain's instinct is to list the `repoRoot` it was handed in the spec
(`/Users/keith/dev/gauntlet/corellia`) — but the file tools are bound to the
WORKTREE sandbox, which REFUSES that absolute path as "outside the sandbox root".
conventions happened to also issue a relative `list_dir` and recovered;
architecture tried the absolute path, got refused, and (weak-judgment path)
concluded "repo unreachable" and blocked with a fabricated "received no output".

So the "block-without-trying" was NOT model weakness — it was the engine handing
the brain an absolute repoRoot its own sandboxed tools forbid. A tier bump would
only improve the odds of the lucky relative-path guess; it would not remove the
contradiction. (This retro-explains the cats variance too: smaller repo, fewer
chances to fixate on the absolute path.)

**Fixes (both landed, 1411 green):**
1. (cause) Step harness now states the sandbox-path contract for in-sandbox goals:
   "your file tools operate on a sandboxed copy mounted at the sandbox root — use
   RELATIVE paths; the absolute repoRoot in the spec is reference-only and is NOT
   tool-readable; do not conclude the repo is missing if an absolute path is
   refused." (src/engine/engine.ts step harness.)
2. (backstop) A comprehend-family `block` at the top-level decide (before any tool
   runs) is coerced to `satisfy` — a comprehension goal cannot legitimately know
   it is blocked before probing the sandbox. Real blockers still surface from the
   attempt loop after actual tool use. Non-comprehend (deliver/build) blocks are
   untouched.

### FINDING 4 (tooling, low-sev): orphaned worktree from a blocked run pollutes vitest
The blocked AC-3 run left .corellia/worktrees/live-self-…/ uncollected (expected —
collection is keyed off a verified-shipped list). But vitest globbed its copy of
the test files and ran them twice. Torn down manually here. Fix later: either
collect/prune worktrees on a blocked run too, or add .corellia/worktrees to the
vitest exclude so leftover trees never pollute a local test run.

FINDING 1 (false-positive hygiene check) and the tier question remain open but
de-prioritized: tier was a red herring; the path contract was the real cause.

## AC-3 run #2 — sandbox-path fix WORKED; next layer is a conventions-pointer contract mismatch

The sandbox-path fix landed cleanly. Trace of `map-repo: conventions` (the goal
that blocked-without-trying in run #1) shows the fix working:
- ZERO "outside the sandbox root" refusals — every list_dir/read_file `→ ran`.
- `decided: satisfy` and actually probed the repo with relative paths.
- The fabricated "repo unreachable" block is GONE.

It now fails for a real, different reason — the deterministic gate:
```
deterministic: FAIL — knowledge:map-repo: Conventions exemplar pointer(s) not found: src/library/skills/
tier: mid → high
deterministic: FAIL — knowledge:map-repo: Conventions exemplar pointer(s) not found: src/contract
(exhausted attempts)
```

### FINDING 5 (contract mismatch + misleading error): conventions pointers at DIRECTORIES
`conventionsCheck` (knowledge-checks.ts:428-435) validates each exemplar pointer
with `readFile(join(root, pointer.path))` — i.e. it requires a readable FILE. The
brain pointed at DIRECTORIES (`src/library/skills/`, `src/contract`) — reasonable
"these dirs exemplify our conventions" pointers. `readFile` on a dir throws EISDIR
→ caught → reported as "not found". TWO problems:
  1. The error message is MISLEADING: the path is NOT missing, it's a directory.
     This is why the brain couldn't self-correct across mid→high attempts — it was
     told "not found" for a path it could see exists, so it thrashed and exhausted.
  2. Contract ambiguity: comprehend.md says "point at exemplar FILES", but the
     brain naturally points at dirs, and the gate only accepts files.

Design choice (for the operator) — which side is wrong?:
  (a) Gate too strict: accept a pointer whose path EXISTS (file OR directory) —
      use stat() not readFile(); a directory exemplar ("see src/contract/* for the
      type-definition conventions") is legitimate. Also fix the misleading message
      (distinguish missing vs directory). Most forgiving; matches what the brain
      produces.
  (b) Brain wrong: harden comprehend.md to point ONLY at specific files (e.g.
      src/contract/goal.ts:1), never directories — keep the gate file-strict but
      fix the message so a dir pointer says "must be a file, not a directory" so
      the brain can self-correct.
  (c) Both: accept existing paths (file or dir) AND fix the message AND nudge the
      skill toward files. Belt-and-suspenders.

### FINDING 3 recurs: integration eval judged the comprehension artifact as the deliverable
Same as run #1: "Artifact is architectural overview, not the requested utility
module." With conventions blocked, the deliver leaf's dependency failed, yet the
integration eval still ran and judged a knowledge artifact where code was
expected. Still worth probing: why does integration judge at all when a child
dependency blocked, and is it picking up the wrong child artifact?

Hygiene false-positive (FINDING 1) recurred (media/video.zip); primary actually
clean, branch main. Worktree live-self-3fa1e189 left uncollected (blocked run).
Cost run #2: $0.61. Cumulative this session: ~$5.20.

## AC-3 run #3 (correct model z-ai/glm-5.2 + engine fixes) — deepest yet: tests PASS, source leaf fails on scope gate + no declared scripts

With the model wiring fixed (high tier = z-ai/glm-5.2, not the silently-wrong
claude-sonnet-4) and the sandbox-path/block-coercion/conventions-pointer fixes in,
this is the furthest AC-3 has reached. Tree:
```
◌ deliver-intent (attempt 1)
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: Write comprehensive tests for formatDuration   ← a TEST leaf PASSED
  ◌ implement: Implement formatDuration utility function
✗ deliver-intent (retry)
  ✗ implement: ...test-first... exhausted attempts
```
Comprehension converged cleanly (no block-without-trying, no SHA thrash) and an
implement leaf delivered passing tests. Cost $2.13. No PR. Two gaps, both from the
trace:

### FINDING 6 (env gap): live:self declares NO scripts, so the brain can't self-verify
The intent says "keep typecheck, lint, and the full test suite green", and the
implement leaf correctly tried to run them — but live-self.ts passes
`declaredScripts: {}`, so every `run_script test|typecheck|lint` is REFUSED ("not
in the declared set"). The brain can't confirm its work is green, so it re-reads /
re-searches / retries to exhaustion. Same class as the head_sha gap: the factory
asks for verification it doesn't grant the tool for. Fix: declare corellia's own
scripts (test/typecheck/lint from package.json) in the live:self sandbox so a
self-build can verify itself.

### FINDING 7 — INVESTIGATED, NOT A BUG (corrected). Scope enforcement worked correctly.
Initially read as a scope/parse bug; the event log disproves it. `isInScope` is
correct (`src/util/format-duration.ts` ∈ `['src/util/']` → true, unit-confirmed).
The refused `write_file` to `src/util/format-duration.ts` came from the leaf scoped
`['tests/util/']` (the "write tests" leaf) — it over-reached and tried to write the
SOURCE file; the tool correctly refused it as out of scope (that leaf's in-scope
`tests/util/` writes succeeded; it passed). The "ts, ts" `files-within-scope`
failure was a DOWNSTREAM symptom: the separate source leaf, unable to self-verify
(finding 6), thrashed and emitted a malformed final artifact using markdown
language-tag fences (```ts) which `parseFileBlocks` read as path="ts". No
scope/parse fix needed — fixing finding 6 (let the leaf verify) removes the thrash
that produced the malformed artifact. (If language-tag fences recur after that,
harden parseFileBlocks then — but not before evidence shows it still bites.)

Model note: z-ai/glm-5.2 behaved well on the comprehension + decide paths — no
block-without-trying recurrence this run. The remaining failures are NOT model
quality; they're the two gaps above. Cumulative AC-3 spend: ~$5.0.

## AC-3 run #4 (declared scripts) — finding 6 FIXED; finding 7 is REAL after all (fence parser)

The declared-scripts fix worked: the implement leaf wrote the files AND verified
them — `run_script typecheck → exit 0`, `run_script lint → exit 0` (both green).
The code is correct. But at emit it STILL failed:
```
step 6: typecheck → 0
step 7: lint → 0          ← code written + verified green
step 8: artifact
deterministic: FAIL — files-within-scope: File(s) outside declared scope: typescript, typescript
```

So finding 7 IS a real, recurring bug (my run-#3 "not a bug" call was wrong — that
run's thrash masked it). The leaf emits its final artifact as markdown fences
tagged with the LANGUAGE (```ts last run, ```typescript this run), and
`parseFileBlocks` (llm.ts) reads the fence-line token as the file PATH → path
becomes "typescript"/"ts" → files-within-scope rejects it. It bites every time the
leaf emits fenced code with a language tag. The work is done and green; only the
artifact SERIALIZATION corrupts the path.

Fix: parseFileBlocks must not treat a bare language tag as a path (a path has a
'/' or a '.'); + the produce prompt should say the fence line is the full relative
path, never a language like ```ts. (This is the fix proposed at run #3 and
deferred — the evidence now justifies it.)

Incidental: this run's `npm test` output showed a PRE-EXISTING flaky test —
`tests/library/script-runner.test.ts > runs an npm-script:<name> entry` timed out
at 5s (the self-build ran the full suite as part of verifying). Separate finding;
not caused by this work. Bump its timeout or make it deterministic.

Cost $0.34. Cumulative AC-3 ~$5.3.

## Fixes for AC-3 run #4 findings (fence parsing + targeted test execution)

**Fence parsing (the real blocker — confirmed recurring).** The brain emits its
final artifact as language-tagged markdown fences (```ts, ```typescript); the
parser read that token as the file PATH. Fixed both sides:
- parseFileBlocks now only accepts a path-like fence token (has a '/' or '.'); a
  bare language tag is ignored, so a slip can't corrupt the artifact's path.
- The produce + repair prompts now state the fence line MUST be the full relative
  path, with a concrete example, never a language tag.
- Tests: language-tag fence → not a files artifact; path-like fence parsed even
  when a language-tag fence precedes it.

**Targeted test execution (operator directive: don't force the whole suite).**
run_script now takes an optional validated `target`:
- ScriptRunner.run(name, target?, timeLimitMs?) — the target is validated
  (relative in-repo path/pattern; no abs, no '..', no shell metacharacters) and
  appended to the operator-declared command (npm gets `-- <target>`), so the
  factory runs a subset in the project's OWN runner without any freeform-shell
  hole. The declared command fixes the runner (any language/paradigm); only the
  target is the model's input.
- run_script tool + loggingScriptRunner thread `target` through; build.md tells
  the brain to use run_script(test, target=...) for targeted runs and reserve the
  full `test` for final confirmation.
- Tests: validated target forwarded + echoed; invalid targets refused with no
  spawn; validateScriptTarget unit cases.

Note: the run-#4 trace also showed a pre-existing flaky test (script-runner
npm-script entry, 5s timeout) — it passed comfortably (511ms) after the
positional-arg fixes in this change; watch it but no action taken.

1418 tests green, lint clean. Next: re-run AC-3 — the code already builds + verifies
green; the artifact should now serialize with correct paths and open the PR.

## AC-3 run #5 — CONVERGED. The strange loop closes: corellia delivers a verified feature to itself. 🎉

Tree — every node green, ZERO blockers:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: format-duration test-first (src/util/format-duration.ts + tests/util/format-duration.test.ts)
```
`Blockers: none`. The factory built formatDuration, wrote its tests, verified them
green (typecheck/lint/targeted tests), and emitted a CLEAN artifact — the fence fix
worked, the deliver leaf converged. $0.25, 84% cache. **First end-to-end delivery
of a feature to corellia's own repo.** Strange-loop hygiene intact: worktree
COLLECTED + torn down (only happens on success), primary clean (the post-check's
"NO" is the pre-existing media/video.zip false-positive), branch still main.

This is the seven-run AC-3 arc paying off — each run bought one fix: soft budgets,
transport timeout, decide-skill, head_sha, sandbox-path truth, block-coercion,
conventions-pointer, the correct prescribed model (z-ai/glm-5.2 vs the silent
claude-sonnet-4), declared scripts, fence parsing, targeted tests.

### Remaining gap (NOT a bug): the deliver SUCCESS path doesn't push/open a PR
`No PR opened` — and the trace shows push_branch / open_pr were NEVER ATTEMPTED
(not refused). Per live-self.ts's own note, PR-opening is wired to the IMPROVEMENT
loop (fires on blockers), not the happy-path deliver. A deliver that converges with
no blockers collects the verified worktree but has no "now ship it" step. So AC-3's
build half is PROVEN; the literal "opens a PR" half needs the deliver success path
to push the collected branch + open_pr. Candidate: on a converged deliver with a
prBoundary configured, push the collected worktree branch and open one PR.

Cumulative AC-3 spend: ~$5.6.

## NEXT (recorded for a future iteration): multi-branch / multi-tree PARALLEL build + aggregation

Today the engine uses ONE shared worktree per tree (ADR-016): every leaf writes to
the same branch tree/<id>, collected together at root success → one branch → one
PR. Serial aggregation is trivially handled.

NOT yet built — genuinely-concurrent leaves in SEPARATE worktrees, folded back to a
single base branch the PR opens from (the kmaz-build-iteration pattern: concurrent
features each get a worktree, cherry-picked back onto the trunk). This needs real
engine concurrency: per-leaf worktrees, a cherry-pick/merge aggregation edge before
emit, and conflict handling. The split mechanism + dependency scheduler already
model "independent children run in parallel" (DESIGN.md), so the gap is the
execution substrate (one worktree → many) + the fold-back edge, not the planning.
This is the next major iteration after AC-3's ship step.

## AC-3 ship step — `open-pr` leaf (brain-driven, per operator choice)

deliver-intent is a non-leaf splitter with no code/PR grants, so shipping is its
own step. Added an `open-pr` leaf type (kind make, leafOnly, family deliver,
grants repo.branch + repo.pr). The deliver root spawns it LAST, dependsOn every
build child; its job is push_branch → open_pr (one PR, left open — the factory
never merges), recorded in deliver.md. Brain-orchestrated (keeps the tool model),
not an engine side-effect.

Aggregation today is trivial: ONE shared worktree per tree (ADR-016), so all
children land on one branch and open-pr pushes that single branch. (Multi-tree
parallel build + fold-back is the recorded next iteration.)

Tests: open-pr contract (make/leaf/deliver, repo.branch+repo.pr, no fs.write);
type count 19→20 across starter-types + skills-wiring. 1418+ green, lint clean.
Next: re-run live:self — expect the brain to spawn open-pr and actually open a PR.

## AC-3 run #6 — PROVEN. The factory builds AND SHIPS a feature to its own repo. 🎉

Tree all-green, zero blockers, and the ship step fired:
```
✓ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ implement: format-duration test-first and verify suite
  ✓ open-pr: Open PR for format-duration utility
```
Verified from the event log: push_branch → ran, open_pr → ran, pr-opened →
**https://github.com/kmazanec/corellia/pull/6** (branch tree/live-self-c88f1b01-…).
The deliver root spawned the new open-pr leaf, which pushed the collected branch
and opened ONE real PR, left open for human review. $0.39, 84.7% cache.

Strange-loop hygiene intact: worktree COLLECTED + torn down (success-only),
primary clean (post-check "NO" = the pre-existing media/video.zip false-positive),
branch still main. The factory operated on its own repo without disturbing the
primary checkout.

**AC-3 is PROVEN end-to-end: corellia comprehends its own codebase, builds a
feature test-first, verifies it green (typecheck/lint/targeted tests), and opens a
real PR — autonomously.** This was the named blocker on AC-3/AC-4 since iteration
06; AC-4 (deliver-to-foreign) is now unblocked.

Total AC-3 arc: 6 live runs, ~$6.0, each buying a real fix (soft budgets, transport
timeout, decide-skill, head_sha, sandbox-path truth, block-coercion,
conventions-pointer, correct prescribed model, declared scripts, fence parsing,
targeted tests, and the open-pr ship step). Every fix landed on main with tests.
