// commissions/observability-pluggable-tracing.ts
// from docs/issues/observability-pluggable-tracing.md (delete the issue once this
// commission runs and the work lands as an iteration/ADR/code).
//
// Scope is the WHOLE issue — both parts — sized to satisfy its full acceptance
// hint, not a partial slice. The issue's own "ship-first" note is a build-ordering
// hint for the builder (do corellia logs --follow first), NOT a reason to shrink
// what this commission is responsible for delivering.

const doc = {
  commission: {
    id: 'observability-pluggable-tracing',
    title: 'Pluggable observability: EventSink fan-out (LangSmith-first) + a `corellia logs` CLI',
    spec: {
      description: [
        'Make the factory observable two ways, both reading the append-only event',
        'log WITHOUT changing it as the source of truth (ADR-003 holds; the log',
        'stays the factory memory, ADR-019). The core stays dependency-free',
        '(ADR-001) — any vendor SDK lives ONLY in an optional, separately-wired',
        'adapter module, never imported by src/ core.',
        '',
        'PART 1 — EventSink fan-out (export to backends).',
        'Add a thin sink interface — emit(event: FactoryEvent): void (best-effort,',
        'never throws into the store) with an optional flush(): Promise<void>. The',
        'EventStore fans out to each registered sink AFTER a successful append; a',
        'sink failure is caught and dropped/logged so observability can never break',
        'the factory durability. Storage (JSONL/PG) behavior is unchanged; sinks are',
        'additive and wired at the daemon from env (today behavior = an implicit',
        'JsonlSink). EventStore.append is the single choke point to wire this at',
        '(src/contract/events.ts; impls in src/eventlog/ + src/substrate/).',
        '',
        'Introduce a small NEUTRAL trace-projection (projections.ts-style) that turns',
        'the event stream into abstract spans, so adapters render that one mapping',
        'into their wire format and do not drift. Build the LangSmith adapter as the',
        'first concrete adapter: map the goal tree to LangSmith run/trace model',
        '(goal -> run, type derived from kind: chain for composite, llm for',
        'decide/produce/judge, tool for a leaf tool call; child goals -> child runs;',
        'usage -> token counts; judge-verdict findings -> run metadata; blocked ->',
        'error status). Gate it behind LANGSMITH_API_KEY. ALSO specify the OTLP /',
        'generic mapping (FactoryEvent -> OTel spans: goal=span, child-spawned=child',
        'span, tool/decide/verdict=span events, usage->metrics, block->span status)',
        'so the EventSink interface is proven generic against >=2 backends — the OTLP',
        'adapter may be implemented as a follow-on but its mapping must be specified.',
        '',
        'PART 2 — `corellia logs` local CLI (developer ergonomics).',
        'Graduate scripts/trace.ts into a real `corellia logs` subcommand and add the',
        'first `bin` entry to package.json (there is no CLI binary today; this',
        'establishes the `corellia` bin that future subcommands hang off):',
        '  - `corellia logs [path]` — the current replay (tree + per-goal trace + cost).',
        '  - `corellia logs --follow` / `-f` — THE missing live tail: stream new events',
        '    as they are appended (poll / fs.watch the JSONL; for PG, poll by id),',
        '    rendering the goal tree and per-goal lines incrementally. This is the',
        '    everyday "watch a run" win that today only `tail -f out/events.jsonl | jq`',
        '    can approximate.',
        '  - `--goal <substr>`, `--type <evt>` filters; `--cost` summary; color.',
        '  - Reads the SAME store the daemon writes — honor CORELLIA_EVENTS_PATH and',
        '    DATABASE_URL — so it works for both live:* runs and the deployed daemon.',
        'Refactor renderTree (and the other projections the CLI uses) into data + a',
        'thin renderer where needed, so the CLI and a future UI share one projection',
        'core rather than re-deriving it.',
        '',
        'NON-GOAL for this commission: a richer interactive TUI (a live in-place',
        'goal-tree, drill-into-goal, cost meter, block alerts). Captured in the issue',
        'as a follow-on; build it separately once `corellia logs --follow` proves the',
        'shape. Do not build the TUI here.',
      ].join('\n'),
      constraints: [
        // ── Acceptance criteria (from the issue) — the done-condition ──
        'A daemon run with LANGSMITH_API_KEY set produces a LangSmith trace whose run tree matches the factory goal tree (goals as nested runs, tool/decide/judge steps, token costs). Where a live LangSmith account is unavailable at build time, prove this STRUCTURALLY: the event->span mapping is unit-tested so the produced run tree provably matches the goal tree.',
        'No vendor SDK is imported by src/ core — only the optional adapter module imports it (ADR-001 zero-dep core preserved).',
        'The event log + storage behavior are unchanged; a sink that throws does NOT break a run (the factory still persists and converges) — cover this with a test.',
        '`corellia logs --follow` streams a live run events live, rendering the goal tree + per-goal trace incrementally, honoring CORELLIA_EVENTS_PATH (and DATABASE_URL for PG).',
        'The OTLP adapter mapping is specified (event->span) even if its implementation is a follow-on, so the EventSink interface is demonstrably generic against >=2 backends.',
        // ── Process / hygiene ──
        'Open a PR when done.',
        'Read DESIGN.md, ADR-003 (event log is source of truth), ADR-019 (knowledge artifacts), ADR-026 (front-door daemon), and ADR-001 (zero-dep core) before changing the append seam or daemon wiring; if any change would contradict an ADR, surface it as a blocker rather than proceeding.',
        // ── Code shape ──
        'Preserve code shape: small domain-named modules (the sink interface, the neutral trace-projection, each adapter, and the CLI each own their own file), keep orchestration thin (the daemon config wires sinks; it does not contain mapping logic), and move focused tests to the ownership boundary (mapping tests next to the trace-projection, sink-failure-isolation test next to the store fan-out).',
        'Run `npm run code-shape -- src/eventlog/ src/daemon/ scripts/` and include its output as maintainability evidence, since this touches broad, already-pressured areas.',
      ],
    },
    scope: [
      'src/contract/events.ts',      // EventStore.append seam + EventSink interface
      'src/eventlog/',               // store fan-out, neutral trace-projection, projection data/render split
      'src/substrate/',              // PG store fan-out parity
      'src/daemon/',                 // sink wiring from env (config.ts / daemon.ts)
      'src/observability/',          // NEW: optional adapter modules (LangSmith, OTLP) — vendor SDKs live here only
      'scripts/',                    // corellia logs CLI (graduates trace.ts)
      'package.json',                // first `bin` entry + any optional adapter dep
    ],
    budget: {
      attempts: 4,
      tokens: 1_200_000,
      toolCalls: 600,
      wallClockMs: 2_400_000,
    },
    intent: 'production',
  },
  ceilingUsd: 15,

  note:
    'Full delivery of docs/issues/observability-pluggable-tracing.md — both the ' +
    'EventSink fan-out (LangSmith-first, OTLP specified) and the corellia logs ' +
    '--follow CLI — sized to satisfy the issue acceptance hint in whole, not a slice.',
} satisfies import('./README.js').CommissionDoc;

export default doc;
