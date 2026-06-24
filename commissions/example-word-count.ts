/**
 * Dogfood commission: the small, PROVEN target for validating the artifact shape
 * before the front door is pointed at anything bigger. Mirrors the word-count
 * spec from `examples/live.ts` — a single-file Node ESM CLI, unit-verifiable, no
 * external reach — exactly the shape Corellia is known to deliver well.
 *
 * Run:  npm run commission:run -- example-word-count
 */
import type { CommissionDoc } from './types.js';

const doc = {
  commission: {
    id: 'example-word-count',
    title: 'Ship a word-count CLI',
    spec: {
      description:
        'A Node.js ESM CLI at out/commission-example-word-count/wc.mjs that accepts ' +
        'a single string argument and prints the word count (integer, ' +
        'newline-terminated) to stdout. Words are whitespace-delimited tokens. ' +
        'If no argument is given, print 0.',
      constraints: [
        'Single self-contained ESM file; no dependencies.',
        'All work confined to the declared scope.',
      ],
    },
    scope: ['out/commission-example-word-count/'],
    budget: {
      attempts: 3,
      tokens: 200_000,
      toolCalls: 200,
      wallClockMs: 600_000, // 10 minutes
    },
    intent: 'production',
  },
  ceilingUsd: 5,
  note: 'Dogfood target: prove the commission artifact + runner on a small, known-good goal.',
} satisfies CommissionDoc;

export default doc;
