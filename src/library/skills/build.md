The build family turns a spec into a verifiable artifact. Three members, one
rhythm: work in chunks (build-and-test slices), each chunk ending in one
tickable item that names its impacted test targets. Within each chunk the
batched rhythm is: write → run once → fix all failures → run once. Aim for
roughly one to two test runs per chunk and one commit per chunk. Do not run the
suite after every individual edit; fix everything you know is broken, then run.

Run TARGETED tests, not the whole suite. The `run_script` tool takes an optional
`target` (a relative path or test pattern): `run_script(script="test",
target="tests/util/x.test.ts")` runs only that file in the project's own test
runner. Run the full `test` (no target) only as a final confirmation, not on
every iteration — the whole suite is slow in a large repo. Only declared script
names run; freeform shell commands (e.g. a bare `npx ...`) are refused — pass the
file via `target` instead.

Contract drift is a report, never a fork. When the artifact diverges from a
shared contract, surface the divergence as a blocker finding — do not silently
widen the contract to accommodate the implementation. The contract is the
authority; the implementation adapts.

Comments survive time. Write what the code cannot say — the invariant it
maintains, the tradeoff it embodies, the edge case it guards. Never transcribe
the code into prose. Run the timeless-comment grep before declaring done: if a
comment references a goal ID, an iteration name, or factory-internal language,
delete it.

## freeze-contract

Land every shared shape before any sibling fan-out. The diff must contain no
feature behavior — shapes, their exhaustive type-level consumers, and scoped
contract tests only. Run the scoped test suite to confirm; if any test exercises
feature logic, the diff is wrong.

Exhaustive consumers mean every case: if the shape is a discriminated union,
every branch is covered. A consumer that handles only the branches the current
feature needs is not exhaustive — it is a latent failure waiting for the next
sibling.

The barrier is a gate, not a guideline. A sibling that starts before the
contract is frozen will either duplicate the shape (two sources of truth) or
drift from it (silent incompatibility). Neither is recoverable cheaply.

## implement

Structure the work as build-and-test chunks. Each chunk names the files it
touches and the impacted test targets before you write a line. Within each
chunk: write all the changes, run the impacted tests once, fix all failures
you see, run once more. Commit when the chunk is green.

Read the spec before reading code. The spec is the authority; the existing code
is evidence of prior decisions, not a template. When the spec and the code
conflict, the spec wins — surface the conflict as a finding if the existing code
represents an intentional constraint the spec does not mention.

Scope is a hard boundary. Write no files outside the declared scope. If
satisfying the spec requires touching an out-of-scope file, surface a blocker
finding with the specific path and the reason; do not silently expand the diff.

## characterize

Write tests that pin current behavior, not intended behavior. Read the region
under test before writing a single assertion. Every test must run green against
the unmodified code; a test that fails on the untouched codebase is a bug in the
test, not a finding about the code.

Zero production-code diff. If characterizing the code requires understanding a
subtle interaction, capture it in a test comment — never in a production file.
The scope for this type is test directories only.

Coverage is fidelity, not mimicry. Capture the actual paths the code exercises,
including edge cases and error handling. A characterization that only covers the
happy path is not a baseline — it is a partial description that will fail to
catch regressions in the uncovered paths.
