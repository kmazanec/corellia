/**
 * Tests for the model catalog (ADR-044): needs filtering, capability banding,
 * cheapest-in-band pick, upward fallback, the throw when nothing satisfies, and
 * the env-driven catalog assembly (CORELLIA_MODELS_JSON merge + legacy pins).
 * No network — these are pure functions over an injected catalog/env.
 */

import { describe, it, expect } from 'vitest';
import {
  assembleCatalog,
  bandForCapability,
  DEFAULT_CATALOG,
  parseModelsJson,
  resolveModel,
  satisfiesNeeds,
  type ModelSpec,
} from '../../src/brains/model-catalog.js';

// A small, fully-controlled catalog so band boundaries and costs are explicit.
function spec(overrides: Partial<ModelSpec> & { id: string }): ModelSpec {
  return {
    capability: 5,
    costInPerMtok: 1,
    costOutPerMtok: 1,
    context: 100_000,
    vision: false,
    toolCalling: 'ok',
    ...overrides,
  };
}

describe('bandForCapability', () => {
  it('bands 1–3 as low, 4–6 as mid, 7–10 as high', () => {
    expect(bandForCapability(1)).toBe('low');
    expect(bandForCapability(3)).toBe('low');
    expect(bandForCapability(4)).toBe('mid');
    expect(bandForCapability(6)).toBe('mid');
    expect(bandForCapability(7)).toBe('high');
    expect(bandForCapability(10)).toBe('high');
  });

  it('clamps out-of-range scores into the nearest band', () => {
    expect(bandForCapability(0)).toBe('low');
    expect(bandForCapability(99)).toBe('high');
  });
});

describe('satisfiesNeeds', () => {
  it('passes everything when needs is undefined', () => {
    expect(satisfiesNeeds(spec({ id: 'a', vision: false }), undefined)).toBe(true);
  });

  it('filters out a non-vision model when vision is required', () => {
    expect(satisfiesNeeds(spec({ id: 'a', vision: false }), { vision: true })).toBe(false);
    expect(satisfiesNeeds(spec({ id: 'b', vision: true }), { vision: true })).toBe(true);
  });

  it('enforces minContext', () => {
    expect(satisfiesNeeds(spec({ id: 'a', context: 50_000 }), { minContext: 100_000 })).toBe(false);
    expect(satisfiesNeeds(spec({ id: 'b', context: 200_000 }), { minContext: 100_000 })).toBe(true);
  });

  it('enforces minToolCalling as an ordered floor', () => {
    expect(satisfiesNeeds(spec({ id: 'a', toolCalling: 'weak' }), { minToolCalling: 'ok' })).toBe(false);
    expect(satisfiesNeeds(spec({ id: 'b', toolCalling: 'ok' }), { minToolCalling: 'ok' })).toBe(true);
    expect(satisfiesNeeds(spec({ id: 'c', toolCalling: 'ok' }), { minToolCalling: 'strong' })).toBe(false);
    expect(satisfiesNeeds(spec({ id: 'd', toolCalling: 'strong' }), { minToolCalling: 'strong' })).toBe(true);
  });
});

describe('resolveModel — banding + cheapest-in-band', () => {
  const catalog = [
    spec({ id: 'cheap-low', capability: 2, costInPerMtok: 0.1, costOutPerMtok: 0.1 }),
    spec({ id: 'dear-low', capability: 2, costInPerMtok: 5, costOutPerMtok: 5 }),
    spec({ id: 'cheap-mid', capability: 5, costInPerMtok: 0.5, costOutPerMtok: 0.5 }),
    spec({ id: 'dear-mid', capability: 5, costInPerMtok: 3, costOutPerMtok: 3 }),
    spec({ id: 'only-high', capability: 9, costInPerMtok: 8, costOutPerMtok: 8 }),
  ];

  it('picks the cheapest model in the demanded band', () => {
    expect(resolveModel('low', undefined, catalog).id).toBe('cheap-low');
    expect(resolveModel('mid', undefined, catalog).id).toBe('cheap-mid');
    expect(resolveModel('high', undefined, catalog).id).toBe('only-high');
  });

  it('weights output cost so a cheap-input/dear-output model does not falsely win', () => {
    const c = [
      spec({ id: 'low-in-high-out', capability: 5, costInPerMtok: 0.1, costOutPerMtok: 10 }),
      spec({ id: 'balanced', capability: 5, costInPerMtok: 1, costOutPerMtok: 1 }),
    ];
    // blended = in + out*3: low-in-high-out = 30.1, balanced = 4 → balanced wins.
    expect(resolveModel('mid', undefined, c).id).toBe('balanced');
  });
});

