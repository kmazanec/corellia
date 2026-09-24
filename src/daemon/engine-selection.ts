/**
 * Engine selection for the processes that run trees: the single-process
 * daemon and the queue worker (ADR-026, ADR-051). Environment decides it:
 * a simulated engine for model-free runs, the live engine when an API key is
 * set, and otherwise a null engine that rejects every run so a keyless
 * process still starts and serves its surfaces.
 */

import type { EventStore } from '../contract/events.js';
import type { PatternStore } from '../contract/pattern.js';
import { buildSimulatedEngine } from '../dev/simulated-engine.js';
import type { Engine } from '../engine/engine.js';
import { buildDeclaredScripts } from './config.js';
import { buildLiveEngine, deriveRepoSlug } from './live-engine.js';

export interface EngineDeps {
  store: EventStore;
  patterns: PatternStore;
}

/**
 * A stub engine used when OPENROUTER_API_KEY is absent.
 *
 * For the daemon's keyless smoke/healthcheck path (docker compose up without
 * a real API key) this prevents the process from crashing at startup.
 * The stub rejects every run immediately so commissioned intents do not silently
 * succeed without a real brain.
 *
 * When OPENROUTER_API_KEY IS present, buildLiveEngine() is used instead and this
 * stub is never constructed.
 */
function buildNullEngine(): Engine {
  return {
    run: (_goal: unknown) =>
      Promise.reject(
        new Error(
          'No engine configured — set OPENROUTER_API_KEY to enable live commission delivery',
        ),
      ),
  } as unknown as Engine;
}

/**
 * Select the engine based on environment:
 *   - CORELLIA_ENGINE=simulated  → buildSimulatedEngine() (no model; sample runs)
 *   - OPENROUTER_API_KEY present → buildLiveEngine() (real LLM delivery, AC-3)
 *   - OPENROUTER_API_KEY absent  → buildNullEngine() (keyless smoke/healthcheck path)
 *
 * The repo root for the live engine is CORELLIA_REPO_ROOT (default: cwd).
 * If the repo root is not a git repository, the daemon logs a warning and falls
 * back to the null engine rather than crashing — the HTTP surface stays up.
 */
export function selectEngine({ store, patterns }: EngineDeps): Engine {
  if (process.env['CORELLIA_ENGINE'] === 'simulated') {
    const stepMs = Number(process.env['CORELLIA_SIM_STEP_MS'] ?? 400);
    console.log(`[engine] simulated engine — no model; sample runs play into the log every ${stepMs} ms`);
    return buildSimulatedEngine({ store, stepMs });
  }

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    console.log('[engine]: null engine — commissions will be rejected; set OPENROUTER_API_KEY to enable delivery');
    return buildNullEngine();
  }

  try {
    const repoRoot = process.env['CORELLIA_REPO_ROOT'] ?? process.cwd();
    const repoSlug = deriveRepoSlug(repoRoot);
    // FACTORY_REPO_SLUG: the GitHub owner/repo slug of the factory's own repo.
    // When set and equal to the push target's repoSlug, the process-clean gate
    // narrows to ALWAYS_DANGEROUS_PATTERNS only (factory vocabulary is permitted
    // in factory-own-repo diffs). Unset = no repo is the factory repo → full
    // gate always. Safe default: do NOT set unless this daemon is corellia
    // pushing to its own repo.
    const factoryRepoSlugEnv = process.env['FACTORY_REPO_SLUG'] ?? undefined;
    const declaredScripts = buildDeclaredScripts();
    const sandbox = {
      repoRoot,
      declaredScripts,
      ...(repoSlug
        ? {
            prBoundary: {
              repoSlug,
              ...(factoryRepoSlugEnv !== undefined ? { factoryRepoSlug: factoryRepoSlugEnv } : {}),
            },
          }
        : {}),
    };
    const engine = buildLiveEngine({ store, sandbox, goldenCapture: true, patterns });
    console.log('[engine]: live engine — commissions will be processed via OpenRouter');
    const defaultScriptNames = Object.keys(declaredScripts);
    console.log(
      defaultScriptNames.length > 0
        ? `[engine]: default declared scripts: ${defaultScriptNames.join(', ')} (commissions may declare more)`
        : '[engine]: no default declared scripts — only commission-declared scripts are runnable',
    );
    console.log('[engine] flywheel: split-memo pattern store wired — recurring splits memoize');
    if (repoSlug) {
      console.log(`[engine]: target repo slug: ${repoSlug}`);
      if (factoryRepoSlugEnv) {
        console.log(`[engine]: factory repo slug: ${factoryRepoSlugEnv} (process-clean gate narrowed for own-repo pushes)`);
      } else {
        console.log('[engine]: FACTORY_REPO_SLUG unset → full process-clean gate for all pushes');
      }
    } else {
      console.log('[engine]: no GitHub remote detected; push_branch/open_pr will not be available');
    }
    return engine;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[engine]: failed to build live engine (${msg}); falling back to null engine`);
    return buildNullEngine();
  }
}
