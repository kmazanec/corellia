/**
 * The separate, explicit RUN step for a reviewed commission artifact.
 *
 * The `commission` skill (.claude/skills/commission/) produces a reviewed
 * `commissions/<id>.ts` artifact and STOPS. This runner is the deliberate second
 * step: it loads that artifact and feeds it through the factory's REAL front door
 * (`listener.commission()`) — not a hand-built root goal. Plan and build stay
 * decoupled; a human review gate sits between them.
 *
 * Prerequisites:
 *   export OPENROUTER_API_KEY=sk-or-...
 *
 * Run:
 *   npm run commission:run -- <id>          # e.g. example-word-count
 *
 * Events land in out/commission-<id>/events-<runStamp>.jsonl — one file PER RUN,
 * never appended across runs. A shared log would concatenate distinct runs and
 * make every projection, cost total, and the live watcher read mixed history (a
 * prior run's root `emitted` would even read as "this run finished"). The watcher
 * resolves the newest events-*.jsonl. File artifacts go under the same dir.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { Listener } from '../src/listener/listener.js';
import { loadDotEnv } from '../src/env.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { renderTree, traceStats } from '../src/eventlog/projections.js';
import { buildLiveEngine, assertGitRepo } from '../src/daemon/live-engine.js';
import type { DeclaredScripts } from '../src/library/script-runner.js';
import type { CommissionDoc } from '../commissions/types.js';

const DEFAULT_SPEND_CEILING_USD = 15; // mirrors engine.ts:56 (the effective default)

loadDotEnv();

// ── Resolve which commission to run ─────────────────────────────────────────────

const id = process.argv[2];
if (!id) {
  console.error('Usage: npm run commission:run -- <id>');
  console.error('  where <id> matches a commissions/<id>.ts artifact.');
  process.exit(1);
}

const artifactPath = resolve('commissions', `${id}.ts`);
let doc: CommissionDoc;
try {
  const mod = (await import(artifactPath)) as { default: CommissionDoc };
  doc = mod.default;
} catch (err) {
  console.error(`Could not load commission artifact: ${artifactPath}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const { commission, ceilingUsd } = doc;
if (commission.id !== id) {
  console.error(
    `Artifact id "${commission.id}" does not match filename "${id}". Fix one so they agree.`,
  );
  process.exit(1);
}

const OUT_DIR = `out/commission-${id}`;

// ── Banner + honest ceiling note (BEFORE building the brain/engine, so a bad ──────
//    artifact is caught even without an API key) ─────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║              Corellia — run reviewed commission              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`Commission:  ${commission.id} — ${commission.title}`);
console.log(`Scope:       ${commission.scope.join(', ')}`);
console.log(`Intent:      ${commission.intent ?? 'production'}`);
console.log(
  `Budget:      ${commission.budget.attempts} attempts, ` +
    `${commission.budget.tokens.toLocaleString()} tokens, ` +
    `${commission.budget.toolCalls} tool calls, ` +
    `${Math.round(commission.budget.wallClockMs / 60_000)} min`,
);
console.log(
  `Ceiling:     $${ceilingUsd}` +
    (ceilingUsd === DEFAULT_SPEND_CEILING_USD ? ' (engine default)' : ' (per-commission)'),
);
console.log(`Sandbox:     ${commission.repoRoot ?? doc.repoRoot ?? process.cwd()}`);
console.log('');
console.log('Running... (live LLM run; costs are real)');
console.log('');

// ── Engine + Listener (the real front door) ──────────────────────────────────────
//
// Wire the engine the SAME way the live front door does (buildLiveEngine, used by
// examples/live-self.ts) — with a sandbox so leaves get real file/script tools via
// the broker. A bare `new Engine({registry,brain,store,memory})` gives leaves NO
// tools, so any code-writing commission stalls on "I have no file access".

mkdirSync(OUT_DIR, { recursive: true });

// The repo the tree operates against. Commissions declare repoRoot; default to cwd.
const repoRoot = resolve(commission.repoRoot ?? doc.repoRoot ?? process.cwd());
assertGitRepo(repoRoot, 'commission repoRoot');

// run_script may only invoke DECLARED entry points. Use the commission's declared
// scripts if present; otherwise declare the standard verification trio so a build
// can keep typecheck/lint/test green (mirrors examples/live-self.ts).
const declaredScripts: DeclaredScripts = commission.declaredScripts ?? {
  test: 'npm-script:test',
  typecheck: 'npm-script:typecheck',
  lint: 'npm-script:lint',
  // Commission constraints routinely ask for code-shape evidence; leaving it
  // undeclared makes every such run_script call an instant refusal.
  'code-shape': 'npm-script:code-shape',
};

// One fresh log per run. A shared events.jsonl, appended across runs, would
// concatenate distinct runs into one file — corrupting renderTree (a tree mixing
// two runs' goals), costSummary (summed spend across runs), and the live watcher
// (a stale prior-run root `emitted` reads as "this run finished"). Stamp the log
// per run, and refresh a stable `latest.jsonl` copy-pointer the watcher resolves.
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const logPath = `${OUT_DIR}/events-${runStamp}.jsonl`;
const store = new JsonlEventStore(logPath);
console.log(`Events:      ${logPath}`);
console.log(`Watch:       npm run commission:watch -- ${id}`);
console.log('');
const engine = buildLiveEngine({
  store,
  sandbox: { repoRoot, declaredScripts },
  goldenCapture: true,
});
const listener = new Listener({ engine, store });

// ── Commission through the real front door ───────────────────────────────────────

let report;
try {
  report = await listener.commission({ ...commission, spendCeilingUsd: ceilingUsd });
} catch (err) {
  console.error('');
  console.error('═══ COMMISSION RUN FAILED ══════════════════════════════════════');
  console.error('Diagnosis:', err instanceof Error ? err.message : String(err));
  const events = await store.list();
  if (events.length > 0) {
    console.error('');
    console.error('Partial goal tree at failure:');
    console.error(renderTree(events));
  }
  if (err instanceof Error && err.stack) {
    console.error('');
    console.error(err.stack);
  }
  process.exit(1);
}

// ── Write any file artifacts the factory returned (scoped to OUT_DIR) ─────────────
//
// Artifact paths are repo-relative (e.g. docs/log.md); they are mirrored UNDER
// OUT_DIR as a record of what the factory returned. The real delivery path is the
// sandbox worktree / PR boundary — never a direct write into the repo from here.

function safeResolve(filePath: string): string | null {
  const base = resolve(OUT_DIR);
  const abs = resolve(base, filePath);
  if (!abs.startsWith(base + '/') && abs !== base) return null;
  return abs;
}

if (report.artifact?.kind === 'files' && report.artifact.files) {
  for (const file of report.artifact.files) {
    const abs = safeResolve(file.path);
    if (abs === null) {
      console.warn(`Skipped (escapes ${OUT_DIR}): ${file.path}`);
      continue;
    }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, file.content, 'utf8');
    console.log(`Wrote: ${OUT_DIR}/${file.path}`);
  }
} else if (report.artifact?.kind === 'text') {
  const textPath = `${OUT_DIR}/artifact.txt`;
  writeFileSync(textPath, report.artifact.text ?? '', 'utf8');
  console.log(`Wrote text artifact: ${textPath}`);
}

// ── Goal tree + stats + outcome ──────────────────────────────────────────────────

const allEvents = await store.list();
console.log('');
console.log('── goal tree ────────────────────────────────────────────────────');
console.log(renderTree(allEvents));

console.log('');
console.log('── trace stats ──────────────────────────────────────────────────');
const stats = traceStats(allEvents);
for (const [type, s] of Object.entries(stats)) {
  const parts: string[] = [`${type}:`];
  if (s.attempts) parts.push(`${s.attempts} attempt(s)`);
  if (s.passes) parts.push(`${s.passes} pass(es)`);
  if (s.failures) parts.push(`${s.failures} failure(s)`);
  if (s.repairs) parts.push(`${s.repairs} repair(s)`);
  if (s.escalations) parts.push(`${s.escalations} escalation(s)`);
  console.log(' ', parts.join('  '));
}

console.log('');
console.log('── learned ──────────────────────────────────────────────────────');
console.log(report.learned || '(none)');

console.log('');
if (report.blockers.length > 0) {
  console.log('BLOCKERS:', report.blockers);
} else {
  console.log('Run complete. Report: PASS (no blockers).');
}
console.log('');
