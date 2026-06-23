/**
 * OpenRouter config for LlmBrain. Per-tier model comes from the env; a default
 * is used only with a warning if a var is unset.
 *   OPENROUTER_API_KEY  — required
 *   CORELLIA_MODEL_LOW / _MID / _HIGH — model ID per tier
 */

import type { LlmBrainConfig } from './llm.js';

/** Fallback model per tier, used only when the matching env var is unset. */
const DEFAULT_MODELS = {
  low: 'deepseek/deepseek-v4-flash',
  mid: 'deepseek/deepseek-v4-pro',
  high: 'z-ai/glm-5.2',
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

  // .env is the source of truth; fall back to a default only with a loud warning.
  const resolveTier = (tier: 'low' | 'mid' | 'high', envVar: string): string => {
    const fromEnv = env[envVar];
    if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
    const fallback = DEFAULT_MODELS[tier];
    console.warn(`[corellia] ${envVar} unset — using default ${tier} model "${fallback}".`);
    return fallback;
  };

  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
    modelByTier: {
      low: resolveTier('low', 'CORELLIA_MODEL_LOW'),
      mid: resolveTier('mid', 'CORELLIA_MODEL_MID'),
      high: resolveTier('high', 'CORELLIA_MODEL_HIGH'),
    },
    // OpenRouter requires the HTTP-Referer header to attribute traffic; the
    // site-url is optional but recommended for rate-limit visibility.
    headers: {
      'HTTP-Referer': 'https://github.com/corellia-factory',
      'X-Title': 'Corellia Factory',
    },
  };
}
