// commissions/observability-live-tail.ts
// from docs/issues/observability-pluggable-tracing.md (Part 2 of that issue — the
// live-tail outcome). The issue carries TWO independent outcomes that don't share
// one integration: watching a run live, and exporting traces to a backend. Per the
// commission skill's "right-size the goal" rule that is a roadmap, so it is split
// into two slice-sized commissions; this is the first. The export outcome lives in
// commissions/observability-trace-export.ts.
//
// Authored as a GOAL-level requirements doc (the cardinal rule): it states what
// must be TRUE when done and the done-condition, and leaves every implementation
// choice — how the log is followed, how the tree is rendered, where the CLI entry
// lives — to the factory.

const doc = {
  commission: {
    id: 'observability-live-tail',
    title: 'Watch a run as it happens — a live view of the factory at work',
    spec: {
      description: [
        'Today there is no way to watch the factory while it runs. To see what an',
        'in-progress run is doing, an operator has to follow the raw event log file',
        'by hand and read it as unstructured lines; the structured, human-readable',
        'view the factory already knows how to produce only exists for a run that has',
        'already finished. So during the part that matters most — while the factory is',
        'working unattended — an operator is effectively flying blind.',
        '',
        'When this is done, an operator can watch a run AS IT HAPPENS from the command',
        'line: a single, discoverable command shows the run’s goal tree and per-goal',
        'activity in the same readable form available after a run, and it updates live',
        'as the run progresses — new work appearing as it is spawned and completed,',
        'without the operator re-running anything or parsing the raw log themselves.',
        'The same command, without the live option, still gives the readable view of a',
        'finished run (the capability that exists today is preserved, not lost).',
        '',
        'It works against the run wherever the factory actually records it — both a',
        'local run and the deployed daemon — using whatever the run is currently',
        'configured to write to, with no extra setup beyond pointing at that run.',
        '',
        'DONE-CONDITION (the acceptance bar): with a run in progress, invoking the',
        'live view shows that run’s goal tree and per-goal activity and visibly',
        'updates as new events occur — demonstrable on a real run — replacing the',
        'hand-followed raw log. The same command on a finished run reproduces the',
        'readable after-the-fact view that exists today.',
      ].join('\n'),
      constraints: [
        'Watching a run must never change what the run does or what it records: this is a read-only view over the factory’s existing record of the run. The record stays the single source of truth; the live view derives from it and never becomes a second one.',
        'The readable view of a finished run that exists today must continue to work unchanged — the live capability is additive, not a replacement that drops the existing behavior.',
        'The live view must work against the run wherever it is recorded, honoring whatever that run is configured to write to, so it serves both a local run and the deployed daemon without bespoke per-case wiring.',
        'All existing tests, typecheck, and lint stay green; the new behavior is covered by tests.',
        'Preserve code shape: small domain-named modules, thin orchestration, focused tests at the ownership boundary. Use `npm run code-shape -- <scope...>` as review evidence for the scopes touched.',
        'Open a PR when done.',
        // OKF close-out spelled out because the factory cannot yet author its own
        // iterations or manage its own issues. Housekeeping outcomes, not build steps.
        // NOTE: this commission only delivers HALF of docs/issues/observability-pluggable-tracing.md.
        // Do NOT delete that issue — instead, record that the live-tail outcome has shipped and
        // leave the issue open for the export-to-backend outcome (commissions/observability-trace-export.ts).
        'OKF close-out before finishing: author an iteration record under docs/iterations/ for this work and add it to the iterations index; append a dated one-line entry to docs/log.md noting the live-run view shipped; and update docs/issues/observability-pluggable-tracing.md to mark the live-tail outcome delivered while leaving the issue OPEN for the remaining export-to-backend outcome (do not delete the issue or its index row).',
        'No factory-internal/process language (build-plan references, "per the spec") in any shipped artifact.',
      ],
    },
    scope: [
      'scripts/',           // the operator-facing command surface
      'src/eventlog/',      // the readable-view rendering the live view reuses
      'tests/',             // the constraints demand test coverage; the tests live here
      'package.json',       // the command entry point
      'docs/issues/',       // OKF close-out: update the issue (leave open)
      'docs/iterations/',   // OKF close-out: author the iteration record + index row
      'docs/log.md',        // OKF close-out: append the dated ship line
    ],
    budget: {
      attempts: 4,
      tokens: 1_000_000,
      toolCalls: 500,
      // 40 min. The first run (2026-07-01) proved 15 min starves once the engine
      // subdivides wall-clock across comprehension + implement children (the first
      // characterize child was denied and cascade-blocked its siblings). Sized to
      // match the sibling export commission; the ceilingUsd stays the primary bound.
      wallClockMs: 2_400_000,
    },
    intent: 'production',
  },
  ceilingUsd: 8,
  repoRoot: '/Users/keith/dev/gauntlet/corellia',
  note:
    'Goal: an operator can watch a run live from the CLI — the run’s goal tree and ' +
    'per-goal activity in the readable form that today only exists for finished runs, ' +
    'updating as the run progresses — replacing the hand-followed raw log. First of two ' +
    'slices split out of docs/issues/observability-pluggable-tracing.md; the other is ' +
    'observability-trace-export.ts. Read-only over the existing run record; additive.',
} satisfies import('./README.js').CommissionDoc;

export default doc;
