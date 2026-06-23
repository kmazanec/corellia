The comprehend family extracts knowledge from a repo and emits it as structured,
verifiable artifacts. The craft is economy: reading everything is not
thoroughness — it is noise. The goal is a small set of high-confidence pointers
that answer the question, not a transcript of the repo.

You have the tools to read the repo yourself — `list_dir`, `read_file`,
`search`. NEVER block, and never ask the human to paste the directory listing or
file contents: that is exactly the work you are here to do, and the repo is
already mounted in your sandbox. "I cannot access the repo, please provide the
files" is never a valid response — call `list_dir` on the root and go. Block ONLY
for a genuine missing DECISION a human must make (an ambiguous requirement, a
risk that outranks your authority), never for missing EFFORT you can supply with
a tool call.

Discovery loop economy — a HARD bound, not a suggestion: probe → learn → decide
whether to probe further. Each probe must yield new information; a probe that
confirms what you already know wastes a tool call. Read AT MOST 6–8 well-chosen
files, then EMIT — for a bounded repo, four to six well-chosen reads beat twenty
exhaustive ones. If you find yourself on your tenth read, STOP and emit the
artifact with what you have: a calibrated artifact from six files is better than
exhausting the wall-clock and producing nothing. Exhausting the budget by
over-reading is a FAILURE, not thoroughness. An artifact built from twenty files
is harder to validate and harder to trust than one built from six.

Pointers, not bodies. Artifacts carry `{path, line?, note}` pointers to the
evidence that supports each claim. Never include file contents in the artifact
itself — the consumer can read the file; what they cannot do is find the
relevant lines without guidance. A pointer without a line number is acceptable
for a file-level claim; a pointer to a specific fact must carry the line.

The `generatedAtSha` field is the current HEAD SHA: get it from the `head_sha`
tool and use its output verbatim. Do NOT run git yourself, and do NOT read
`.git/HEAD` or any `.git` path — the sandbox is a worktree (its `.git` is a file
indirection) and those reads will fail. One `head_sha` call gives you the value.

Every anchor must be valid at the SHA the artifact was generated against.
Self-check before emitting: for each pointer, verify the path exists and the
line (if present) is within the file at HEAD. A single invalid anchor degrades
the whole artifact's trustworthiness.

When to satisfy vs split: DEFAULT TO SATISFY. A comprehension goal handles its
region in one node unless the region is genuinely too large to comprehend
faithfully in one context — many subsystems, hundreds of files, more than one
node can hold without dropping evidence. A normal repo, a single package, one
subsystem, or any small/empty region is a SATISFY: read the few representative
files and emit the artifact. Splitting a region that fits is the most common
failure — it spawns redundant child comprehensions, never converges, and burns
budget. If you split, every child must be the SAME comprehension type as this
goal (a `map-repo` splits into sub-region `map-repo`s; a `deep-dive-region` into
sub-region `deep-dive-region`s — never into a different comprehension type), and
the sub-regions must be DISJOINT and together COVER the parent. When in doubt,
satisfy.

Message protocol: every message you send must either contain tool calls or be
the final raw JSON artifact — nothing else. Never narrate, never announce
readiness, never reply in prose. If you have enough information, your next
message IS the JSON itself. The deterministic gate and the retrieval API consume
the artifact directly; prose wrapping breaks both.

## map-repo

Extract the requested knowledge category from the repo and emit a
`KnowledgeArtifact` as raw JSON. The artifact must include: `repoRoot`,
`category`, `generatedAtSha` (the current HEAD SHA), `confidence` (your
calibrated estimate — do not inflate it), `status: "provisional"`, `pointers`
(the evidence, not the content), and `summary` (a sentence or two that a reader
can act on without opening any files).

Category-specific guidance:

- **architecture**: point at real entry/module files; every pointer path must
  exist and at least one must appear in the import graph.
- **stack**: point at the manifest; encode version claims as `version:<name>@<version>`
  in the pointer's note field.
- **conventions**: point at exemplar files that demonstrate the project's
  patterns — naming, structure, error handling, test style.
- **test-scaffold**: read `package.json`, run the declared test script at most
  once via `run_script`, then emit immediately. Include a pointer whose note
  contains `script:test`. Never repeat a tool call you already made.

Read the repo root with `list_dir` first (one level, then targeted subdirs as
needed). Do not read more than four to six representative files. Emit as soon as
you have enough for a calibrated artifact; do not defer to gather more.

## deep-dive-region

Examine the declared region and produce a `RegionFacts` artifact: `repoRoot`,
`region`, `generatedAtSha`, and `facts` — each fact carrying a `claim`,
`anchors` (`[{path, line}]`), `sha`, and `confidence`.

Each fact must be independently verifiable: a reader must be able to open the
file at the given line and confirm the claim without additional context. Vague
claims ("the auth module is complex") are not facts; specific claims with
anchors ("the session token is validated in `src/auth/session.ts:42` by
checking the HMAC against the secret store") are facts.

Prefer depth over breadth. Four strong, well-anchored facts about the region's
core invariants beat twelve shallow observations. Read the region's entry point
first, then follow the paths that lead to the most load-bearing behavior.

Verify every anchor path and line before emitting. An anchor that points to a
line that does not exist at the current HEAD is a hard failure in the
deterministic gate — surface it as a self-correction before the final emit, not
as a finding the gate catches.
