---
type: iteration
title: "Iteration 10 — AC-4: deliver-to-foreign (cats)"
description: With AC-3 proven, deliver a correct, verified feature to a repo the factory did NOT write (cats) and open a clean PR — proven across 9 runs, each buying one real engine/harness fix.
tags: [iteration, ac-4, deliver-foreign, cats, gitlab-mirror, make-scripts, venv-worktree, coverage-carve-out, forced-emit, scoped-split]
timestamp: 2026-06-24
status: proven-live
---

# Iteration 10 — AC-4: deliver-to-foreign (cats). Harness/engine readiness findings.

**Date:** 2026-06-24 · **Status:** Proven live (AC-4 fully proven — clean PR, runs #1–#9)

With AC-3 proven, AC-4 (the PRD's second Desired-Outcome half — a feature ships on
a repo the factory did NOT write) is unblocked. Target: **cats**
(`/Users/keith/dev/gauntlet/cats`). Before any live run, reading `examples/live-foreign.ts`
against the proven `live:self` harness and inspecting the cats repo surfaced FOUR
load-bearing readiness gaps. Recording them here (bootstrap loop: record the stuck
point before hand-building) — these are real engine/harness fixes, not config tweaks.

**FINDING A — the PR boundary is GitHub-only; cats' `origin` is GitLab.** cats'
`origin` remote is `ssh://git@labs.gauntletai.com:22022/keithmazanec/cats.git` — a
self-hosted **GitLab** instance (confirmed: `/api/v4/version` → 401, `sign_in`
redirect). `deriveRepoSlug`/`extractRepoSlug` only match `github.com` URLs → return
`null` for cats' origin, so `live:foreign` exits at the slug-derivation guard before
doing anything. And `open_pr` POSTs to `api.github.com` regardless. *Unblock:* cats
also has a **`github` mirror remote** → `git@github.com:kmazanec/cats.git` (Keith's
own repo, push access). AC-4 opens a real PR against that GitHub mirror — the
supported path. The harness must derive the slug from the `github` remote, not
`origin`.

**FINDING B — `push_branch` hard-codes `remote = 'origin'`** (`pr-tools.ts`). For
cats the PR-target remote is `github`, not `origin` (origin is GitLab). Pushing to
origin would push to the wrong host. *Fix:* thread an optional `remote` through
`prBoundary` → `pushBranchTool` (default `'origin'`, preserving every existing
caller); the harness sets it to `github` for cats.

**FINDING C — `deriveRepoSlug` reads only `origin`.** Add an optional remote-name
param (default `origin`) so the harness can read the slug from cats' `github`
remote. (`getOriginUrl` inside `push_branch` similarly assumes origin, but it is
only used for the process-clean diff label + the `branch-pushed` event's `remote`
field; the actual push target is the new `remote` param. Left as-is for now —
not load-bearing for the push itself.)

**FINDING D — the declared-script scheme is Node/npm-only; it cannot express a
Python verify command.** `createScriptRunner` accepts exactly two declared-entry
forms: `npm-script:<name>` (→ `npm run <name>`) or a repo-relative **node** script
file (run with `process.execPath`). cats has no `package.json`; its checks are
`uv run pytest` / `uv run ruff check .` / `uv run mypy` (via a Makefile with
`test`/`lint`/`typecheck` targets). Neither declared form fits — so the cats deliver
leaf would have NO way to verify its own work, which is exactly the AC-3 failure
mode (finding 6: "let the leaf verify"). This violates the PRD's stated
"stack-agnostic via repo scripts" requirement. *Fix:* add a third declared-entry
form — **`make:<target>`** — that spawns `make <target>` (+ the validated model
`target` appended), keeping the operator-fixes-the-command / model-supplies-only-the-
target security invariant and staying stack-agnostic (any repo with a Makefile).
cats declares `test → make:test`, `lint → make:lint`, `typecheck → make:typecheck`.

Plan: implement B+C+D (small, tested engine changes), rewrite `live:foreign` to use
the github mirror + cats' make-scripts + AC-3-style budget headroom, gate green,
then run the first live AC-4 proof — expecting, like the AC-3 arc, that each run
buys one more real fix.

## AC-4 run #1 — comprehension SCOPED + green; implement leaf starved by a non-verifiable env. 3 findings.

First live deliver to cats (`format_usd` helper). Intent id `live-foreign-7db58678`,
$1.075, 91.7% cache. Tree:
```
✗ deliver-intent
  ✓ map-repo: architecture
  ✓ map-repo: conventions
  ✓ deep-dive-region: src/cats/agents/common
  ✓ deep-dive-region: tests/unit
  ✗ implement: format_usd  (exhausted tokens budget — never wrote/pushed)
```

**What the readiness fixes PROVED (all green):** github-mirror slug derivation
(`kmazanec/cats` from the `github` remote — the origin-only path would have died at
startup); scoped comprehension held on a foreign repo — the coverage gate minted
exactly 2 `deep-dive-region` goals bounded to the two touched dirs
(`src/cats/agents/common`, `tests/unit`), NOT speculative whole-repo maps
(iteration-09 scoping carries to foreign repos); the `make:` declared-script form
spawned `make` for real (23 `script-ran` events).

**Why the implement leaf failed:** it burned its whole token budget thrashing
(130 read_file, 8 write_file, 46 run_script, 23 make invocations) and never reached
push/PR. Token shape is the tell: 6.8M prompt / 57K completion at 91.7% cache — lots
of looping, almost no production. Root cause from the event log's `run_script` reason
text — THREE compounding findings, each a real fix this run buys:

**FINDING 1 (deepest) — a fresh worktree's `.venv` lacks the test/dev deps, so the
verify command can NEVER go green.** Every `make test` failed identically:
```
uv run pytest
Creating virtual environment at: .venv
Installed 80 packages in 98ms
error: Failed to spawn: `pytest`
  Caused by: No such file or directory (os error 2)
make: *** [test] Error 2
```
The factory's worktree is a SEPARATE checkout (`.corellia/worktrees/…`) without
cats' synced `.venv`. `uv run pytest` auto-creates a venv with the RUNTIME deps
only — cats' `pytest`/`ruff`/`mypy` live in `[project.optional-dependencies]`, which
a plain `uv run` does not install. cats' Makefile assumes the dev env is already
synced (`make sync` / `make dev` bootstrap). In a fresh worktree it is not, so
`pytest` isn't on PATH → exit 2 every time. This is the AC-4 analogue of AC-3's
"let the leaf verify" (finding 6), one layer deeper: the verify command must be
RUNNABLE in the sandbox worktree — a per-stack bootstrap (`uv sync --all-extras`)
must run before the first verify, or the leaf is structurally unable to self-verify
and will thrash to budget exhaustion. *Candidate fixes:* (a) declare the verify
command to include the sync, e.g. `make:dev-test` where a target does
`uv sync --all-extras && uv run pytest`; or (b) the engine pre-syncs a worktree once
on creation via an operator-declared bootstrap command. (b) is the general,
stack-agnostic fix (npm repos need `npm ci` in a fresh worktree too — corellia's
own self-build dodged this only because it shares one worktree per tree and node
resolves from the repo root).

**FINDING 2 — declared the wrong test target; `make test` needs a DB and can't go
green here anyway.** Even WITH deps, `make test` = `uv run pytest` runs the FULL
suite, whose integration tests need Postgres+Redis (`make dev` = `compose-up +
migrate`) — 90 ERRORs, exit 1, regardless of the leaf's code. The DB-free target is
`make test-unit` (`uv run pytest tests/unit` → 848 passed, exit 0 at baseline, once
deps are synced). The harness should declare `test → make:test-unit` (and ALSO
declare `test-unit`, since the leaf correctly tried it — "Script test-unit is not in
the declared set"). General lesson: the declared verify target must be the
narrowest one that is green at baseline in the sandbox (no external services).

**FINDING 3 — `make:<target>` cannot forward the model's `target`; it appends it as
a second make GOAL.** `make test tests/unit/test_format_usd.py` ran `uv run pytest`
(whole suite, target IGNORED) and then tried to build `tests/unit/...` as a second
goal. npm's `--` forwards the target into the runner; make has no equivalent —
positional args become goals, not recipe args. So the AC-3 targeting win (run ONE
file) silently does not work through `make:`. *Candidate:* either drop target-append
for the `make:` form (document it as whole-target-only) or support a make-variable
convention (`make <target> TARGET=<path>` and recipes that read `$(TARGET)`); the
former is simpler and honest. Note: my unit test for `make:` target-forwarding
masked this — it added a catch-all `%:` rule to absorb the extra goal, which cats'
real Makefile does not have. The test should assert the realistic behavior.

**Hygiene:** worktree was PRESERVED (not collected) — correct, since the deliver
failed (collection is success-only). cats' primary checkout left clean. The
improvement loop is disabled for this run (no standing envelope), but the report
correctly routed the 3 blockers to an improve commission id (would have fired with
an envelope). No PR — as expected, the leaf never reached the open-pr step.

Net: the AC-4 harness path is sound end-to-end UP TO verify; the gap is that the
sandbox worktree is not a verifiable environment for a fresh Python checkout. Fix
the worktree-bootstrap (finding 1) + declared target (finding 2) and re-run.

### Fixes for run #1 (worktree .venv link + DB-free test target)

- **worktree.ts:** `openTreeWorktree` now symlinks the repo root's `.venv` into a
  fresh worktree, exactly as it already did `node_modules` (generalized to a small
  loop). Verified directly: a cats worktree with the symlinked `.venv` runs
  `uv run pytest tests/unit` → 848 passed, exit 0. This is the general,
  stack-agnostic shape (per-stack dep dir shared from the root), not a cats special
  case. Test added.
- **live-foreign.ts:** declared `test → make:test-unit` (+ a `test-unit` entry)
  instead of `make:test`, so verify hits the DB-free unit suite that is green at
  baseline. typecheck/lint unchanged.
- **make: target honesty:** split the masking unit test into the catch-all and
  no-catch-all cases — `make:` targeting is whole-target-only (finding 3),
  documented, not relied upon.

## AC-4 run #2 — new failure, caught instantly: decide-root split rejected for a missing budgetShare. 1 fix.

Re-ran. This time it failed at the FIRST decide call (9 events, $0, 0 tokens — never
spawned a child), with a DIFFERENT blocker:
```
Decision-maker could not produce a valid decision:
  split child "impl-helper" missing numeric "budgetShare"
```
The deliver-intent root's `decide` proposed a real split (children `impl-helper`,
etc., each with valid localId/type/title), but one child omitted `budgetShare`.
`parseDecision`/`normalizeChild` THREW on the missing number → the decide-fallback
blocked the whole root. This is the SAME lesson as the iteration-08 empty-children
softening, one field deeper, and exactly the `parseDecision`-strictness item
STATUS.md flagged as next. The run #1 fixes (`.venv` link, test-unit) are correct
but never got exercised — the root blocked before any worktree work.

**Fix (brains/llm.ts):** `budgetShare` has a natural default like the list fields —
a child with a valid localId/type but no share is TERSE, not malformed. `normalizeChild`
now marks a missing/non-positive share as NaN instead of throwing; `parseDecision`
fills NaN shares via `fillBudgetShares` (mean of the present shares; even `1/n` if
none). `localId`/`type` remain required (a child missing those is still rejected at
the seam — that test still holds). The engine already renormalizes shares to sum ≤ 1
downstream, so any positive number is safe. Tests: omitted-share filled from the
mean; all-omitted → even split. 1430 green, lint clean. Re-run.

## AC-4 run #3 — budgetShare fix worked; now blocked on the REAL iteration-09 gap: the gate demands a whole-repo map for a tiny brownfield add. (DECISION NEEDED)

$0.40, 77.8% cache. The decide root now split cleanly into `implement` (0.75) +
`open-pr` (0.25) — the budgetShare fix is proven. But the implement child's coverage
gate then minted comprehension that could not finish:
```
gate-checked missing: [architecture, conventions,
  architecture:src/cats/agents/common, architecture:tests/unit, ...]
→ map-repo: architecture   ✗ EXHAUSTED wallClockMs (70 tool-calls, mid→high escalate)
  map-repo: conventions    ✗ (50 calls)
  deep-dive-region: src/cats/agents/common  ✓
  deep-dive-region: tests/unit              ✗
Isomorphic failure (signature: step-loop:failed) ×2 → block
"format_usd helper not present in artifact" (never implemented)
```

**Root cause — the unsolved core of iteration-09 (ADR-029 Dec 2), now exposed on a
big repo.** The coverage gate (`src/library/coverage.ts`) requires a code-emitting
leaf to have `architecture + conventions` (WHOLE-REPO maps) PLUS region dives. The
ADR-029 Dec-2 refinement only SKIPS the whole-repo maps when the scope is entirely
NEW (greenfield: every `existsByRegion` false). cats' scope
(`src/cats/agents/common/`, `tests/unit/`) is two EXISTING dirs — a brownfield add —
so the carve-out does not apply and the gate demands the whole-repo
`architecture`/`conventions` maps. Mapping cats' 259-file architecture cannot finish
in its subdivided wall-clock slice (1.8M / 14 ≈ 2.1 min), so `map-repo: architecture`
times out. (Run #1 happened to mint ONLY region dives — the gate/brain shape is
non-deterministic; run #3 over-fired with the whole-repo maps.)

Two distinct sub-problems, EITHER of which unblocks AC-4:
1. **The gate over-demands.** A pure helper added to an existing dir should need a
   region dive of THAT dir, not a whole-repo architecture/conventions map (DESIGN.md
   JIT rule: "a region no goal touches is never mapped"). The Dec-2 carve-out should
   extend from "greenfield only" to "a SCOPED brownfield add whose touched regions
   are all dived needs no whole-repo map" — i.e. region dives SUFFICE for a
   tightly-scoped feature; whole-repo maps are for whole-repo / unscoped intents.
2. **When demanded, the whole-repo map didn't recurse.** `map-repo: architecture`
   chose `satisfy` (one leaf) over splitting into sub-region maps, so it tried to fit
   259 files into one budget and timed out. The recursion mechanism exists (iter-08,
   not leafOnly) but the brain didn't invoke it; the decide prompt / split criterion
   for a too-large map needs to actually fire on a big repo.

This is the locked coverage policy (ADR-021/ADR-029), so it is a DESIGN decision, not
a reflexive patch — surfacing to the operator before changing it. The AC-4 HARNESS is
otherwise proven sound: github-mirror PR path, scoped region dives, `.venv` worktree
link, DB-free test target, and the decide-split all work; the one remaining blocker is
this comprehension-scope policy.

Hygiene each run: worktree PRESERVED on failure, cats primary clean, no PR. Orphaned
worktrees from prior foreign-eyes sessions are accumulating under cats'
`.corellia/worktrees` and `.claude/worktrees` — unrelated debt to sweep separately.

### Fixes for run #3 (coverage carve-out + map-repo recursion)

ADR-029 Decision 2 amended (see the ADR): a code-emitting leaf with non-empty scope
pulls region dives of its touched regions ONLY, no whole-repo architecture/conventions
map; scope-less leaves still pull whole-repo maps; characterize unchanged. Implemented
as `isScopedCodeLeaf` in `coverage.ts`. Companion: `comprehend.md` sharpened so a
whole-repo `map-repo` over a many-subsystem repo splits up front. 1434 green.

## AC-4 run #4 — tree went green + a PR opened, BUT the PR is SPURIOUS. AC-4 NOT yet proven. 3 ordering/correctness bugs.

The carve-out worked: the implement leaf pulled ONLY the 2 region dives (no whole-repo
maps), comprehension was fast, the helper was written and `make:test-unit` passed
green. The tree printed all-green and `open-pr` reported a PR:
**https://github.com/kmazanec/cats/pull/1** — and for a moment this looked like AC-4
proven. **It is not.** Inspecting the PR:
- The PR diff contains TWO unrelated files (`docker-compose.yml`,
  `docker-compose.prod.yml`) — NOT `format_usd`. The helper is **not on the branch**.
- The factory's work is real but **UNCOMMITTED**: `format_usd.py`,
  `test_format_usd.py`, and the `__init__.py` edit sit in the worktree as `??`/`M`,
  never committed, never pushed.

Three distinct bugs, traced from the event log + the live worktree:

**BUG A (critical — ordering).** `open-pr` is a tree leaf that runs INSIDE `_run`,
so it pushes the branch and opens the PR BEFORE the engine's root-emission step
commits the work. `collectTree` (which commits the worktree diff) only runs in the
post-`_run` `finally`, and ONLY on success. So at the moment `open_pr` pushed, the
feature was not committed — the branch carried only whatever was already committed at
branch-cut. The PR is opened against work that does not exist yet. `open-pr` must run
only AFTER the work is committed (collect must precede push/PR, not follow it).

**BUG B (the `.venv` scope leak — what actually blocked this run).** The root-emission
`diffWithinScope` saw the `.venv` SYMLINK I added in run #1 as a changed path outside
declared scope → downgraded the would-be success to
`Scope insufficiency: ... .venv` → `preserveTree` (no commit) instead of
`collectTree`. So even the happy path could not commit. The worktree must EXCLUDE
`.venv`/`node_modules` from git (like it already excludes `.corellia/worktrees` via
`.git/info/exclude`) so the dependency symlinks never enter the tree diff.

**BUG C (base divergence — why the PR shows compose files).** The tree branch was cut
from cats' LOCAL HEAD (`9ed64ff`), which is 2 infra commits AHEAD of the GitHub mirror's
`main` (local-only `fix(infra): ...compose...` commits). `open_pr`'s diff is branch vs
github `main`, so it shows those 2 pre-existing commits. The branch should be cut from
(or the PR diffed against) the REMOTE PR-base tip, not whatever the local checkout
happens to be ahead by. (Lower priority than A/B but it pollutes any foreign PR whose
local checkout is ahead of its push remote.)

Also: `branch-pushed` fired ~16× (open-pr retried the push repeatedly) — a symptom of
A, worth a look once A is fixed.

Honest status: the AC-4 PIPELINE runs end-to-end (scoped comprehension, write,
green verify, push, PR-open all fire) but the DELIVERABLE is wrong — the PR neither
contains the feature nor excludes unrelated work. Fix B (unblocks commit), then A
(commit-before-PR ordering), then C (remote-base branch), and re-run. The spurious
cats PR #1 must be closed.

### Fixes for run #4 bugs A + B (open-pr commits the work; .venv excluded)

- **Bug B (worktree.ts):** `.venv` joins `node_modules` in two places — the
  `.git/info/exclude` written at worktree creation (so `collectTree`'s
  `git add --all` never stages the symlink) AND the `diffWithinScope` drop-filter
  (so the scope check never flags it). `ensureGitignored` now writes a list
  (`EXCLUDE_PATTERNS`). Tests: a non-gitignored `.venv` symlink no longer trips
  the scope diff.
- **Bug A (pr-tools.ts):** `push_branch` now commits the worktree's uncommitted
  work onto the branch HEAD (`commitWorktreeWork`: `git add --all` respecting the
  exclude, then commit if dirty) BEFORE the process-clean gate + push. So the
  branch — and the PR — carry the feature even though `collectTree` runs only
  after the open-pr leaf. `collectTree`'s later commit is a no-op (nothing staged).
  Test: an uncommitted worktree file is committed + appears on the pushed branch.

1436 green, lint clean.

**Bug C (remote-base divergence) — still open, environmental this run.** cats' LOCAL
main was 2 infra commits ahead of the GitHub MIRROR's main (pushed to the GitLab
origin, never to the mirror), so the tree branch — cut from local HEAD — carried
those 2 commits into the PR diff. The principled factory fix is to cut the tree
branch from (or diff the PR against) the PUSH REMOTE's base tip, not whatever the
local checkout is ahead by; recorded as a follow-up. For the immediate re-run, the
mirror is synced so local main == github main and the branch point is clean.

## AC-4 run #5 — Bugs A/B did NOT recur; blocked one layer earlier on comprehend over-explore (a deep-dive of a 4-FILE region exhausts attempts without ever emitting). New single blocker.

$1.01, 73.9% cache, 1436 tests green at launch. Pre-run prep done: cats GitHub
mirror synced (pushed the 2 local infra commits so local main == github main ==
`9ed64ff`, removing Bug C's environmental divergence), spurious PR #1 resolved
(it auto-marked MERGED when the sync made its branch tip an ancestor of main — it
carries no feature code; mirror has no `format_usd`, open-PR list empty).

**The run-#4 fixes held.** No spurious PR, no `.venv` scope leak, no
commit-before-push failure — the run never reached push/PR because comprehension
blocked first. So Bugs A and B are not refuted; they simply weren't exercised.

**New, single blocker — comprehend over-explore on a TINY region.** The deliver
root split cleanly (`judge-split` PASS → `split (2 children)`: dive
`src/cats/agents/common`, dive `tests/unit`, then implement + open-pr). The
scoped-brownfield carve-out (run #3 fix) worked: it pulled ONLY the 2 region
dives, no whole-repo architecture/conventions map. The `tests/unit` dive emitted
fine (✓). But the `src/cats/agents/common` dive — a region of **4 files / 49
LOC** (`__init__.py`, `cost.py`, 2 `.pyc`) — `decided: satisfy` correctly, then
ran **49 tool-calls across 6+ steps** (head_sha, list_dir, read_file ×N,
find_symbol ×N, search, read_file …) in a read-loop, **never emitted a knowledge
artifact, never reached a verdict**, and exhausted its `attempts` budget →
BLOCKED. With the dependency dead, `implement` was skipped, `format_usd` was
never written, and `judge-integration` FAILed ("No format_usd helper… present").

This is the **comprehend over-explore / never-emit** failure — the same class
STATUS.md flagged ("comprehend.md hardened with a 6–8 read ceiling then emit")
but it is clearly still not firing reliably: a 49-LOC directory cannot need 49
tool-calls, and the sibling `tests/unit` dive emitted on the first pass, so the
behavior is non-deterministic per region. Root cause is NOT region size (run #3's
problem) and NOT the coverage gate (run #3's carve-out is working) — it is the
comprehend leaf's step loop not converging to an emit on a small region.

Candidate fixes (to investigate before patching):
1. **Hard emit-forcing ceiling in the engine, not just the skill prose.** The
   6–8 read ceiling lives in `comprehend.md` (advisory); the leaf ignored it for
   49 calls. A structural cap — after N read-class tool-calls with no emit, the
   step loop forces the emit/synthesize step (or fails fast with a useful signal)
   — would make this deterministic regardless of what the model decides. Touch
   points: the comprehend step loop in `src/engine/engine.ts`, the family harness
   in `src/library/types/comprehend.ts` / `comprehend.md`.
2. **Tie the read ceiling to region size.** A 4-file region should get a tiny
   read budget; the ceiling could scale to `min(files, cap)` so a small region
   is forced to emit almost immediately.

**Store-pollution note (not a product bug, but it muddies reports):** the run's
report listed ~30 blockers, but only the last 4 (`improve-live-foreign-e77649c8`)
are from THIS run; the rest (`improve-live-self-*`, `format-duration`,
`ADR-029…`) are from PRIOR runs persisted in the shared store (`buildStore()`
honors `CORELLIA_EVENTS_PATH`/`DATABASE_URL`, and `out/events.jsonl` is appended
across runs). The blocker list and the trace tree both mix runs. For a clean
single-run signal, point the harness at a fresh events path per run (or filter
the report to the current `intentId`). The trace above was read by `--goal`
filtering to this run's region ids.

Hygiene: worktree PRESERVED on failure
(`.corellia/worktrees/live-foreign-e77649c8-5641f798`), cats primary clean, no PR.
Orphaned foreign-eyes/live-foreign worktrees continue to accumulate under cats'
`.corellia/worktrees` — unrelated debt to sweep. Next: fix the comprehend
over-explore (candidate 1 — a structural emit-forcing cap) and re-run #6.

### Fix for run #5 (structural comprehend read ceiling)

`runStepLoop` (src/engine/engine.ts) now counts read-class tool-calls for the
comprehend family ONLY and, once they cross a hard ceiling (16, well above the
6–8 comprehend.md asks), appends a "stop reading, emit now" instruction so the
step produces the exploration-complete artifact (two-phase emit then yields the
final structured artifact). A forced-emit step that still returns tool-calls
fails the attempt fast with a useful signal instead of read-looping to
attempt-exhaustion. deliver/implement leaves untouched. Tests: a read-looping
comprehend leaf is forced to emit at the ceiling; a 25-read implement leaf is
NOT cut off. 1438 green, lint clean. (commit `3d8b1c3`)

## AC-4 run #6 — read-ceiling fix WORKS (comprehension now emits); exposed the real next layer: the gate mints a whole-repo `architecture` map for a SCOPED feature, and a 16-read map of a 259-file repo emits an artifact that FAILS anchor validation.

$0.54, 54.6% cache, fresh event log (`out/ac4-run6.jsonl`, `CORELLIA_EVENTS_PATH`
per-run — clean single-run signal, no prior-run blocker bleed). 1438 green at
launch.

**The fix did its job.** Run #5's pathology (a small dive read-loops to
attempt-exhaustion emitting NOTHING) is GONE. This run, `Map repo: stack` ✓
emitted and passed, and `Map repo: architecture` reached `step 7/8: artifact` on
EVERY attempt — the read ceiling forced the two-phase emit after ~16 reads. So
comprehension now reliably produces an artifact.

**Two distinct things changed/surfaced:**

1. **The brain split into WHOLE-REPO maps, not scoped region dives (run #3
   sub-problem #1, still unfixed — and the dominant blocker now).** The deliver
   root's `decide` chose `split (3 children)` with `map-architecture` +
   `map-stack` + implement children directly; `gate-checked: missing
   [architecture, stack]`. The run-#3 `isScopedCodeLeaf` carve-out (region dives
   only, no whole-repo map) is on the *implement leaf's* coverage gate — but here
   the ROOT's own split minted the whole-repo maps as siblings before the implement
   leaf's gate ran, so the carve-out never got a say. This is the non-determinism
   the run-#3 note called out: the brain's split shape, not just the gate, decides
   whether whole-repo maps appear. For a tightly-scoped helper, a whole-repo
   architecture map is exactly the speculative comprehension DESIGN's JIT rule
   forbids. **This is the real fix needed** (see below).

2. **A 16-read whole-repo map of a 259-file repo emits an INVALID artifact.** The
   forced emit fires after ~16 reads, but that is too little to map a 259-file
   architecture faithfully: the emitted artifact's claimed pointers
   (`src/cats/messaging/envelopes.py`, …) FAILED the deterministic anchor gate
   (`knowledge:map-repo: No claimed architecture pointer matches any node in the
   fresh scan`) — the model named plausible files it hadn't actually confirmed.
   Each attempt: ~7 read steps → forced emit → gate FAIL → re-attempt → attempts
   exhausted. So the flat ceiling of 16 is right for a bounded region dive but
   wrong for a `map-repo` over a large repo: a whole-repo map must either (a) NOT
   be minted for a scoped feature (fix #1), or (b) SPLIT into sub-region maps so
   each child maps a bounded slice within its own read ceiling (run #3
   sub-problem #2, the recursion that didn't fire), or (c) scale the read ceiling
   with map breadth. (a) is the principled fix; (b)/(c) only matter for genuinely
   whole-repo intents.

**Conclusion — the next fix is #1, not a ceiling tweak.** The comprehend
emit-forcing is now sound. The remaining AC-4 blocker is that a scoped brownfield
helper is still pulling whole-repo `architecture`/`stack` maps it does not need.
The fix must ensure a tightly-scoped deliver intent's split pulls region dives of
the touched regions only — extending the run-#3 carve-out from the implement
leaf's gate to the ROOT's split decision (or making the split decide-prompt mint
region dives, not whole-repo maps, when the intent scope is narrow). Touch points:
the split/coverage interaction in `src/engine/engine.ts` (~2638 gate, the split
eval), `src/library/coverage.ts` (`isScopedCodeLeaf`), and the deliver decide
prompt that proposes the children. Then re-run #7.

Hygiene: worktree PRESERVED on failure
(`.corellia/worktrees/live-foreign-e1002e6f-*`), cats primary clean, no PR.

### Fixes for run #6 (a + b: scoped-split carve-out + repo-size signal)

- **(a) coverage.ts `isScopedRootSplit`:** a root split with non-empty scope is
  bounded to its touched regions — region dives only, no whole-repo
  architecture/stack map; the region-dive check no longer skips root splits. A
  scope-less root split still pulls whole-repo maps. ADR-029 amended (part 2).
- **(b) repo-size signal:** new optional `BrainContext.repoShape`; the engine
  (`repoShapeHint`) computes a cheap top-level-dir/file count for a SCOPE-LESS
  `map-repo` and injects it into the decide call so the skill's "8+ subsystems →
  split" rule fires on real data. Tests for both. 1440 green, lint clean.
  (commit `d689858`)

## AC-4 run #7 — (a) PROVEN: no whole-repo maps, scoped dives only, cost 5× lower. New blocker isolated to the comprehend forced-emit being too brittle (one dive blocked → implement skipped). Refined the backstop.

$0.10 (was $0.54 in #6 — 5× cheaper), 71% cache, fresh log
(`out/ac4-run7.jsonl`). The (a) carve-out is **proven**: `gate-checked: missing
[architecture:src/cats/agents/common, architecture:tests/unit]` — ONLY region
dives, NO whole-repo architecture/stack maps. The root split is clean (2 dives +
implement + open-pr) and `dive-src-cats-agents-common` ✓ passed. This is exactly
the DESIGN JIT behavior the iteration wanted.

**New blocker — the forced-emit backstop was too brittle.** `dive-tests-unit`
made 32 read-class calls (so the read ceiling fired across 2 attempts), but the
run-#5 implementation only NUDGED the model ("stop reading, emit now") and, when
the model returned tool-calls anyway, returned `kind:'failed'`. TWO such failures
tripped the isomorphic-failure detector (`signature: step-loop:failed`) → the dive
BLOCKED. With that dependency dead, the implement leaf was SKIPPED, and the
integration judge saw a fallback artifact (`with_cost`, not `format_usd`) → FAIL.
So the `with_cost` "wrong function" was a symptom of the skipped implement, not a
real mis-implementation.

**Fix (engine.ts):** the forced emit now DRIVES the emit directly instead of
nudging-and-hoping. At the ceiling it appends the stop-reading instruction, sets
`outputSchema` on a one-shot emit call, and uses that call's artifact — guaranteeing
a bounded dive converges to an artifact from what it has already read. Only if the
model ignores even the forced emit does the attempt fail (once, with carried
transcript so the retry starts already-read), so a single transient miss no longer
cascades into an isomorphic block. The flag is consumed per attempt (no force loop).
Test updated (the forced-emit path now sets the schema). 1440 green, lint clean.

Hygiene: worktree PRESERVED on failure
(`.corellia/worktrees/live-foreign-34add5c5-*`), cats primary clean, no PR.
Next: re-run #8 — the dive should now converge, implement should run, and the
pipeline should reach the PR.

## AC-4 run #8 — FULL TREE GREEN, real PR opened, feature is CORRECT. AC-4 essentially proven; one cosmetic regression (the `.venv` symlink leaked into the PR).

$0.18, 76.8% cache. The whole tree converged:
```
✓ deliver-intent
  ✓ deep-dive-region src/cats/agents/common
  ✓ deep-dive-region tests/unit          ← the forced-emit refinement fixed #7's block
  ✓ implement format_usd helper + tests  ← ran (no longer skipped) and verified green
  ✓ open-pr
```
**PR opened: https://github.com/kmazanec/cats/pull/2** · zero blockers · factory
did NOT merge it. **The deliverable is CORRECT** (verified by reading the PR
diff, per run #4's lesson that green-tree ≠ proof): `src/cats/agents/common/
currency.py` defines `format_usd(cents: int) -> str` exactly as specified —
docstring, doctests, negative handling — plus `tests/unit/test_format_usd.py`
with 52 lines of real cases (zero, single-digit, exact-dollar, dollars+cents,
negative). The feature is real, committed on the branch, and the run-#4 Bug A/B
ordering fixes held (commit-before-push worked).

**One regression — the `.venv` SYMLINK leaked into the PR diff** (3 changed files:
the 2 real ones + a `.venv` mode-120000 symlink). Bug B (run #4) added `.venv` to
`.git/info/exclude` as `.venv/` (trailing slash). But a gitignore pattern ending
in `/` matches DIRECTORIES ONLY, and the lifecycle creates `.venv` as a SYMLINK,
not a dir — so `git add --all` staged it. The `diffWithinScope` drop-filter has
its own `DEP_LINKS` list that correctly handled the symlink (so the scope check
passed and the tree went green), but the EXCLUDE pattern did not, so it got
committed. Cosmetic (the helper is still correct) but it pollutes the PR.

**Fix (worktree.ts):** `EXCLUDE_PATTERNS` drop the trailing slash —
`'node_modules'`, `'.venv'` — so the bare name matches both a directory and a
symlink. Regression test added: a `.venv` symlink in a worktree is NOT in the
committed tree after `collectTree` (asserted via `git ls-tree` on the branch).
1441 green, lint + typecheck clean.

Net: **AC-4 is proven — corellia delivered a correct, verified feature to a
foreign repo and opened a real PR autonomously.** PR #2 carries the spurious
`.venv`; close it and re-run #9 for a clean PR that proves the exclude fix.

Hygiene: tree COLLECTED on success (worktree removed), cats primary clean.

## AC-4 run #9 — CLEAN PR. AC-4 fully proven, exclude fix confirmed. ✅

$0.13, 71.7% cache, zero blockers, full tree green.
**PR opened: https://github.com/kmazanec/cats/pull/3** · factory did NOT merge it.

The exclude fix is confirmed: the PR diff carries EXACTLY 3 correct files and **no
`.venv`**:
- `src/cats/agents/common/format_usd.py` — `format_usd(cents: int) -> str`
- `tests/unit/test_format_usd.py` — real cases (positive, zero, negative,
  exact-dollar, one-cent, negative-one-cent)
- `src/cats/agents/common/__init__.py` — exports `format_usd` AND preserves the
  existing `with_cost` export (it correctly read the existing module via the dive)

This is the complete AC-4 deliverable: a FOREIGN repo, a CORRECT verified feature,
a CLEAN PR, factory did not merge it, $0.13. PR #2 (spurious `.venv`) was closed
and its branch deleted.

**AC-4 took runs #1–#9, each buying one real engine/harness fix** (worktree
`.venv` link + DB-free test target, budgetShare tolerance, scoped-leaf carve-out,
commit-before-push + .venv-in-diff, comprehend read-ceiling forced-emit,
scoped-ROOT-split carve-out + repo-size signal, forced-emit drives the artifact,
and finally the bare-name exclude pattern). The strange-loop bootstrap worked as
designed: every stall was recorded, hand-fixed the Corellia way, and re-proven
through `live:foreign`.
