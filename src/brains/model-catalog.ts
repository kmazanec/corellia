/**
 * The model catalog: a capability/cost-tagged registry of concrete models the
 * factory can call, and the deterministic rule that maps a {@link Tier} demand
 * band plus a set of {@link ModelNeeds} onto one {@link ModelSpec}.
 *
 * Why this exists: a tier is an abstract *capability-demand band* (low/mid/high),
 * not a model. Hardwiring one model per band cannot express "this leaf needs
 * vision" or "pick the cheapest model that clears the bar" — a powerful model
 * with no image support is the wrong pick for a screenshot judge even at the high
 * band, and an expensive vision model is waste when no image is in play. The
 * catalog tags each model with capability, cost, context, vision, and
 * tool-calling reliability; {@link resolveModel} filters by need and picks the
 * cheapest satisfying model in the demanded band, falling UP a band (never
 * silently down) when the band has nothing that satisfies.
 *
 * NOTE ON THE NUMBERS: `capability`, `costInPerMtok`, `costOutPerMtok`, and
 * `context` are CATALOG METADATA — approximate, hand-curated signals used only to
 * rank and band models. They are NOT billing truth: real spend comes from the
 * provider's own usage accounting (ADR-017), never from these figures. Treat them
 * as "roughly right, good enough to rank," and correct them when a model's real
 * behaviour disagrees (the per-tier tool-call signal in the trace is the feedback
 * loop for that).
 */

import type { ModelNeeds, Tier } from '../contract/goal.js';

export type { ModelNeeds } from '../contract/goal.js';

/**
 * One concrete model the factory can call, with the metadata needed to rank,
 * band, and route it. An `endpoint` override is what lets a local or alternate
 * provider join the catalog without touching the default config; a `provider`
 * pin carries the same OpenRouter routing shape as the legacy `providerByTier`.
 */
export interface ModelSpec {
  /** The provider-facing model id, e.g. "deepseek/deepseek-v4-pro" or "llama3.1" for a local endpoint. */
  id: string;
  /** Rough general-capability score, 1–10. Catalog metadata for banding, not a benchmark. */
  capability: number;
  /** Approximate USD per Mtok input. Catalog metadata for ranking, not billing truth. */
  costInPerMtok: number;
  /** Approximate USD per Mtok output. Catalog metadata for ranking, not billing truth. */
  costOutPerMtok: number;
  /** Approximate context-window size in tokens. Catalog metadata; used by minContext filtering. */
  context: number;
  /** Whether the model accepts image input (needed for ADR-042 screenshot judging). */
  vision: boolean;
  /** Demonstrated tool-calling reliability, ordered weak < ok < strong. */
  toolCalling: 'weak' | 'ok' | 'strong';
  /**
   * Optional per-model endpoint override. Present → this model is reached at
   * `baseUrl` (with the key from `apiKeyEnv`, if any) instead of the brain's
   * default endpoint. This is what enables local models (Ollama, vLLM) and
   * alternate providers to sit in the same catalog. Absent → the brain's default
   * endpoint (e.g. OpenRouter) serves this model.
   */
  endpoint?: { baseUrl: string; apiKeyEnv?: string };
  /**
   * Optional OpenRouter provider pin, the same shape as the legacy
   * `providerByTier` entry. Present → included as the request's `provider` field,
   * pinning provider order and fallback behaviour for cache affinity.
   */
  provider?: { order: string[]; allow_fallbacks: boolean };
  /** Optional per-model request timeout (ms), overriding the tier default when the model is slow. */
  requestTimeoutMs?: number;
}

/**
 * The band a capability score falls into. FIXED thresholds, not tertiles of the
 * current catalog, so a model's band is a property of the model alone and does
 * not shift as catalog entries are added or removed:
 *   low  = capability 1–3   (cheap, fast, weak-to-ok reasoning)
 *   mid  = capability 4–6   (the workhorse band)
 *   high = capability 7–10  (the strongest, most expensive band)
 * A score outside 1–10 clamps into range (≤3 → low, ≥7 → high).
 */
export function bandForCapability(capability: number): Tier {
  if (capability <= 3) return 'low';
  if (capability >= 7) return 'high';
  return 'mid';
}

/** Bands in ascending demand order, used to fall UPWARD from a demanded band. */
const BANDS_ASCENDING: readonly Tier[] = ['low', 'mid', 'high'] as const;

/** tool-calling reliability as an orderable rank so `minToolCalling` is a `>=` test. */
const TOOL_CALLING_RANK: Record<ModelSpec['toolCalling'], number> = {
  weak: 0,
  ok: 1,
  strong: 2,
};