describe('resolveModel — upward fallback, never downward', () => {
  it('falls UP to the next band when the demanded band has no satisfying model', () => {
    const catalog = [
      spec({ id: 'low-only', capability: 2, vision: false }),
      spec({ id: 'mid-vision', capability: 5, vision: true }),
    ];
    // Demand low + vision: no low-band vision model, so fall up to mid.
    expect(resolveModel('low', { vision: true }, catalog).id).toBe('mid-vision');
  });

  it('never falls downward: a high demand is not served by a lower band', () => {
    const catalog = [spec({ id: 'low-vision', capability: 2, vision: true })];
    // Only satisfying model bands LOW; a HIGH demand must throw, not downgrade.
    expect(() => resolveModel('high', { vision: true }, catalog)).toThrow(/band below "high"/);
  });

  it('throws when NO model in the whole catalog satisfies the needs', () => {
    const catalog = [spec({ id: 'no-vision', capability: 5, vision: false })];
    expect(() => resolveModel('low', { vision: true }, catalog)).toThrow(/No model in the catalog/);
  });
});

describe('parseModelsJson', () => {
  const noFile = (): string => {
    throw new Error('should not read a file for inline JSON');
  };

  it('parses inline JSON array', () => {
    const out = parseModelsJson('[{"id":"x/y","capability":4}]', noFile);
    expect(out).toEqual([{ id: 'x/y', capability: 4 }]);
  });

  it('reads a file path when the value is not inline JSON', () => {
    const out = parseModelsJson('/etc/models.json', () => '[{"id":"from/file"}]');
    expect(out).toEqual([{ id: 'from/file' }]);
  });

  it('throws when the resolved JSON is not an array', () => {
    // A value not starting with `[` is treated as a file path; the file's content
    // here is a JSON object, not an array.
    expect(() => parseModelsJson('/etc/models.json', () => '{"id":"x"}')).toThrow(/must be a JSON array/);
  });

  it('throws when an entry has no string id', () => {
    expect(() => parseModelsJson('[{"capability":5}]', noFile)).toThrow(/string "id"/);
  });

  it('throws on unparseable input', () => {
    expect(() => parseModelsJson('not json at all', () => 'still not json')).toThrow(
      /neither valid inline JSON nor a readable JSON file/,
    );
  });
});

describe('assembleCatalog — default + MODELS_JSON merge + legacy pins', () => {
  const noFile = (p: string): string => {
    throw new Error(`unexpected file read: ${p}`);
  };

  it('returns the default catalog and banded-default pins with an empty env', () => {
    const { catalog, pins } = assembleCatalog({}, noFile);
    expect(catalog).toHaveLength(DEFAULT_CATALOG.length);
    // Each pin is the cheapest satisfying model in its band (no explicit pin set).
    expect(pins.high).toBe('z-ai/glm-5.2');
    // The BASELINE_NEEDS floor excludes 'weak'-tagged models (the qwen entries,
    // re-tagged from 2026-07-07 live evidence) from banded defaults.
    expect(pins.low).toBe('deepseek/deepseek-v4-flash');
    expect(pins.mid).toBe('deepseek/deepseek-v4-pro');
  });

  it('patches an existing default entry by id (partial merge)', () => {
    const { catalog } = assembleCatalog(
      { CORELLIA_MODELS_JSON: '[{"id":"z-ai/glm-5.2","costInPerMtok":0.01,"costOutPerMtok":0.01}]' },
      noFile,
    );
    const glm = catalog.find((s) => s.id === 'z-ai/glm-5.2')!;
    expect(glm.costInPerMtok).toBe(0.01);
    // Untouched fields survive the patch.
    expect(glm.capability).toBe(7);
    expect(glm.toolCalling).toBe('strong');
  });

  it('appends a brand-new entry with conservative defaults for omitted fields', () => {
    const { catalog } = assembleCatalog(
      { CORELLIA_MODELS_JSON: '[{"id":"local/llama","endpoint":{"baseUrl":"http://localhost:11434/v1"}}]' },
      noFile,
    );
    const local = catalog.find((s) => s.id === 'local/llama')!;
    expect(local.endpoint?.baseUrl).toBe('http://localhost:11434/v1');
    expect(local.capability).toBe(5); // default mid
    expect(local.vision).toBe(false);
    expect(local.toolCalling).toBe('ok');
  });

  it('a legacy pin forces that model id for its band', () => {
    const { pins } = assembleCatalog({ CORELLIA_MODEL_HIGH: 'deepseek/deepseek-v4-pro' }, noFile);
    expect(pins.high).toBe('deepseek/deepseek-v4-pro');
  });

  it('a legacy pin for an unknown id adds a bare entry so it resolves', () => {
    const { catalog, pins } = assembleCatalog({ CORELLIA_MODEL_LOW: 'my/private-model' }, noFile);
    expect(pins.low).toBe('my/private-model');
    const added = catalog.find((s) => s.id === 'my/private-model')!;
    expect(added).toBeDefined();
    expect(bandForCapability(added.capability)).toBe('low');
  });
});
