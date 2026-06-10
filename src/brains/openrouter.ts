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
 *   CORELLIA_MODEL_HAIKU    — override haiku-tier model ID
 *   CORELLIA_MODEL_SONNET   — override sonnet-tier model ID
 *   CORELLIA_MODEL_OPUS     — override opus-tier model ID
 */

import type { LlmBrainConfig } from './llm.js';

/**
 * Default model IDs sourced from GET https://openrouter.ai/api/v1/models on
 * 2026-06-10. These are the routing aliases that always resolve to the latest
 * model in each Anthropic tier-family on OpenRouter.
 */
const DEFAULT_MODELS = {
  haiku: 'anthropic/claude-haiku-latest',
  sonnet: 'anthropic/claude-sonnet-latest',
  // Explicit Opus 4 version rather than an alias — most capable tier currently
  // listed. Swap to anthropic/claude-opus-latest when it becomes available.
  opus: 'anthropic/claude-opus-4-5',
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
        'Export it before running: export OPENROUTER_API_KEY=sk-or-...',
    );
  }

  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
    modelByTier: {
      haiku: env['CORELLIA_MODEL_HAIKU'] ?? DEFAULT_MODELS.haiku,
      sonnet: env['CORELLIA_MODEL_SONNET'] ?? DEFAULT_MODELS.sonnet,
      opus: env['CORELLIA_MODEL_OPUS'] ?? DEFAULT_MODELS.opus,
    },
    // OpenRouter requires the HTTP-Referer header to attribute traffic; the
    // site-url is optional but recommended for rate-limit visibility.
    headers: {
      'HTTP-Referer': 'https://github.com/corellia-factory',
      'X-Title': 'Corellia Factory',
    },
  };
}
