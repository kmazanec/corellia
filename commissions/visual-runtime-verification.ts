// commissions/visual-runtime-verification.ts
// from docs/issues/visual-runtime-verification.md  (delete that issue once this lands as iteration + ADR + code)
//
// Re-authored as a GOAL-level requirements doc (the cardinal rule): it states what
// must be TRUE when done and the done-condition, and leaves every implementation
// choice — the contract shape, the capture mechanism, the judge wiring, the
// security enforcement — to the factory. The prior version of this artifact was an
// implementation plan (a 7-part "LOCKED DESIGN" naming files and functions); that
// is the factory's job, not the commission's.

const doc = {
  commission: {
    id: 'visual-runtime-verification',
    title: 'Verify what the script runner cannot — rendered output, a running UI, a live endpoint',
    spec: {
      description: [
        "Today the factory can only verify an acceptance criterion that a script can",
        'assert by exit code. It cannot judge things a script cannot reduce to a',
        'boolean: whether a produced document RENDERS correctly, whether a running UI',
        'SHOWS the right thing, or whether a live endpoint BEHAVES correctly when',
        'driven. These criteria silently go unverified.',
        '',
        'When this is done, the factory can verify such a criterion by capturing the',
        "actual runtime output — a rendered document, a screenshot of a running UI, or",
        "a driven endpoint's response — and judging that captured output against a",
        'stated criterion, with NO human eyeball required. All three kinds of runtime',
        'output are verifiable this way.',
        '',
        'Two properties must hold for this to be trustworthy:',
        '',
        '- The judgement of "does the captured output meet the criterion?" may be made',
        '  by a model, but there is still a deterministic, judge-independent pass/fail',
        '  floor: a criterion of this kind cannot pass unless the capture itself',
        '  actually succeeded and produced output. A criterion that names no real,',
        '  declared capture is rejected, the same way a vague prose rubric is today.',
        '',
        '- Capturing runtime output is at least as safely bounded as running a declared',
        '  script is today: it reaches only declared, local targets, runs with no',
        '  ambient secrets, is time-bounded, and the model never supplies a free-form',
        '  address, path, or command to capture — it only selects among captures that',
        '  were declared up front. This safety boundary is enforced by the factory’s',
        '  own machine-checked rules, not left to convention.',
        '',
        'DONE-CONDITION (the acceptance bar): a fixture demonstrates the rung',
        'end-to-end with no human looking. The fixture produces a document in which a',
        'value must appear in the correct place, and carries a criterion asserting',
        'that placement. With the fixture correct, the criterion PASSES; with a',
        'deliberately introduced defect that puts the value in the wrong place — the',
        'kind of error no unit test catches — the SAME criterion FAILS. The rung',
        'catches the defect automatically.',
      ].join('\n'),
      constraints: [
        'Preserve the existing deterministic verification floor: every acceptance criterion, including a runtime/visual one, must still yield a judge-independent pass/fail. The model judgement may gate passing but must never be the only thing standing between a broken capture and a "pass".',
        'A goal that uses none of the new runtime/visual verification must behave exactly as it does today — this is additive, not a change to existing verification.',
        'Capturing runtime output must be bounded by the same safety discipline as running a declared script: local/declared targets only, no ambient secrets, time-bounded, no model-supplied free-form addresses/paths/commands. Enforce it as a machine-checked rule, not prose.',
        'All existing tests, typecheck, and lint stay green; the new behavior is covered by tests, including the fixture’s pass-on-correct / fail-on-defect demonstration.',
        'Record the design decision as an architecture decision record, since this adds a new kind of verification and a new safety rule.',
        'Open a PR when done.',
        // OKF close-out spelled out because the factory cannot yet author its own
        // iterations or manage its own issues (issues factory-authors-iterations /
        // factory-manages-issues). These are housekeeping outcomes, not build steps.
        'OKF close-out before finishing: author an iteration record under docs/iterations/ for this work and add it to the iterations index; append a dated one-line entry to docs/log.md noting the rung shipped; and delete the now-implemented issue docs/issues/visual-runtime-verification.md, removing its row from the issues index.',
        'No factory-internal/process language (build-plan references, "per the spec") in any shipped artifact.',
      ],
    },
    scope: [
      'src/',
      'docs/adrs/',
      'docs/issues/',      // OKF close-out: remove the implemented issue + its index row
      'docs/iterations/',  // OKF close-out: author the iteration record + index row
      'docs/log.md',       // OKF close-out: append the dated ship line
      'fixtures/',         // the done-condition fixture
    ],
    budget: {
      attempts: 5,
      tokens: 2_000_000,
      toolCalls: 800,
      wallClockMs: 3_600_000, // 60 min — a large multi-leaf change spanning verification, safety, and a fixture
    },
    intent: 'production',
  },
  ceilingUsd: 40,
  repoRoot: '/Users/keith/dev/gauntlet/corellia',
  note: 'Goal: the factory can verify criteria a script runner cannot — rendered documents, a running UI, a live endpoint — by capturing runtime output and judging it, with a deterministic floor and the same safety bound as the script runner. Re-authored from an implementation-spec into a goal-level requirements doc: it states the outcome and the fixture-first done-condition and leaves the how (contract shape, capture mechanism, judge, enforcement) to the factory. The factory’s only verification rung is the declared script runner; this is the gap-audit’s starred biggest gap.',
} satisfies import('./README.js').CommissionDoc;

export default doc;
