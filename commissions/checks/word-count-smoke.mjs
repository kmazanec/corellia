// Operator-owned acceptance check for the example-word-count commission.
// Declared as the commission's `smoke` script, so the tree may cite it as a
// { script: "smoke" } criterion but never author it: the done-condition is
// fixed by the commissioner, not graded by the tree that builds the CLI.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const CLI = 'out/commission-example-word-count/wc.mjs';

const cases = [
  { args: ['a b c'], expected: '3\n' },
  { args: ['  leading   and trailing  '], expected: '3\n' },
  { args: ['one'], expected: '1\n' },
  { args: [''], expected: '0\n' },
  { args: [], expected: '0\n' },
];

if (!existsSync(CLI)) {
  console.error(`FAIL: ${CLI} does not exist`);
  process.exit(1);
}

let failed = 0;
for (const { args, expected } of cases) {
  let actual;
  try {
    actual = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  } catch (err) {
    actual = `<exited ${err.status}>`;
  }
  const label = JSON.stringify(args);
  if (actual === expected) {
    console.log(`ok   ${label} -> ${JSON.stringify(actual)}`);
  } else {
    failed++;
    console.log(`FAIL ${label} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
  }
}

console.log(`${cases.length - failed}/${cases.length} cases passed`);
process.exit(failed === 0 ? 0 : 1);
