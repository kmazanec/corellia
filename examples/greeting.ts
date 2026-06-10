/**
 * End-to-end demo: a commissioned "Ship a greeting CLI" intent runs through
 * the full factory — split, dependency sequencing, deterministic checks,
 * judge-critique, the repair rung, and integration eval.
 *
 * Run with: npm run demo
 *
 * What this demonstrates:
 *   1. Root goal (deliver-intent) splits into three children:
 *      contract → [hello-cmd, farewell-cmd] (both depend on contract)
 *   2. The contract child (freeze-contract) lands first, publishing format.mjs.
 *   3. hello-cmd's first produce fails critique-code with a prescription;
 *      the repair rung fires, the repaired artifact passes.
 *   4. farewell-cmd passes first try.
 *   5. judge-integration stamps the assembled artifact clean.
 *   6. Artifacts are written to disk; node out/greeting/cli.mjs runs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Engine } from '../src/engine/engine.js';
import { JsonlEventStore } from '../src/eventlog/jsonl-store.js';
import { projectMemory, renderTree, traceStats } from '../src/eventlog/projections.js';
import { createRegistry } from '../src/library/registry.js';
import { starterTypes } from '../src/library/starter-types.js';
import { ScriptedBrain } from '../src/brains/scripted.js';
import type { Artifact } from '../src/contract/report.js';
import type { Verdict } from '../src/contract/verdict.js';

// ── Artifacts the factory will "produce" ─────────────────────────────────────

// The format contract: a shared ES-module constant both commands import.
const formatMjs: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/format.mjs',
      content: `export const GREETING_TEMPLATE = (name) => \`Hello, \${name}!\`;
export const FAREWELL_TEMPLATE = (name) => \`Goodbye, \${name}!\`;
`,
    },
  ],
};

// hello-cmd — first produce is deliberately incomplete (no shebang, wrong variable name).
const helloV1: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/hello.mjs',
      content: `import { GREETING } from './format.mjs'; // wrong import name
const name = process.argv[2] ?? 'world';
process.stdout.write(GREETING(name) + '\\n');
`,
    },
  ],
};

// hello-cmd — repaired produce (correct import, works).
const helloV2: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/hello.mjs',
      content: `import { GREETING_TEMPLATE } from './format.mjs';
const name = process.argv[2] ?? 'world';
process.stdout.write(GREETING_TEMPLATE(name) + '\\n');
`,
    },
  ],
};

// farewell-cmd — first produce is correct.
const farewellV1: Artifact = {
  kind: 'files',
  files: [
    {
      path: 'out/greeting/farewell.mjs',
      content: `import { FAREWELL_TEMPLATE } from './format.mjs';
const name = process.argv[2] ?? 'world';
process.stdout.write(FAREWELL_TEMPLATE(name) + '\\n');
`,
    },
  ],
};

// ── Verdicts ──────────────────────────────────────────────────────────────────

const pass: Verdict = { pass: true, findings: [] };

// critique-code fails hello-cmd v1 with a concrete prescription
const helloV1Verdict: Verdict = {
  pass: false,
  findings: [
    {
      title: 'Wrong import binding: GREETING is not exported by format.mjs',
      dimension: 'spec',
      severity: 'high',
      gating: true,
      prescription:
        'Replace `GREETING` with `GREETING_TEMPLATE` in the import statement',
    },
  ],
};

// ── ScriptedBrain script ──────────────────────────────────────────────────────
//
// Keys: goal.title is checked first, goal.type is the fallback.
// The engine calls brain.judge(goal, ...) where `goal` is the goal being judged,
// NOT a separate judge-type goal — so we key by the leaf's title.

const brain = new ScriptedBrain({
  decide: {
    // Root goal: split into the three children
    'Ship a greeting CLI': [
      {
        kind: 'split',
        children: [
          {
            localId: 'contract',
            type: 'freeze-contract',
            title: 'Freeze greeting format contract',
            spec: { description: 'Export GREETING_TEMPLATE and FAREWELL_TEMPLATE from format.mjs' },
            dependsOn: [],
            scope: ['out/greeting/'],
            budgetShare: 0.2,
          },
          {
            localId: 'hello-cmd',
            type: 'implement',
            title: 'Implement hello command',
            spec: { description: 'Write hello.mjs that imports from format.mjs and prints a greeting' },
            dependsOn: ['contract'],
            scope: ['out/greeting/'],
            budgetShare: 0.35,
          },
          {
            localId: 'farewell-cmd',
            type: 'implement',
            title: 'Implement farewell command',
            spec: { description: 'Write farewell.mjs that imports from format.mjs and prints a farewell' },
            dependsOn: ['contract'],
            scope: ['out/greeting/'],
            budgetShare: 0.35,
          },
        ],
      },
    ],
  },

  produce: {
    'Freeze greeting format contract': [formatMjs],
    // hello-cmd: first produce is flawed, second is the repaired artifact
    // (the second slot is for the repair path's recheckAndJudge — but repair
    // returns helloV2 directly, so no second produce is needed from the script)
    'Implement hello command': [helloV1],
    'Implement farewell command': [farewellV1],
  },

  judge: {
    // judge-split is invoked with the root goal as `goal`
    'Ship a greeting CLI': [
      pass,  // judge-split passes
      pass,  // judge-integration passes
    ],
    // critique-code for contract
    'Freeze greeting format contract': [pass],
    // critique-code for hello-cmd: fail first (triggers repair), then pass on recheck
    'Implement hello command': [helloV1Verdict, pass],
    // critique-code for farewell-cmd: pass first try
    'Implement farewell command': [pass],
  },

  repair: {
    // Explicit repair for hello-cmd: return the corrected version
    'Implement hello command': [helloV2],
  },
});

// ── Wire up the factory ───────────────────────────────────────────────────────

const store = new JsonlEventStore('out/greeting/events.jsonl');

// Memory is a live projection of the event store — exactly the design pattern.
const memory = {
  query: async (topic: string, scope: string[]) =>
    projectMemory(await store.list()).query(topic, scope),
};

const registry = createRegistry(starterTypes());

const engine = new Engine({ registry, brain, store, memory });

// ── Root goal ─────────────────────────────────────────────────────────────────

const rootGoal = {
  id: 'greeting-demo',
  type: 'deliver-intent',
  parentId: null,
  title: 'Ship a greeting CLI',
  spec: {
    description:
      'A CLI that prints a greeting and farewell for the name given as argv[1], ' +
      'defaulting to "world". Both messages share a frozen format contract.',
  },
  intent: 'production' as const,
  scope: ['out/greeting/'],
  budget: {
    attempts: 5,
    tokens: 50_000,
    toolCalls: 100,
    wallClockMs: 300_000,
  },
  memories: [],
};

// ── Run ───────────────────────────────────────────────────────────────────────

console.log('');
console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║          Corellia factory — greeting CLI demo                ║');
console.log('╚══════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Goal:  Ship a greeting CLI');
console.log('Tree:  deliver-intent → [freeze-contract] → [implement × 2]');
console.log('       contract lands first; both implement children depend on it.');
console.log('       hello-cmd fails critique-code on its first produce;');
console.log('       the repair rung fires and the corrected artifact passes.');
console.log('');

const report = await engine.run(rootGoal);

// ── Write artifacts to disk ───────────────────────────────────────────────────

if (report.artifact?.kind === 'files' && report.artifact.files) {
  for (const file of report.artifact.files) {
    const resolved = resolve(file.path);
    if (!resolved.startsWith(resolve('out/greeting'))) {
      throw new Error(`Path traversal rejected: ${file.path}`);
    }
    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(file.path, file.content, 'utf8');
  }
}

// Assemble the entry-point CLI that imports from both modules
mkdirSync('out/greeting', { recursive: true });
const cliPath = 'out/greeting/cli.mjs';
if (!resolve(cliPath).startsWith(resolve('out/greeting'))) {
  throw new Error(`Path traversal rejected: ${cliPath}`);
}
writeFileSync(
  cliPath,
  `import { GREETING_TEMPLATE, FAREWELL_TEMPLATE } from './format.mjs';
const name = process.argv[2] ?? 'world';
console.log(GREETING_TEMPLATE(name));
console.log(FAREWELL_TEMPLATE(name));
`,
  'utf8',
);

// ── Run the assembled CLI ─────────────────────────────────────────────────────

console.log('── assembled CLI output ─────────────────────────────────────────');
let cliOutput: string;
try {
  cliOutput = execSync('node out/greeting/cli.mjs Corellia', { encoding: 'utf8' }).trim();
  console.log(cliOutput);
} catch (err) {
  console.error('CLI failed:', err);
  cliOutput = '';
}
console.log('');

// ── Event tree ────────────────────────────────────────────────────────────────

console.log('── goal tree ────────────────────────────────────────────────────');
const allEvents = await store.list();
console.log(renderTree(allEvents));
console.log('');

// ── Trace stats ───────────────────────────────────────────────────────────────

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

// ── Learned + control-loop events ────────────────────────────────────────────

console.log('── learned ──────────────────────────────────────────────────────');
console.log(report.learned || '(none)');
console.log('');

const repairEvents = allEvents.filter((e) => e.type === 'repair-applied').length;
const escalateEvents = allEvents.filter((e) => e.type === 'tier-escalated').length;
console.log(`── control-loop summary ─────────────────────────────────────────`);
console.log(`  repair-applied:  ${repairEvents}`);
console.log(`  tier-escalated:  ${escalateEvents}`);
console.log('');

if (report.blockers.length > 0) {
  console.log('BLOCKERS:', report.blockers);
} else {
  console.log('Run complete. Report: PASS (no blockers).');
}
console.log('');