/**
 * The baseline needs applied to AUTOMATIC resolution: the factory's work is
 * tool-loop- and structured-emit-heavy, so a model tagged toolCalling 'weak'
 * is never auto-selected — it is reachable only through an explicit operator
 * pin (pins bypass this floor) or a CORELLIA_MODELS_JSON re-tag. Callers fold
 * this under their own needs so an explicit minToolCalling still wins.
 */
export const BASELINE_NEEDS: ModelNeeds = { minToolCalling: 'ok' };

/** True when a spec satisfies every present need. An absent need does not constrain. */
export function satisfiesNeeds(spec: ModelSpec, needs: ModelNeeds | undefined): boolean {
  if (!needs) return true;
  if (needs.vision === true && !spec.vision) return false;
  if (needs.minContext !== undefined && spec.context < needs.minContext) return false;
  if (
    needs.minToolCalling !== undefined &&
    TOOL_CALLING_RANK[spec.toolCalling] < TOOL_CALLING_RANK[needs.minToolCalling]
  ) {
    return false;
  }
  return true;
}

/**
 * A blended per-Mtok cost used to rank "cheapest" within a band. A rough
 * input+output blend (weighted toward output, which dominates generation spend)
 * so a model that is cheap on input but expensive on output does not falsely win.
 * Ranking-only — never a billing figure.
 */
function blendedCost(spec: ModelSpec): number {
  return spec.costInPerMtok + spec.costOutPerMtok * 3;
}

/**
 * Resolve one concrete {@link ModelSpec} for a `(tier, needs)` demand against a
 * catalog. Deterministic:
 *
 *   1. Filter the catalog to models satisfying every present need.
 *   2. Band each survivor by its capability score ({@link bandForCapability}).
 *   3. Starting at the demanded `tier` and walking UPWARD (low→mid→high), return
 *      the CHEAPEST satisfying model in the first non-empty band. Never fall
 *      downward: a call that demanded `high` must not be served by a `low` model.
 *   4. If no band from the demanded tier upward has a satisfying model, throw —
 *      the catalog cannot meet this demand and silently degrading would hide it.
 *
 * Ties on blended cost break by higher capability, then by id, so resolution is
 * fully deterministic for a given catalog.
 */
export function resolveModel(
  tier: Tier,
  needs: ModelNeeds | undefined,
  catalog: ModelSpec[],
): ModelSpec {
  const satisfying = catalog.filter((spec) => satisfiesNeeds(spec, needs));
  if (satisfying.length === 0) {
    throw new Error(
      `No model in the catalog (${catalog.length} entries) satisfies the required ` +
        `needs (${describeNeeds(needs)}). Add a satisfying model to CORELLIA_MODELS_JSON ` +
        `or relax the need.`,
    );
  }

  const startIdx = BANDS_ASCENDING.indexOf(tier);
  for (let i = startIdx; i < BANDS_ASCENDING.length; i++) {
    const band = BANDS_ASCENDING[i]!;
    const inBand = satisfying.filter((spec) => bandForCapability(spec.capability) === band);
    if (inBand.length > 0) {
      return pickCheapest(inBand);
    }
  }

  // Every band from the demanded tier upward is empty (but SOME model satisfied
  // the needs — it just banded below the demand). Falling downward is forbidden,
  // so this is a genuine "catalog too weak for this demand band" error.
  throw new Error(
    `No model at tier "${tier}" or above satisfies the required needs ` +
      `(${describeNeeds(needs)}); ${satisfying.length} model(s) satisfy the needs but all ` +
      `band below "${tier}". Add a stronger satisfying model to the catalog.`,
  );
}

/** Pick the cheapest spec, breaking ties by higher capability then lexical id. */
function pickCheapest(specs: ModelSpec[]): ModelSpec {
  return [...specs].sort((a, b) => {
    const costDelta = blendedCost(a) - blendedCost(b);
    if (costDelta !== 0) return costDelta;
    if (a.capability !== b.capability) return b.capability - a.capability;
    return a.id.localeCompare(b.id);
  })[0]!;
}

function describeNeeds(needs: ModelNeeds | undefined): string {
  if (!needs) return 'none';
  const parts: string[] = [];
  if (needs.vision === true) parts.push('vision');
  if (needs.minContext !== undefined) parts.push(`minContext=${needs.minContext}`);
  if (needs.minToolCalling !== undefined) parts.push(`minToolCalling=${needs.minToolCalling}`);
  return parts.length > 0 ? parts.join(', ') : 'none';
}

/**
 * The default catalog: today's three tier defaults plus OpenRouter-reachable
 * alternatives across the cost/capability spectrum. Costs and context are
 * APPROXIMATE catalog metadata (see the module note), current as of mid-2026 and
 * meant to be corrected as models and prices move. Every entry here is reachable
 * on the brain's default endpoint (OpenRouter) — a local or alternate-provider
 * model joins via `CORELLIA_MODELS_JSON` with an `endpoint` override.
 */
