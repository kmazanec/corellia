// commissions/observability-trace-export.ts
// from docs/issues/observability-pluggable-tracing.md (Part 1 of that issue — the
// export-to-backend outcome). Second of two slices split out of that issue per the
// commission skill's "right-size the goal" rule; the live-tail outcome is in
// commissions/observability-live-tail.ts.
//
// Authored as a GOAL-level requirements doc (the cardinal rule): it states what
// must be TRUE when done and the done-condition, and leaves every implementation
// choice — the export mechanism, which backend is wired first, how the activity is
// mapped onto a trace — to the factory.

const doc = {
  commission: {
    id: 'observability-trace-export',
    title: 'Send the factory’s activity to an external observability tool',
    spec: {
      description: [
        'The factory’s record of its own work — every decision, tool use, judgement,',
        'spend, and block, arranged as a tree of goals and sub-goals — lives only',
        'inside the factory. There is no way to send that activity to an external',
        'observability or tracing tool, so an operator running the deployed factory',
        'cannot watch or analyze it in the dashboards they already use, and cannot',
        'compare runs, alert on them, or keep history outside the factory.',
        '',
        'When this is done, an operator can have the factory’s activity appear in an',
        'external observability tool as a faithful trace: the run shows up as a tree',
        'whose shape matches the factory’s own tree of goals and sub-goals, with the',
        'decisions, tool uses, and judgements as steps within it, and the cost of the',
        'work carried alongside. A run that blocked or failed is visibly marked as',
        'such in the external tool. Exporting is OPT-IN — turned on by configuration —',
        'and when it is off the factory behaves exactly as it does today.',
        '',
        'The way the factory’s activity maps onto an external trace is general, not',
        'wedded to one vendor: the first concrete destination works end-to-end, and at',
        'least one additional destination is shown to be reachable through the same',
        'mapping (its translation specified) so the design is demonstrably not a',
        'one-off.',
        '',
        'DONE-CONDITION (the acceptance bar): with export enabled and pointed at the',
        'first supported destination, a run produces a trace there whose tree matches',
        'the factory’s own goal tree, with steps and costs, and a blocked run is',
        'marked as failed. With export disabled, the run is byte-for-byte unaffected.',
        'A second destination is proven reachable via the same mapping (implemented or',
        'its mapping specified and exercised against the shared mapping), so the',
        'export path is shown to be general across at least two tools.',
      ].join('\n'),
      constraints: [
        'Exporting must never compromise the factory’s durability or correctness: it reads the factory’s record of its activity and sends it onward, but a failure, slowness, or outage in the external tool must not break, stall, or alter a run. If export fails, the run still completes and the factory’s own record is unaffected.',
        'The factory’s own record of its activity stays the single source of truth; the external trace is a derived copy, never something the factory reads back or depends on.',
        'Export is opt-in via configuration. With it disabled, behavior is identical to today — additive, off by default.',
        'Keep the factory’s core free of any external-tool-specific dependency: anything specific to a given observability tool stays isolated in an optional, separately-enabled part that the core does not depend on.',
        'The mapping from factory activity to an external trace must be general enough to serve more than one tool — proven by a second destination being reachable through the same mapping, not a parallel bespoke path.',
        'All existing tests, typecheck, and lint stay green; the new behavior is covered by tests, including that an export failure does not affect a run and that the produced trace tree matches the factory’s goal tree.',
        'Preserve code shape: small domain-named modules, thin orchestration, focused tests at the ownership boundary. Use `npm run code-shape -- <scope...>` as review evidence for the scopes touched.',
        'Record the design decision as an architecture decision record, since this adds a new outward integration seam and an opt-in configuration surface.',
        'Open a PR when done.',
        // OKF close-out. This commission delivers the SECOND half of the issue. If the
        // live-tail outcome has already shipped, this run completes the issue and should
        // delete it; if not, it leaves the issue open for that remaining outcome. The
        // factory should check the issue's current state rather than assume.
        'OKF close-out before finishing: author an iteration record under docs/iterations/ for this work and add it to the iterations index; append a dated one-line entry to docs/log.md noting the trace-export outcome shipped; and reconcile docs/issues/observability-pluggable-tracing.md — if the live-run-view outcome is already delivered, this completes the issue: delete it and remove its index row; otherwise mark the export outcome delivered and leave the issue open for the remaining outcome.',
        'No factory-internal/process language (build-plan references, "per the spec") in any shipped artifact.',
      ],
    },
    scope: [
      'src/',               // the export seam, the activity->trace mapping, optional adapters
      'docs/adrs/',         // the design decision record
      'docs/issues/',       // OKF close-out: reconcile/close the issue
      'docs/iterations/',   // OKF close-out: author the iteration record + index row
      'docs/log.md',        // OKF close-out: append the dated ship line
    ],
    budget: {
      attempts: 4,
      tokens: 1_000_000,
      toolCalls: 500,
      wallClockMs: 2_400_000, // 40 min — a multi-leaf change: export seam, mapping, an adapter, a second mapping
    },
    intent: 'production',
  },
  ceilingUsd: 15,
  repoRoot: '/Users/keith/dev/gauntlet/corellia',
  note:
    'Goal: the factory’s activity can be sent to an external observability tool as a ' +
    'faithful trace whose tree matches the factory’s goal tree, opt-in and isolated ' +
    'from the core, general across at least two tools, and unable to affect a run if it ' +
    'fails. Second of two slices split out of docs/issues/observability-pluggable-tracing.md; ' +
    'the other is observability-live-tail.ts. Derived copy, never a second source of truth.',
} satisfies import('./README.js').CommissionDoc;

export default doc;
