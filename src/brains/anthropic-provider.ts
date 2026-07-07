/**
 * Provider selection for the Anthropic family: prefer the DIRECT Anthropic
 * Messages API when a direct key is available, fall back to OpenRouter otherwise.
 *
 * OpenRouter is the factory's only wired provider, so an OpenRouter outage, rate
 * limit, or account issue halts every model call (issue anthropic-direct-provider).
 * The models the factory leans on hardest are the Anthropic family, and those can
 * be reached direct — which adds provider redundancy and unlocks direct pricing.
 * This module is the redirect: given the assembled catalog and the env, it rewrites
 * Anthropic-family rows to speak the Anthropic wire against api.anthropic.com when
 * `ANTHROPIC_API_KEY` is set, and leaves everything untouched when it is not — so
 * absent the key the factory behaves exactly as it does today.
 *
 * The rewrite is per catalog ROW, not global: only rows the {@link isAnthropicRow}
 * rule matches are redirected; a non-Anthropic row (DeepSeek, GLM, Gemini, a local
 * model) is never touched. A row already carrying its own `endpoint`/`wire` (an
 * explicit operator override via CORELLIA_MODELS_JSON) is left as the operator set
 * it — their intent wins over this default redirect.
 *
 * Prompt caching is explicitly OUT of scope (a follow-on); this module only routes.
 */

import type { AssembledCatalog, ModelSpec } from './model-catalog.js';
import type { Tier } from '../contract/goal.js';

/** The Anthropic Messages API base URL the direct rows are pointed at. */
export const ANTHROPIC_DIRECT_BASE_URL = 'https://api.anthropic.com/v1';

/** The env var whose api key name a direct Anthropic row reads. */
export const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

/**
 * True when a catalog row is an Anthropic-family model reachable direct — its id
 * is namespaced `anthropic/…` (the OpenRouter convention for the family). A row
 * that already declares its own `endpoint` OR `wire` is an explicit operator
 * override (e.g. a local proxy, or a hand-pinned direct row) and is NOT rewritten:
 * the operator's routing wins over this default.
 */
export function isAnthropicRow(spec: ModelSpec): boolean {
  return spec.id.startsWith('anthropic/') && spec.endpoint === undefined && spec.wire === undefined;
}

/**
 * Translate an OpenRouter Anthropic id (`anthropic/claude-opus-4.8`) into the
 * direct Messages API model id (`claude-opus-4-8`): strip the `anthropic/`
 * namespace and turn the version dots into dashes, which is the direct-API id
 * convention (e.g. `claude-haiku-4.5` → `claude-haiku-4-5`).
 */
export function directModelId(openRouterId: string): string {
  return openRouterId.replace(/^anthropic\//, '').replace(/\./g, '-');
}

/**
 * Rewrite the Anthropic-family rows of an assembled catalog to speak the DIRECT
 * Anthropic Messages API when `ANTHROPIC_API_KEY` is present in `env`; return the
 * assembled catalog unchanged when it is not.
 *
 * A rewritten row gets:
 *  - `id` → the direct model id ({@link directModelId}); the wire uses `id` as the
 *    request `model`, and the direct API rejects an `anthropic/`-prefixed id.
 *  - `wire: 'anthropic'` → the Messages API codec.
 *  - `endpoint` → api.anthropic.com with `apiKeyEnv: ANTHROPIC_API_KEY`, so the
 *    brain reads the direct key at the fetch site (the OpenRouter key is not used).
 *
 * `pins` (the `modelByTier` map) are remapped in lockstep: a band pinned to an
 * Anthropic id gets the direct id, so the brain's pin lookup still finds the row.
 * The default (unpinned) high band resolves to a non-Anthropic model (glm-5.2), so
 * the common case rewrites no pin; an operator who pins an Anthropic model at a
 * band still lands on the (now direct) row.
 *
 * Cost tags are LEFT AS-IS: the catalog's Anthropic rows already carry the
 * published direct per-Mtok pricing (haiku 1/5, sonnet 3/15, opus 5/25), so direct
 * and aggregated pricing coincide and no re-tag is needed. Measured spend still
 * comes from the provider's own usage accounting (ADR-017) regardless — the tags
 * only rank within a band. Capability/band, vision, and tool-calling are unchanged,
 * so a row's resolution position (which band, which needs it clears) is identical
 * whether it routes direct or through OpenRouter.
 */
export function applyAnthropicDirect(
  assembled: AssembledCatalog,
  env: NodeJS.ProcessEnv,
): AssembledCatalog {
  const key = env[ANTHROPIC_API_KEY_ENV];
  if (key === undefined || key.length === 0) return assembled;

  // Track which ids were rewritten so pins pointing at them can be remapped too.
  const rewrittenIds = new Map<string, string>();
  const catalog = assembled.catalog.map((spec) => {
    if (!isAnthropicRow(spec)) return spec;
    const directId = directModelId(spec.id);
    rewrittenIds.set(spec.id, directId);
    return {
      ...spec,
      id: directId,
      wire: 'anthropic' as const,
      endpoint: { baseUrl: ANTHROPIC_DIRECT_BASE_URL, apiKeyEnv: ANTHROPIC_API_KEY_ENV },
    };
  });

  const pins = { ...assembled.pins } as Record<Tier, string>;
  for (const tier of Object.keys(pins) as Tier[]) {
    const remapped = rewrittenIds.get(pins[tier]);
    if (remapped !== undefined) pins[tier] = remapped;
  }

  return { catalog, pins };
}