export const DEFAULT_CATALOG: readonly ModelSpec[] = [
  // ── low band (capability 1–3): cheap, fast, for well-specified leaf work ──
  {
    id: 'deepseek/deepseek-v4-flash',
    capability: 3,
    costInPerMtok: 0.14,
    costOutPerMtok: 0.28,
    context: 128_000,
    vision: false,
    toolCalling: 'ok',
  },
  {
    id: 'google/gemini-2.5-flash',
    capability: 3,
    costInPerMtok: 0.3,
    costOutPerMtok: 2.5,
    context: 1_000_000,
    vision: true,
    toolCalling: 'ok',
  },
  {
    // toolCalling re-tagged 'weak' from live evidence (2026-07-07 daemon proof
    // runs 2-3): as the unpinned low/mid defaults, the qwen entries stalled
    // 4-12 minutes per structured call and no real work happened; the same
    // intents on the deepseek trio built and characterized within minutes.
    // 'weak' excludes them from automatic selection (the resolution floor is
    // minToolCalling 'ok'); an explicit pin or CORELLIA_MODELS_JSON re-tag can
    // still opt in.
    id: 'qwen/qwen3-30b-a3b',
    capability: 2,
    costInPerMtok: 0.08,
    costOutPerMtok: 0.29,
    context: 128_000,
    vision: false,
    toolCalling: 'weak',
  },
  // ── mid band (capability 4–6): the workhorse band ──
  {
    id: 'deepseek/deepseek-v4-pro',
    capability: 6,
    costInPerMtok: 0.55,
    costOutPerMtok: 2.19,
    context: 384_000,
    vision: false,
    toolCalling: 'strong',
  },
  {
    // 'weak' per the same 2026-07-07 live evidence as qwen3-30b above.
    id: 'qwen/qwen3-235b-a22b',
    capability: 5,
    costInPerMtok: 0.2,
    costOutPerMtok: 0.85,
    context: 256_000,
    vision: false,
    toolCalling: 'weak',
  },
  {
    id: 'moonshotai/kimi-k2',
    capability: 6,
    costInPerMtok: 0.55,
    costOutPerMtok: 2.2,
    context: 200_000,
    vision: false,
    toolCalling: 'strong',
  },
  {
    id: 'anthropic/claude-haiku-4.5',
    capability: 5,
    costInPerMtok: 1.0,
    costOutPerMtok: 5.0,
    context: 200_000,
    vision: true,
    toolCalling: 'strong',
  },
  // ── high band (capability 7–10): strongest, most expensive; vision here too ──
  {
    id: 'z-ai/glm-5.2',
    capability: 7,
    costInPerMtok: 0.6,
    costOutPerMtok: 2.2,
    context: 200_000,
    vision: false,
    toolCalling: 'strong',
  },
  {
    id: 'anthropic/claude-sonnet-4.5',
    capability: 8,
    costInPerMtok: 3.0,
    costOutPerMtok: 15.0,
    context: 200_000,
    vision: true,
    toolCalling: 'strong',
  },
  {
    id: 'google/gemini-2.5-pro',
    capability: 8,
    costInPerMtok: 1.25,
    costOutPerMtok: 10.0,
    context: 1_000_000,
    vision: true,
    toolCalling: 'strong',
  },
  {
    id: 'anthropic/claude-opus-4.8',
    capability: 10,
    costInPerMtok: 5.0,
    costOutPerMtok: 25.0,
    context: 200_000,
    vision: true,
    toolCalling: 'strong',
  },
] as const;

// ---------------------------------------------------------------------------
// Catalog assembly from env: default catalog + CORELLIA_MODELS_JSON + legacy pins
// ---------------------------------------------------------------------------

/**
 * The result of assembling a catalog from the environment: the merged catalog and
 * the per-band preferred model id each `CORELLIA_MODEL_LOW/_MID/_HIGH` pin (or the
 * banded default) resolves to. `pins` populates the legacy `modelByTier` so the
 * many engine sites that read `config.modelByTier[tier]` for provenance keep
 * working, and so a pin forces that exact model at its band.
 */
export interface AssembledCatalog {
  catalog: ModelSpec[];
  pins: Record<Tier, string>;
}

/**
 * Parse `CORELLIA_MODELS_JSON` into an array of partial {@link ModelSpec}s.
 * The value is either inline JSON (starts with `[`) or a path to a JSON file.
 * Entries merge into the catalog by `id` (see {@link assembleCatalog}). A
 * malformed value throws with a clear message rather than silently ignoring the
 * override — a broken catalog config should fail loud, not run on defaults.
 */
