/**
 * OpenRouter configuration helper for LlmBrain.
 *
 * Returns an LlmBrainConfig pre-wired to https://openrouter.ai/api/v1 with
 * the Anthropic model family as defaults.
 *
 * Default model IDs were chosen by inspecting the public OpenRouter models
 * endpoint (GET https://openrouter.ai/api/v1/models, no key required) and
 * picking the latest non-deprecated Anthropic model per tier at build time.
 * Re-check that endpoint if you suspect staleness.
 *
 * Environment variable overrides:
 *   OPENROUTER_API_KEY      — required, Bearer token for every request
 *   CORELLIA_MODEL_LOW      — override low-tier model ID
 *   CORELLIA_MODEL_MID      — override mid-tier model ID
 *   CORELLIA_MODEL_HIGH     — override high-tier model ID
 */

import type { LlmBrainConfig } from './llm.js';

/**
 * Default model IDs sourced from GET https://openrouter.ai/api/v1/models on
 * 2026-06-11, cross-checked against current agentic/coding rankings. The tier
 * Tier names are low/mid/high — cost-optimized, cross-vendor picks: each ranks
 * at or above the Anthropic model it replaces on current agentic boards at
 * roughly an order of magnitude lower cost, and all three support tools +
 * structured outputs. Override per tier via CORELLIA_MODEL_LOW/MID/HIGH.
 */
const DEFAULT_MODELS = {
  // ~$0.14/$0.28 per M — 1M ctx; V4 family noted for tool-call reliability
  // and well-formed JSON payloads.
  low: 'deepseek/deepseek-v4-flash',
  // ~$0.44/$0.87 per M — 1M ctx; frontier-class agentic/coding.
  mid: 'deepseek/deepseek-v4-pro',
  // ~$0.455/$1.82 per M — judge-grade quality, different vendor from mid/low
  // for provider diversity; BFCL top-10 tool-call reliability.
  high: 'qwen/qwen3-235b-a22b',
} as const;

/**
 * Build an LlmBrainConfig pointed at OpenRouter.
 *
 * @param env - defaults to process.env; inject a plain object in tests to
 *   avoid touching the real environment.
 */
export function openRouterConfig(env: NodeJS.ProcessEnv = process.env): LlmBrainConfig {
  const apiKey = env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. ' +
        'Export it (export OPENROUTER_API_KEY=sk-or-...) or copy .env.example to .env and fill it in.',
    );
  }

  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
    modelByTier: {
      low: env['CORELLIA_MODEL_LOW'] ?? DEFAULT_MODELS.low,
      mid: env['CORELLIA_MODEL_MID'] ?? DEFAULT_MODELS.mid,
      high: env['CORELLIA_MODEL_HIGH'] ?? DEFAULT_MODELS.high,
    },
    // OpenRouter requires the HTTP-Referer header to attribute traffic; the
    // site-url is optional but recommended for rate-limit visibility.
    headers: {
      'HTTP-Referer': 'https://github.com/corellia-factory',
      'X-Title': 'Corellia Factory',
    },
  };
}
