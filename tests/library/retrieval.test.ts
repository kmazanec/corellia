/**
 * Tests for the five retrieval library functions (ACs 1–5) and the
 * retrievalTools broker-registration factory.
 *
 * Uses a fixture repo created in a temp directory for symbol/stack tests, and
 * synthetic knowledge artifacts and import graphs for exemplar/conventions/
 * impact tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findSymbol,
  findExemplar,
  conventionsFor,
  stackVersions,
  impact,
  retrievalTools,
  type RetrievalDeps,
  type ImportGraph,
} from '../../src/library/retrieval.js';
import type { KnowledgeArtifact } from '../../src/contract/knowledge.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'corellia-retrieval-test-'));
});

afterEach(async () => {
  await rm(repoRoot, { recursive: true, force: true });
});

function makeDeps(overrides: Partial<RetrievalDeps> = {}): RetrievalDeps {
  return { repoRoot, ...overrides };
}

function makeConventionsArtifact(overrides: Partial<KnowledgeArtifact> = {}): KnowledgeArtifact {
  return {
    repoRoot,
    category: 'conventions',
    generatedAtSha: 'abc123',
    confidence: 'high',
    status: 'trusted',
    pointers: [
      { path: 'src/auth/login.ts', line: 10, note: 'canonical auth pattern' },
      { path: 'src/api/handler.ts', note: 'REST handler conventions' },
    ],
    summary: 'Auth uses JWT; REST handlers follow express conventions.',
    ...overrides,
  };
}

function makeImportGraph(overrides: Partial<ImportGraph> = {}): ImportGraph {
  return {
    scannedAtSha: 'sha1',
    edges: {
      'src/index.ts': ['src/lib/a.ts', 'src/lib/b.ts'],
      'src/lib/a.ts': ['src/lib/util.ts'],
      'tests/a.test.ts': ['src/lib/a.ts'],
      'tests/b.test.ts': ['src/lib/b.ts'],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// find_symbol
// ---------------------------------------------------------------------------

describe('find_symbol', () => {
  it('finds a function definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'index.ts'), [
      'export function greet(name: string): string {',
      '  return `Hello ${name}`;',
      '}',
    ].join('\n'));

    const result = await findSymbol('greet', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.path).toBe('src/index.ts');
    expect(result.data[0]?.line).toBe(1);
    expect(result.text).toContain('src/index.ts:1:');
  });

  it('finds a class definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'broker.ts'), [
      'export class Broker {',
      '  constructor() {}',
      '}',
    ].join('\n'));

    const result = await findSymbol('Broker', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/broker.ts:1:');
  });

  it('finds a const definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'config.ts'), 'export const MAX_RETRIES = 3;\n');

    const result = await findSymbol('MAX_RETRIES', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/config.ts:1:');
  });

  it('finds an interface definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'types.ts'), 'export interface GoalType {\n  name: string;\n}\n');

    const result = await findSymbol('GoalType', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/types.ts:1:');
  });

  it('finds a type alias definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'types.ts'), 'export type Status = "ok" | "fail";\n');

    const result = await findSymbol('Status', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/types.ts:1:');
  });

  it('returns honest no-definition message when symbol not found', async () => {
    const result = await findSymbol('NonExistentSymbol', makeDeps());
    expect(result.data).toHaveLength(0);
    expect(result.text).toContain('NonExistentSymbol');
  });

  it('returns results in deterministic (sorted) order', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'b.ts'), 'export function compute() {}\n');
    await writeFile(join(repoRoot, 'src', 'a.ts'), 'export function compute() {}\n');

    const result = await findSymbol('compute', makeDeps());
    const paths = result.data.map((r) => r.path);
    expect(paths).toEqual([...paths].sort());
  });

  it('text lines are path:line: prefixed', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'foo.ts'), 'export function doThing() {}\n');

    const result = await findSymbol('doThing', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    const firstLine = result.text.split('\n')[0];
    expect(firstLine).toMatch(/^src\/foo\.ts:\d+:/);
  });

  it('handles empty name gracefully', async () => {
    const result = await findSymbol('', makeDeps());
    expect(result.text).toContain('non-empty');
    expect(result.data).toHaveLength(0);
  });

  it('skips node_modules', async () => {
    await mkdir(join(repoRoot, 'node_modules', 'some-lib'), { recursive: true });
    await writeFile(join(repoRoot, 'node_modules', 'some-lib', 'index.ts'), 'export function targetFn() {}\n');

    const result = await findSymbol('targetFn', makeDeps());
    const paths = result.data.map((r) => r.path);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('caps results at 50 and appends the capped notice when matches exceed 50', async () => {
    // Create 60 files each containing one definition of `overloadedFn`.
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    for (let i = 0; i < 60; i++) {
      await writeFile(
        join(repoRoot, 'src', `file${String(i).padStart(3, '0')}.ts`),
        `export function overloadedFn() { return ${i}; }\n`,
      );
    }

    const result = await findSymbol('overloadedFn', makeDeps());
    expect(result.data).toHaveLength(50);
    expect(result.text).toContain('(results capped at 50)');
  });

  it('finds export default function declaration', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(
      join(repoRoot, 'src', 'handler.ts'),
      'export default function handleRequest(req: Request) { return req; }\n',
    );

    const result = await findSymbol('handleRequest', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/handler.ts:1:');
  });

  it('finds arrow-const definition', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(
      join(repoRoot, 'src', 'utils.ts'),
      'export const formatDate = (d: Date): string => d.toISOString();\n',
    );

    const result = await findSymbol('formatDate', makeDeps());
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('src/utils.ts:1:');
  });
});

// ---------------------------------------------------------------------------
// find_exemplar
// ---------------------------------------------------------------------------

describe('find_exemplar', () => {
  it('returns pointers from conventions artifact when pattern matches path', async () => {
    const deps = makeDeps({
      knowledge: () => [makeConventionsArtifact()],
    });
    const result = await findExemplar('auth', deps);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.source).toBe('artifact');
    expect(result.data[0]?.path).toContain('auth');
    expect(result.text).toContain('src/auth/login.ts');
  });

  it('returns pointers from conventions artifact when pattern matches note', async () => {
    const deps = makeDeps({
      knowledge: () => [makeConventionsArtifact()],
    });
    const result = await findExemplar('REST handler', deps);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0]?.source).toBe('artifact');
    expect(result.data[0]?.path).toContain('api');
  });

  it('falls back to content search when artifact has no matching pointers', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'widget.ts'), 'export const WIDGET_PATTERN = "blue";\n');
    const deps = makeDeps({
      knowledge: () => [makeConventionsArtifact()],
    });
    const result = await findExemplar('WIDGET_PATTERN', deps);
    expect(result.text).toContain('falling back to content search');
    const contentMatches = result.data.filter((d) => d.source === 'content-search');
    expect(contentMatches.length).toBeGreaterThan(0);
    expect(contentMatches[0]?.path).toBe('src/widget.ts');
  });

  it('reports no conventions artifact honestly when knowledge not provided', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'sample.ts'), 'export function sample() {}\n');
    const deps = makeDeps({ knowledge: () => [] });
    const result = await findExemplar('sample', deps);
    expect(result.text).toContain('no conventions artifact');
  });

  it('reports no conventions artifact when deps.knowledge is absent', async () => {
    const deps = makeDeps();
    const result = await findExemplar('anything', deps);
    expect(result.text).toContain('no conventions artifact');
  });

  it('never invents an answer — returns empty data when nothing matches', async () => {
    const deps = makeDeps({ knowledge: () => [] });
    const result = await findExemplar('completely_unmatched_xyz', deps);
    expect(result.data).toHaveLength(0);
    expect(result.text).not.toMatch(/^(function|class|const)/);
  });

  it('handles empty pattern gracefully', async () => {
    const deps = makeDeps({ knowledge: () => [] });
    const result = await findExemplar('', deps);
    expect(result.text).toContain('non-empty');
    expect(result.data).toHaveLength(0);
  });

  it('does not throw on invalid regex — falls back to escaped-literal search', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'example.ts'), 'export const x = 1;\n');
    const deps = makeDeps({ knowledge: () => [] });
    // '[unclosed' is an invalid regex; the function must not throw and must return a result.
    await expect(findExemplar('[unclosed', deps)).resolves.toBeDefined();
    const result = await findExemplar('[unclosed', deps);
    expect(typeof result.text).toBe('string');
    expect(result.data).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// conventions_for
// ---------------------------------------------------------------------------

describe('conventions_for', () => {
  it('returns relevant pointers for a surface that matches', async () => {
    const deps = makeDeps({ knowledge: () => [makeConventionsArtifact()] });
    const result = await conventionsFor('auth', deps);
    expect(result.data.found).toBe(true);
    expect(result.data.pointers.length).toBeGreaterThan(0);
    expect(result.data.pointers[0]?.path).toContain('auth');
    expect(result.text).toContain('src/auth/login.ts');
  });

  it('reports trusted freshness in text', async () => {
    const deps = makeDeps({ knowledge: () => [makeConventionsArtifact({ status: 'trusted' })] });
    const result = await conventionsFor('auth', deps);
    expect(result.text).toContain('trusted');
    expect(result.data.fresh).toBe(true);
  });

  it('reports provisional freshness in text', async () => {
    const deps = makeDeps({ knowledge: () => [makeConventionsArtifact({ status: 'provisional' })] });
    const result = await conventionsFor('auth', deps);
    expect(result.text).toContain('provisional');
    expect(result.data.fresh).toBe(false);
  });

  it('states absent artifact when no conventions artifact exists', async () => {
    const deps = makeDeps({ knowledge: () => [] });
    const result = await conventionsFor('api', deps);
    expect(result.data.found).toBe(false);
    expect(result.text).toContain('no conventions artifact');
  });

  it('states absent artifact when knowledge dep is not provided', async () => {
    const deps = makeDeps();
    const result = await conventionsFor('api', deps);
    expect(result.data.found).toBe(false);
    expect(result.text).toContain('no conventions artifact');
  });

  it('reports no-match when artifact present but surface has no pointers', async () => {
    const deps = makeDeps({ knowledge: () => [makeConventionsArtifact()] });
    const result = await conventionsFor('database', deps);
    expect(result.data.found).toBe(true);
    expect(result.data.pointers).toHaveLength(0);
    expect(result.text).toContain('no pointers matched');
  });

  it('includes the generatedAtSha in data', async () => {
    const deps = makeDeps({ knowledge: () => [makeConventionsArtifact()] });
    const result = await conventionsFor('auth', deps);
    expect(result.data.generatedAtSha).toBe('abc123');
  });

  it('handles empty surface gracefully', async () => {
    const deps = makeDeps({ knowledge: () => [] });
    const result = await conventionsFor('', deps);
    expect(result.text).toContain('non-empty');
    expect(result.data.found).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stack_versions
// ---------------------------------------------------------------------------

describe('stack_versions', () => {
  it('parses package.json dependencies into name→version text', async () => {
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({
        dependencies: { express: '^4.18.0', pg: '^8.0.0' },
        devDependencies: { typescript: '^5.0.0' },
      }),
    );

    const result = await stackVersions(makeDeps());
    expect(result.data.source).toBe('package.json');
    expect(result.data.versions['express']).toBe('^4.18.0');
    expect(result.data.versions['typescript']).toBe('^5.0.0');
    expect(result.text).toContain('express: ^4.18.0');
  });

  it('uses lockfile-v1 resolved versions when lockfileVersion is 1', async () => {
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ dependencies: { express: '^4.18.0' } }),
    );
    await writeFile(
      join(repoRoot, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          express: { version: '4.18.2' },
          'body-parser': { version: '1.20.1' },
        },
      }),
    );

    const result = await stackVersions(makeDeps());
    expect(result.data.source).toBe('lockfile-v1');
    expect(result.data.versions['express']).toBe('4.18.2');
    expect(result.text).toContain('lockfile-v1');
    expect(result.text).toContain('express: 4.18.2');
  });

  it('falls back to package.json when lockfile is v2 (not v1)', async () => {
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ dependencies: { vitest: '^2.0.0' } }),
    );
    await writeFile(
      join(repoRoot, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 2, packages: {} }),
    );

    const result = await stackVersions(makeDeps());
    expect(result.data.source).toBe('package.json');
    expect(result.data.versions['vitest']).toBe('^2.0.0');
  });

  it('generic fallback lists manifest files when no package.json present', async () => {
    await writeFile(join(repoRoot, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');

    const result = await stackVersions(makeDeps());
    expect(result.data.source).toBe('manifest-list');
    expect(result.data.manifestFiles).toContain('go.mod');
    expect(result.text).toContain('go.mod');
  });

  it('reports no manifest when repo has none', async () => {
    const result = await stackVersions(makeDeps());
    expect(result.data.source).toBe('manifest-list');
    expect(result.data.manifestFiles).toHaveLength(0);
    expect(result.text).toContain('no known manifest');
  });

  it('returns text lines in alphabetical order', async () => {
    await writeFile(
      join(repoRoot, 'package.json'),
      JSON.stringify({ dependencies: { zod: '^3.0.0', axios: '^1.0.0', express: '^4.0.0' } }),
    );

    const result = await stackVersions(makeDeps());
    const lines = result.text.split('\n').slice(1).filter(Boolean);
    const names = lines.map((l) => l.split(':')[0] ?? '');
    expect(names).toEqual([...names].sort());
  });
});

// ---------------------------------------------------------------------------
// impact
// ---------------------------------------------------------------------------

describe('impact', () => {
  it('returns impacted files via reverse reachability', async () => {
    const graph = makeImportGraph();
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['src/lib/a.ts'], deps);
    expect(result.data.impacted).toContain('src/index.ts');
    expect(result.data.impacted).toContain('tests/a.test.ts');
  });

  it('returns test files separately in testFiles', async () => {
    const graph = makeImportGraph();
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['src/lib/a.ts'], deps);
    expect(result.data.testFiles).toContain('tests/a.test.ts');
    expect(result.data.testFiles).not.toContain('src/index.ts');
  });

  it('excludes the input files from the impacted list', async () => {
    const graph = makeImportGraph();
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['src/lib/a.ts'], deps);
    expect(result.data.impacted).not.toContain('src/lib/a.ts');
  });

  it('returns impacted in deterministic sorted order', async () => {
    const graph = makeImportGraph({
      edges: {
        'b.ts': ['util.ts'],
        'a.ts': ['util.ts'],
        'tests/t.test.ts': ['a.ts'],
      },
    });
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['util.ts'], deps);
    const impacted = result.data.impacted;
    expect(impacted).toEqual([...impacted].sort());
  });

  it('returns empty impacted when no files import the changed file', async () => {
    const graph: ImportGraph = { scannedAtSha: 'xyz', edges: { 'a.ts': ['b.ts'] } };
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['c.ts'], deps);
    expect(result.data.impacted).toHaveLength(0);
    expect(result.data.testFiles).toHaveLength(0);
  });

  it('reports honest no-scan when deps.scan is absent', async () => {
    const result = await impact(['src/lib/a.ts'], makeDeps());
    expect(result.text).toContain('not available');
    expect(result.data.impacted).toHaveLength(0);
  });

  it('reports empty files gracefully', async () => {
    const deps = makeDeps({ scan: () => makeImportGraph() });
    const result = await impact([], deps);
    expect(result.text).toContain('no files provided');
    expect(result.data.impacted).toHaveLength(0);
  });

  it('includes scannedAtSha in data and text', async () => {
    const graph = makeImportGraph({ scannedAtSha: 'sha-deadbeef' });
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['src/lib/util.ts'], deps);
    expect(result.data.scannedAtSha).toBe('sha-deadbeef');
    expect(result.text).toContain('sha-deadbeef');
  });

  it('handles transitive reachability across multiple hops', async () => {
    const graph: ImportGraph = {
      scannedAtSha: 'sha1',
      edges: {
        'src/top.ts': ['src/mid.ts'],
        'src/mid.ts': ['src/bottom.ts'],
      },
    };
    const deps = makeDeps({ scan: () => graph });
    const result = await impact(['src/bottom.ts'], deps);
    expect(result.data.impacted).toContain('src/mid.ts');
    expect(result.data.impacted).toContain('src/top.ts');
  });

  it('handles async scan function', async () => {
    const graph = makeImportGraph();
    const deps = makeDeps({ scan: async () => graph });
    const result = await impact(['src/lib/b.ts'], deps);
    expect(result.data.impacted).toContain('src/index.ts');
    expect(result.data.testFiles).toContain('tests/b.test.ts');
  });
});

// ---------------------------------------------------------------------------
// retrievalTools: ToolImpl wrappers
// ---------------------------------------------------------------------------

describe('retrievalTools', () => {
  it('returns five ToolImpl objects with correct names', () => {
    const tools = retrievalTools(makeDeps());
    expect(tools.findSymbol.def.name).toBe('find_symbol');
    expect(tools.findExemplar.def.name).toBe('find_exemplar');
    expect(tools.conventionsFor.def.name).toBe('conventions_for');
    expect(tools.stackVersions.def.name).toBe('stack_versions');
    expect(tools.impact.def.name).toBe('impact');
  });

  it('each ToolImpl has a description and parameters', () => {
    const tools = retrievalTools(makeDeps());
    for (const tool of Object.values(tools)) {
      expect(typeof tool.def.description).toBe('string');
      expect(tool.def.description.length).toBeGreaterThan(0);
      expect(typeof tool.def.parameters).toBe('object');
    }
  });

  it('find_symbol execute returns ok:true with text output', async () => {
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'test.ts'), 'export function myFunc() {}\n');
    const tools = retrievalTools(makeDeps());
    const goal = { id: 'g', type: 'implement', parentId: null, title: 't', spec: {}, intent: 'production', scope: [], budget: { attempts: 1, tokens: 100, toolCalls: 5, wallClockMs: 10000 }, memories: [] } as import('../../src/contract/goal.js').Goal;
    const result = await tools.findSymbol.execute(goal, { name: 'myFunc' });
    expect(result.ok).toBe(true);
    expect(typeof result.output).toBe('string');
  });

  it('stack_versions execute returns ok:true', async () => {
    await writeFile(join(repoRoot, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4.0.0' } }));
    const tools = retrievalTools(makeDeps());
    const goal = { id: 'g', type: 'implement', parentId: null, title: 't', spec: {}, intent: 'production', scope: [], budget: { attempts: 1, tokens: 100, toolCalls: 5, wallClockMs: 10000 }, memories: [] } as import('../../src/contract/goal.js').Goal;
    const result = await tools.stackVersions.execute(goal, {});
    expect(result.ok).toBe(true);
    expect(result.output).toContain('lodash');
  });

  it('impact execute returns ok:true with synthetic graph', async () => {
    const graph = makeImportGraph();
    const tools = retrievalTools(makeDeps({ scan: () => graph }));
    const goal = { id: 'g', type: 'implement', parentId: null, title: 't', spec: {}, intent: 'production', scope: [], budget: { attempts: 1, tokens: 100, toolCalls: 5, wallClockMs: 10000 }, memories: [] } as import('../../src/contract/goal.js').Goal;
    const result = await tools.impact.execute(goal, { files: ['src/lib/a.ts'] });
    expect(result.ok).toBe(true);
    expect(result.output).toContain('src/index.ts');
  });
});
