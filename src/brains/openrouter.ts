/**
 * OpenRouter config for LlmBrain. The concrete model per call comes from the
 * capability/cost-tagged catalog (ADR-044), assembled from the default catalog
 * plus the env override surface:
 *   OPENROUTER_API_KEY  — required
 *   CORELLIA_MODELS_JSON — inline JSON array or a path to a JSON file; entries
 *     merge into the default catalog by id (extend or replace). This is where a
 *     local-model `endpoint` override lives.
 *   CORELLIA_MODEL_LOW / _MID / _HIGH — legacy per-band pins: each names the
 *     preferred model id for that band (backward compatible). Also populates
 *     `modelByTier`, read by engine sites reporting the resolved model on events.
 */

import { readFileSync } from 'node:fs';
import type { LlmBrainConfig } from './llm.js';
import { assembleCatalog } from './model-catalog.js';

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

  // Assemble the catalog and per-band pins from the env. A missing pin resolves to
  // the banded default silently — the catalog always has an entry per band, so
  // there is nothing to warn about (unlike the old one-model-per-var scheme, an
  // unset var is not a "missing model", just "use the band's cheapest default").
  const { catalog, pins } = assembleCatalog(env, (path) => readFileSync(path, 'utf8'));

  return {
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey,
    catalog,
    // The pins double as the legacy `modelByTier` map: the band's preferred model
    // id, read by engine sites that report the resolved model on events.
    modelByTier: pins,
    // OpenRouter requires the HTTP-Referer header to attribute traffic; the
    // site-url is optional but recommended for rate-limit visibility.
    headers: {
      'HTTP-Referer': 'https://github.com/corellia-factory',
      'X-Title': 'Corellia Factory',
    },
  };
}