export function parseModelsJson(
  raw: string,
  readFile: (path: string) => string,
): Partial<ModelSpec>[] {
  const trimmed = raw.trim();
  const text = trimmed.startsWith('[') ? trimmed : readFile(trimmed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `CORELLIA_MODELS_JSON is neither valid inline JSON nor a readable JSON file ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('CORELLIA_MODELS_JSON must be a JSON array of model specs.');
  }
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') {
      throw new Error('Every CORELLIA_MODELS_JSON entry must be an object with a string "id".');
    }
  }
  return parsed as Partial<ModelSpec>[];
}

/**
 * Conservative default tags applied when a legacy `CORELLIA_MODEL_<BAND>` pin
 * names a model id not present in the catalog: a bare entry is added so the pin
 * resolves, tagged to sit in the pinned band with the weakest safe assumptions
 * (no vision, ok tool-calling, a modest context). The operator can always give it
 * real tags via `CORELLIA_MODELS_JSON`.
 */
function bareEntryForBand(id: string, band: Tier): ModelSpec {
  const capability: Record<Tier, number> = { low: 3, mid: 5, high: 8 };
  return {
    id,
    capability: capability[band],
    costInPerMtok: 1.0,
    costOutPerMtok: 3.0,
    context: 128_000,
    vision: false,
    toolCalling: 'ok',
  };
}

/**
 * Assemble the runtime catalog and per-band pins from the environment.
 *
 * Layering (later overrides earlier, by id):
 *   1. {@link DEFAULT_CATALOG}.
 *   2. `CORELLIA_MODELS_JSON` entries — merged by id (a partial entry patches the
 *      matching default's fields; a new id is appended). This is the extend/replace
 *      surface, and where a local-model `endpoint` override lives.
 *
 * Per-band pins (`CORELLIA_MODEL_LOW/_MID/_HIGH`): each names the PREFERRED model
 * id for its band. When the id is unknown to the assembled catalog, a bare entry
 * with conservative tags is added ({@link bareEntryForBand}) so the pin resolves.
 * When no pin is set for a band, the band's pin is the banded default:
 * {@link resolveModel}(band, no-needs, catalog).id — the cheapest satisfying model
 * in that band. Pins are silent (no per-var warning); only a genuinely empty band
 * would surface a resolution error downstream.
 */
export function assembleCatalog(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string,
): AssembledCatalog {
  const byId = new Map<string, ModelSpec>();
  for (const spec of DEFAULT_CATALOG) byId.set(spec.id, { ...spec });

  const modelsJson = env['CORELLIA_MODELS_JSON'];
  if (modelsJson !== undefined && modelsJson.trim().length > 0) {
    for (const patch of parseModelsJson(modelsJson, readFile)) {
      const existing = byId.get(patch.id!);
      byId.set(patch.id!, existing ? { ...existing, ...patch } : fillSpecDefaults(patch));
    }
  }

  const pinVars: Record<Tier, string> = {
    low: 'CORELLIA_MODEL_LOW',
    mid: 'CORELLIA_MODEL_MID',
    high: 'CORELLIA_MODEL_HIGH',
  };
  const pins = {} as Record<Tier, string>;
  for (const band of BANDS_ASCENDING) {
    const pinned = env[pinVars[band]];
    if (pinned !== undefined && pinned.length > 0) {
      if (!byId.has(pinned)) byId.set(pinned, bareEntryForBand(pinned, band));
      pins[band] = pinned;
    }
  }

  const catalog = [...byId.values()];

  // Fill any band whose pin was not explicitly set with the banded default —
  // under the BASELINE_NEEDS floor, so a 'weak' model never becomes a default.
  for (const band of BANDS_ASCENDING) {
    if (pins[band] === undefined) pins[band] = resolveModel(band, BASELINE_NEEDS, catalog).id;
  }

  return { catalog, pins };
}

/**
 * Complete a partial spec (a brand-new id from `CORELLIA_MODELS_JSON` that
 * patched no default) into a full {@link ModelSpec} with conservative defaults
 * for any field the operator omitted. A new entry that gives only `id` and
 * `endpoint` (the local-model case) is fully usable: capability 5 (mid band),
 * no vision, ok tool-calling.
 */
function fillSpecDefaults(patch: Partial<ModelSpec>): ModelSpec {
  return {
    id: patch.id!,
    capability: patch.capability ?? 5,
    costInPerMtok: patch.costInPerMtok ?? 1.0,
    costOutPerMtok: patch.costOutPerMtok ?? 3.0,
    context: patch.context ?? 128_000,
    vision: patch.vision ?? false,
    toolCalling: patch.toolCalling ?? 'ok',
    ...(patch.endpoint !== undefined ? { endpoint: patch.endpoint } : {}),
    ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
    ...(patch.requestTimeoutMs !== undefined ? { requestTimeoutMs: patch.requestTimeoutMs } : {}),
  };
}
