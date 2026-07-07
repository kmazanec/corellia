/**
 * `corellia calibrate <judge-or-goal-type> [--tier low|mid|high] [--repo <root>]`
 * — the calibration report surface (judge-calibration-replay). Loads the golden
 * set for the named goal-type (or every set whose judgeType matches when a judge
 * name is given), replays it through the judge, and prints the agreement score.
 *
 * The brain is INJECTED by the caller (`deps.makeBrain`); the default builds a
 * live OpenRouter `LlmBrain`. Tests pass a `ScriptedBrain` so replay runs
 * deterministically and never hits a live API.
 *
 * This module owns the command's behavior; scripts/corellia.ts is a thin
 * dispatcher that hands it argv.
 */

import type { Brain } from '../../contract/brain.js';
import type { Tier } from '../../contract/goal.js';
import type { LogsConsole } from '../../eventlog/logs-cli.js';
import type { GoldenPair } from './golden-set.js';
import { fileGoldenStore, goldenRoot, type GoldenStore } from './golden-store.js';
import { replayGoldenSet, renderScore, type CalibrationScore } from './replay.js';
import { readdir } from 'node:fs/promises';

const TIERS = new Set<Tier>(['low', 'mid', 'high']);

export interface CalibrateArgs {
  /** A goal-type name (its set) or a judge-type name (every set it judges). */
  target: string | undefined;
  tier: Tier;
  /** Repo root under which `fixtures/golden` lives; defaults to cwd. */
  repoRoot: string | undefined;
  error: string | undefined;
}

/**
 * Parse `calibrate` argv: `<target> [--tier <t>] [--repo <root>]`. The first
 * positional is the target; flags may appear anywhere.
 */
export function parseCalibrateArgs(argv: readonly string[]): CalibrateArgs {
  let tier: Tier = 'mid';
  let repoRoot: string | undefined;
  let target: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--tier': {
        const value = argv[++i];
        if (value === undefined || !TIERS.has(value as Tier)) {
          return { target: undefined, tier: 'mid', repoRoot: undefined, error: `corellia calibrate: --tier must be one of low, mid, high` };
        }
        tier = value as Tier;
        break;
      }
      case '--repo':
        repoRoot = argv[++i];
        break;
      default:
        if (arg !== undefined && !arg.startsWith('-') && target === undefined) target = arg;
        break;
    }
  }

  if (target === undefined) {
    return { target: undefined, tier, repoRoot, error: 'usage: corellia calibrate <judge-or-goal-type> [--tier low|mid|high] [--repo <root>]' };
  }
  return { target, tier, repoRoot, error: undefined };
}

/**
 * Resolve the golden sets the target names. First try the target as a goal-type
 * (its own fixture dir). If that is empty, treat it as a judge-type and gather
 * every goal-type set whose pairs carry that judgeType. Returns one entry per
 * goal-type that contributes pairs.
 */
export async function resolveTargetSets(
  target: string,
  repoRoot: string,
  store: GoldenStore,
): Promise<Array<{ goalType: string; pairs: GoldenPair[] }>> {
  const direct = await store.loadSet(target);
  if (direct.length > 0) {
    return [{ goalType: target, pairs: direct }];
  }

  // Treat target as a judge-type: scan every goal-type dir for matching pairs.
  let goalTypeDirs: string[];
  try {
    goalTypeDirs = await readdir(goldenRoot(repoRoot));
  } catch {
    return [];
  }

  const sets: Array<{ goalType: string; pairs: GoldenPair[] }> = [];
  for (const goalType of goalTypeDirs.sort()) {
    const pairs = (await store.loadSet(goalType)).filter((p) => p.judgeType === target);
    if (pairs.length > 0) sets.push({ goalType, pairs });
  }
  return sets;
}

/**
 * Run the `calibrate` command: resolve the target's golden sets, replay each
 * through the judge, print each score. Returns a nonzero exit code when the
 * target names no golden pairs (nothing to calibrate is an operator error worth
 * surfacing, not a silent success).
 */
export async function runCalibrate(
  args: CalibrateArgs,
  io: LogsConsole,
  deps: { makeBrain: () => Brain | Promise<Brain>; makeStore?: (repoRoot: string) => GoldenStore } = {
    makeBrain: liveBrain,
  },
): Promise<{ code: number; scores: CalibrationScore[] }> {
  if (args.error !== undefined) {
    io.error(args.error);
    return { code: 2, scores: [] };
  }
  if (args.target === undefined) {
    io.error('corellia calibrate: missing target');
    return { code: 2, scores: [] };
  }

  const repoRoot = args.repoRoot ?? process.cwd();
  const store = (deps.makeStore ?? fileGoldenStore)(repoRoot);
  const sets = await resolveTargetSets(args.target, repoRoot, store);

  if (sets.length === 0) {
    io.error(`corellia calibrate: no golden pairs for "${args.target}" under ${goldenRoot(repoRoot)}`);
    io.error('  Curate at least one labeled candidate into the set first.');
    return { code: 1, scores: [] };
  }

  const brain = await deps.makeBrain();
  const scores: CalibrationScore[] = [];
  for (const { goalType, pairs } of sets) {
    const score = await replayGoldenSet({ goalType, pairs, brain, tier: args.tier });
    scores.push(score);
    io.log(renderScore(score));
    io.log('');
  }
  return { code: 0, scores };
}

/**
 * Build a live OpenRouter LlmBrain wired to the starter type catalog. The
 * default for operator use; tests inject a ScriptedBrain instead and never load
 * this path (which requires OPENROUTER_API_KEY). Imported dynamically so the
 * heavy brain/provider modules never load in a test that injects its own brain.
 */
async function liveBrain(): Promise<Brain> {
  const [{ LlmBrain }, { openRouterConfig }, { starterTypes }] = await Promise.all([
    import('../../brains/llm.js'),
    import('../../brains/openrouter.js'),
    import('../../library/starter-types.js'),
  ]);
  return new LlmBrain(openRouterConfig(), starterTypes().map((t) => t.name));
}
