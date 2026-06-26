// commissions/visual-runtime-verification.ts
// from docs/issues/visual-runtime-verification.md  (delete that issue once this lands as iteration + ADR + code)
//
// Design was interrogated interactively with the operator before this artifact was
// authored; the decisions below are LOCKED and carried into the spec so the build
// does not re-litigate them. See the conversation / the eventual ADR for the why.

const doc = {
  commission: {
    id: 'visual-runtime-verification',
    title: 'Visual/runtime verification rung — verify what npm test cannot (UI, live HTTP, rendered PDF)',
    spec: {
      description: [
        'Add a visual/runtime verification rung to the milestone loop so a goal can',
        "verify a visual or behavioral acceptance criterion that the script runner cannot —",
        'rendering a produced document, screenshotting a running UI, or driving a live',
        'endpoint — with a vision/text judge gating on the captured output and NO human',
        'eyeball required.',
        '',
        'LOCKED DESIGN (do not re-decide):',
        '',
        '1. NEW THIRD AcceptanceCheck VARIANT in src/library/acceptance-criteria.ts:',
        "   `{ runtime: { kind, ...declared capture, criterion } }`, discriminated on `kind`:",
        '     - kind:"screenshot" — start the declared server, navigate a DECLARED path,',
        '       screenshot it to a PNG, judge with a VISION judge against `criterion`.',
        '     - kind:"http" — drive a DECLARED endpoint, capture the request/response',
        '       transcript (TEXT, not pixels), judge with a TEXT judge against `criterion`.',
        '     - kind:"render" — rasterize a DECLARED produced file (PDF/HTML/SVG) to a PNG,',
        '       judge with a VISION judge against `criterion`.',
        '   The variant is named `runtime` (not `visual`) precisely because the http case',
        '   yields text, not an image. Extend the existing AcceptanceCheck union and its',
        '   parser/type-guards; add the `runtime` case to `criterionToCheck` and to',
        '   `criteriaWellFormed`.',
        '',
        '2. ADR-032 DETERMINISTIC FLOOR IS PRESERVED. The deterministic boolean for a',
        '   `runtime` criterion is "did the declared capture succeed and produce bytes?" —',
        '   that stays in the floor, exactly like a {script} check. ONLY the final',
        '   judgement is the LLM. `criteriaWellFormed` must ACCEPT a well-formed `runtime`',
        '   check as a runnable predicate (it names a declared capture, not a prose rubric',
        '   line). A `runtime` check whose capture is not declared/deterministic is REJECTED',
        '   by the floor, same as a prose rubric line is today.',
        '',
        '3. CAPTURE ENGINE — a NEW modality-pluggable capture module under src/library/.',
        '   Build all THREE modalities now: Playwright headless (chromium) drives the',
        '   screenshot and http modalities; a document rasterizer (PDF/HTML/SVG -> PNG)',
        '   drives the render modality. The capture interface MUST be modality-pluggable so',
        '   a11y / visual-diff / responsive-viewport capture kinds can be added LATER with',
        '   NO schema change to AcceptanceCheck (several of those will be deterministic',
        '   {script} checks, not new modalities — design for that).',
        '',
        '4. NEW judge-visual GOAL/LEAF TYPE (kind:"judge", leafOnly) in the goal-type',
        '   registry. It takes the captured image-OR-transcript plus the `criterion` and',
        '   returns a pass/fail verdict. It is SEPARATE from judge-acceptance (different',
        '   input shape and model capability). The milestone-loop ship gate becomes:',
        '   every deterministic criterion passes AND judge-acceptance == pass AND',
        '   (only when a `runtime` criterion exists) judge-visual == pass. judge-visual',
        '   needs its own per-family skill file under src/library/skills/.',
        '',
        '5. SECURITY BOUNDARY IS CONSTITUTION-LEVEL. The capture step inherits run_script',
        "   discipline (see src/library/script-runner.ts): localhost-only, DECLARED",
        '   endpoints/paths/files only, scrubbed env, wall-clock bounded, NO model-authored',
        '   URLs and NO shell. The model selects WHICH declared capture to run; it never',
        '   supplies a free URL, arbitrary file path, or shell text. Add the enforcing rule',
        '   to src/library/constitution.ts so it is machine-checked, not just prose. Wire',
        '   the capture tool into the broker dispatch table (src/engine/broker.ts) the same',
        '   brokered way run_script is wired in src/engine/assembly.ts.',
        '',
        '6. PROOF (fixture-first). Build a small fixture under fixtures/ — a tiny app that',
        '   renders a form to a PDF via a named AcroForm field map, with a DELIBERATELY',
        '   transposable field (this is the gap-audit’s starred 1040 case: a transposed',
        '   field silently puts money on the wrong line, and no unit test catches it).',
        '   Demonstrate the rung END-TO-END: a render-kind runtime criterion ("the AGI',
        '   value appears on line 11, not line 12"); with the field correctly mapped the',
        '   rung PASSES, and with the transposition injected the rung FAILS — with no human',
        '   eyeball. That fixture + its passing/failing demonstration is the acceptance bar.',
        '',
        '7. Write a new ADR documenting this design (new contract type + new goal type +',
        '   new constitution rule). It companions ADR-031/032.',
      ].join('\n'),
      constraints: [
        'Preserve the ADR-032 deterministic floor: every acceptance criterion, including a `runtime` one, must still yield a deterministic judge-independent boolean (here: capture-succeeded). Do not let the floor depend on the vision/text judge.',
        'The new capture surface MUST inherit run_script security discipline: localhost-only, declared endpoints/paths/files only, scrubbed env, wall-clock bounded, no shell, no model-authored URLs/paths. Enforce it in src/library/constitution.ts, not just in prose.',
        'The AcceptanceCheck `runtime` variant must be modality-pluggable: adding a11y/visual-diff/responsive capture kinds later must require NO change to the AcceptanceCheck schema.',
        'judge-visual is a SEPARATE leaf type from judge-acceptance; do not overload judge-acceptance with image input.',
        'Add the judge-visual ship-gate term ONLY when a `runtime` criterion exists; a goal with no runtime criteria must behave exactly as today.',
        'Run the deterministic gate (typecheck, lint, the full test suite) green before finishing. Add tests for: the new AcceptanceCheck parse/well-formedness, criterionToCheck mapping, each capture modality, the judge-visual gate wiring, and the fixture pass/fail demonstration.',
        'Write a new ADR under docs/adrs/ for the design; companion ADR-031/032. Give it the next ADR number and add it to docs/adrs/index.md.',
        // The factory cannot yet author its own iterations or manage its own issues
        // (see issues factory-authors-iterations / factory-manages-issues), so the OKF
        // close-out discipline is SPELLED OUT here. Every step maps to a real leaf
        // building block: read_file + write_file (create/overwrite) + delete_file
        // (the delete tool added alongside this commission, so issue removal is now a
        // first-class capability, not a hand step).
        'OKF close-out — the build MUST perform all of the following before finishing, using read_file + write_file + delete_file (follow it literally; the factory does not infer this):',
        '  (a) AUTHOR a new iteration record with write_file: create docs/iterations/<YYYY-MM-DD-HH-slug>/index.md (date-prefix from the build’s start; slug "visual-runtime-verification"). Mirror an existing iteration index.md (frontmatter: type:iteration, title, description, tags, timestamp, status; then overview + folded build notes). Then read docs/iterations/index.md and write_file it back with this iteration’s row appended (newest last).',
        '  (b) APPEND to docs/log.md: read_file it, then write_file the full content back with a new one-line dated bullet (under the current-date heading, creating the heading if absent) noting the visual/runtime verification rung shipped (render/screenshot/http + judge-visual), linking the new iteration and ADR.',
        '  (c) DELETE the implemented issue: an OKF issue is ephemeral, destroyed once it becomes code + an ADR + an iteration. Use delete_file on docs/issues/visual-runtime-verification.md, and read docs/issues/index.md then write_file it back with the visual-runtime-verification row REMOVED from the "High severity" table.',
        'Open a PR when done.',
        'Stay strictly inside the declared scope; no factory-internal/process language (build-plan refs, "per the spec") inside any shipped artifact.',
      ],
    },
    scope: [
      'src/',
      'docs/adrs/',
      'docs/issues/',      // OKF close-out: delete_file the implemented issue + update the issues index
      'docs/iterations/',  // OKF close-out: author the iteration record + update the iterations index
      'docs/log.md',       // OKF close-out: append the dated ship line
      'fixtures/',
    ],
    budget: {
      attempts: 5,
      tokens: 2_000_000,
      toolCalls: 800,
      wallClockMs: 3_600_000, // 60 min — a large multi-leaf engine change with a new runtime dependency
    },
    intent: 'production',
  },
  ceilingUsd: 40,
  repoRoot: '/Users/keith/dev/gauntlet/corellia',
  note: 'The factory’s only verification rung is the declared script runner; it cannot render, screenshot, or drive a running server and judge the result — the gap-audit’s starred biggest gap. This adds a visual/runtime rung (render/screenshot/http) gated by a vision/text judge, preserving the ADR-032 deterministic floor. Design interrogated and locked with the operator before authoring; proof is fixture-first (the transposable-1040 case). The build also owns the OKF close-out (delete the issue, author the iteration record, append docs/log.md) — spelled out in constraints because the factory cannot yet author its own iterations/manage its own issues.',
} satisfies import('./README.js').CommissionDoc;

export default doc;
