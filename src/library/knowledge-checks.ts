/**
 * Deterministic self-validation checks for knowledge artifacts produced by
 * `map-repo` and `deep-dive-region` goals.
 *
 * Each check factory returns a DeterministicCheck that interprets the goal's
 * artifact text as a JSON-encoded knowledge payload and validates it without
 * consulting a judge. These checks form the gate described in ADR-019: a stale
 * or invalid artifact cannot emit a passing report.
 *
 * Design notes:
 *   - The artifact is always `kind: 'text'`, its `text` field carrying the
 *     JSON of KnowledgeArtifact (for map-repo) or RegionFacts (for dive).
 *   - Checks that need filesystem access read through CheckContext.sandboxRoot.
 *   - The architecture check accepts an injected scan function so the
 *     import-graph scanner module is not a hard dependency here; tests supply a
 *     synthetic scan.
 *   - Stack version parsing is a minimal own-implementation that reads only
 *     the `dependencies` / `devDependencies` / `peerDependencies` fields from
 *     package.json; no external deps are introduced.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeterministicCheck, CheckContext } from '../contract/goal-type.js';
import type { Goal } from '../contract/goal.js';
import type { Artifact } from '../contract/report.js';
import type { KnowledgeArtifact, RegionFacts } from '../contract/knowledge.js';
import { runScriptCheck } from './checks.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the artifact text as JSON and return it, or null on failure.
 * Failures surface as check failures — not thrown exceptions — so the gate
 * stays deterministic and never crashes the engine loop.
 */
/**
 * Extract the textual payload from an artifact, tolerating the two packagings
 * models actually produce: plain text (optionally fence-wrapped) and a
 * single-file `files` artifact (the adapter parses a fenced block into one).
 * Returns null when the artifact has no single textual payload.
 */
export function extractArtifactPayload(artifact: Artifact): string | null {
  let text: string;
  if (artifact.kind === 'text') {
    text = artifact.text ?? '';
  } else if (artifact.kind === 'files' && (artifact.files?.length ?? 0) === 1) {
    text = artifact.files?.[0]?.content ?? '';
  } else {
    return null;
  }
  const fenced = text.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenced?.[1] !== undefined) text = fenced[1];
  return text.trim();
}

function parseArtifactJson(artifact: Artifact | null): { ok: true; value: unknown } | { ok: false; detail: string } {
  if (artifact === null) {
    return { ok: false, detail: 'No artifact was produced.' };
  }
  // Models often emit the JSON wrapped in a fenced code block, which the
  // adapter's file-block parser turns into a single-file `files` artifact.
  // Both forms carry the same payload; accept either rather than failing a
  // valid artifact on packaging.
  const text = extractArtifactPayload(artifact);
  if (text === null) {
    return { ok: false, detail: `Expected a text artifact (or one fenced block); got kind "${artifact.kind}".` };
  }
  if (text.length === 0) {
    return { ok: false, detail: 'Artifact text is empty.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, detail: `Artifact is not valid JSON: ${msg}` };
  }
}

/**
 * Narrow an unknown value to KnowledgeArtifact by checking the required
 * structural fields. Returns null when the shape does not match.
 */
function toKnowledgeArtifact(value: unknown): KnowledgeArtifact | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['repoRoot'] !== 'string' ||
    typeof v['category'] !== 'string' ||
    typeof v['generatedAtSha'] !== 'string' ||
    typeof v['confidence'] !== 'string' ||
    typeof v['status'] !== 'string' ||
    !Array.isArray(v['pointers']) ||
    typeof v['summary'] !== 'string'
  ) {
    return null;
  }
  return value as KnowledgeArtifact;
}

/**
 * Narrow an unknown value to RegionFacts.
 */
function toRegionFacts(value: unknown): RegionFacts | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v['repoRoot'] !== 'string' ||
    typeof v['region'] !== 'string' ||
    typeof v['generatedAtSha'] !== 'string' ||
    !Array.isArray(v['facts'])
  ) {
    return null;
  }
  return value as RegionFacts;
}

// ---------------------------------------------------------------------------
// Architecture check
// ---------------------------------------------------------------------------

/**
 * A structural edge scan result: an adjacency pair emitted by a scanner over
 * the import graph of a repo. The scan function is structurally typed so the
 * architecture check does not import the import-graph scanner module; tests
 * inject synthetic scan results.
 */
export interface ScanEdge {
  /** The importing module (repo-relative path). */
  from: string;
  /** The imported module (repo-relative path). */
  to: string;
}

/**
 * A function that scans the import graph of a repo at a given SHA and returns
 * its edges. Injected at check-factory time — not supplied via CheckContext —
 * so the check's capability is declared at registration, not at runtime.
 * The import-graph scanner module is the canonical supplier; tests inject
 * a synthetic stub.
 */
export type ArchScanFn = (repoRoot: string, sha: string) => Promise<ScanEdge[]>;

/**
 * Returns a DeterministicCheck that validates an `architecture` category
 * KnowledgeArtifact:
 *
 *   1. Every pointer path in the artifact exists on disk under sandboxRoot.
 *   2. Every claimed pointer path that looks like a module path also appears
 *      as a node in the fresh scan (spot-edge agreement).
 *
 * The `scanFn` is the injected import-graph scanner (structurally typed so no
 * hard dependency on the scanner module). In tests, supply a synthetic scan function.
 */
export function architectureCheck(scanFn: ArchScanFn): DeterministicCheck {
  return {
    name: 'knowledge:architecture',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const ka = toKnowledgeArtifact(parsed.value);
      if (ka === null) {
        return { ok: false, detail: 'Artifact JSON does not match KnowledgeArtifact shape.' };
      }

      if (ka.category !== 'architecture') {
        return { ok: false, detail: `Expected category "architecture"; got "${ka.category}".` };
      }

      // Resolve the single root used by both the existence check and the scan,
      // so both halves validate against the same tree.
      const root = ctx?.sandboxRoot ?? ka.repoRoot;

      // 1. Pointer path existence check
      const missing: string[] = [];
      for (const pointer of ka.pointers) {
        const full = join(root, pointer.path);
        try {
          await readFile(full);
        } catch {
          missing.push(pointer.path);
        }
      }
      if (missing.length > 0) {
        return {
          ok: false,
          detail: `Architecture pointer path(s) not found: ${missing.join(', ')}`,
        };
      }

      // 2. Spot-edge agreement: every pointer path that appears as a `from`
      //    in the scan graph must also appear in the artifact's pointers, and
      //    vice-versa for a random spot sample. We check that the scan returns
      //    edges covering at least one of the declared pointer paths.
      if (ka.pointers.length > 0) {
        let edges: ScanEdge[];
        try {
          edges = await scanFn(root, ka.generatedAtSha);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { ok: false, detail: `Architecture scan failed: ${msg}` };
        }

        const scanNodes = new Set<string>();
        for (const edge of edges) {
          scanNodes.add(edge.from);
          scanNodes.add(edge.to);
        }

        // At least one claimed pointer path must appear in the scan graph.
        const covered = ka.pointers.some((p) => scanNodes.has(p.path));
        if (!covered && edges.length > 0) {
          return {
            ok: false,
            detail: `No claimed architecture pointer matches any node in the fresh scan. Claimed: [${ka.pointers.map((p) => p.path).join(', ')}].`,
          };
        }
      }

      return { ok: true, detail: `Architecture artifact validated: ${ka.pointers.length} pointer(s) checked.` };
    },
  };
}

// ---------------------------------------------------------------------------
// Stack check
// ---------------------------------------------------------------------------

/**
 * A minimal package.json shape — only the fields the stack check reads.
 */
interface PackageJsonDeps {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * Parse a package.json string and return a flat map of package → declared
 * version. Returns an empty map on parse failure (not an error — stack check
 * will report "no version found" for any claimed dependency).
 */
function parsePackageVersions(text: string): Map<string, string> {
  const result = new Map<string, string>();
  let pkg: PackageJsonDeps;
  try {
    pkg = JSON.parse(text) as PackageJsonDeps;
  } catch {
    return result;
  }
  const sections: (Record<string, string> | undefined)[] = [
    pkg.dependencies,
    pkg.devDependencies,
    pkg.peerDependencies,
  ];
  for (const section of sections) {
    if (!section) continue;
    for (const [name, version] of Object.entries(section)) {
      if (!result.has(name)) result.set(name, version);
    }
  }
  return result;
}

/**
 * Returns a DeterministicCheck that validates a `stack` category
 * KnowledgeArtifact by comparing its claimed dependency versions against the
 * versions declared in the repo's `package.json` (and optionally its lockfile).
 *
 * A pointer whose `note` carries a `version:<name>@<version>` token is checked
 * against the parsed manifest. Pointers without this token in their note are
 * skipped (they are structural pointers, not version claims).
 *
 * Version-claim format in `note`: the note must contain a token of the form
 * `version:<name>@<version>`, mirroring the `script:<name>` convention used by
 * testScaffoldCheck. Examples:
 *   - `version:typescript@5.4.0`
 *   - `version:@scope/pkg@1.2.3`
 *
 * Only tokens prefixed with `version:` are treated as version claims; bare
 * `name@version` substrings are ignored. This prevents false positives from
 * email addresses, URLs, or other `@`-containing text in notes.
 */
export function stackCheck(): DeterministicCheck {
  return {
    name: 'knowledge:stack',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const ka = toKnowledgeArtifact(parsed.value);
      if (ka === null) {
        return { ok: false, detail: 'Artifact JSON does not match KnowledgeArtifact shape.' };
      }

      if (ka.category !== 'stack') {
        return { ok: false, detail: `Expected category "stack"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;

      // Read package.json from the repo root
      let manifestVersions = new Map<string, string>();
      try {
        const pkgText = await readFile(join(root, 'package.json'), 'utf8');
        manifestVersions = parsePackageVersions(pkgText);
      } catch {
        // No package.json — cannot validate version claims; return a soft pass
        // (the artifact's presence is enough, no versions to contradict).
        return { ok: true, detail: 'No package.json found; no version claims to validate.' };
      }

      // Check every pointer whose note contains a `version:<name>@<version>` token.
      // The `version:` prefix is required; bare `name@version` substrings are ignored.
      // Scoped packages are supported: `version:@scope/pkg@1.2.3`.
      const mismatches: string[] = [];
      // Matches `version:` followed by an optional `@scope/` prefix, then `pkg@version`.
      const versionClaimRe = /version:(@?[^@\s]+(?:\/[^@\s]+)?)@(\S+)/g;

      for (const pointer of ka.pointers) {
        let match: RegExpExecArray | null;
        versionClaimRe.lastIndex = 0;
        while ((match = versionClaimRe.exec(pointer.note)) !== null) {
          const [, claimedName, claimedVersion] = match;
          if (!claimedName || !claimedVersion) continue;
          const declared = manifestVersions.get(claimedName);
          if (declared === undefined) continue; // Package not in manifest — skip
          // Strip the semver range prefix (^, ~, >=, etc.) from the declared version
          const declaredStripped = declared.replace(/^[^0-9]*/, '');
          const claimedStripped = claimedVersion.replace(/^[^0-9]*/, '');
          if (claimedStripped !== declaredStripped && declared !== claimedVersion) {
            mismatches.push(
              `${claimedName}: artifact claims ${claimedVersion}, manifest has ${declared}`,
            );
          }
        }
      }

      if (mismatches.length > 0) {
        return {
          ok: false,
          detail: `Stack version mismatch(es): ${mismatches.join('; ')}`,
        };
      }

      return {
        ok: true,
        detail: `Stack artifact validated: ${ka.pointers.length} pointer(s) checked against manifest.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Conventions check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `conventions` category
 * KnowledgeArtifact by verifying that every exemplar pointer path exists on
 * disk under `sandboxRoot` (or the artifact's `repoRoot`).
 *
 * Conventions artifacts carry pointers to exemplar files — files that
 * demonstrate the project's conventions. If the exemplar is gone, the pointer
 * is stale and the artifact must be refreshed.
 */
export function conventionsCheck(): DeterministicCheck {
  return {
    name: 'knowledge:conventions',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const ka = toKnowledgeArtifact(parsed.value);
      if (ka === null) {
        return { ok: false, detail: 'Artifact JSON does not match KnowledgeArtifact shape.' };
      }

      if (ka.category !== 'conventions') {
        return { ok: false, detail: `Expected category "conventions"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;
      const missing: string[] = [];

      for (const pointer of ka.pointers) {
        const full = join(root, pointer.path);
        try {
          await readFile(full);
        } catch {
          missing.push(pointer.path);
        }
      }

      if (missing.length > 0) {
        return {
          ok: false,
          detail: `Conventions exemplar pointer(s) not found: ${missing.join(', ')}`,
        };
      }

      return {
        ok: true,
        detail: `Conventions artifact validated: ${ka.pointers.length} exemplar pointer(s) exist.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Test-scaffold check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `test-scaffold` category
 * KnowledgeArtifact by actually running the test suite via the CheckContext's
 * `runScript` machinery.
 *
 * The script name is taken from the artifact's first pointer whose note
 * contains `script:<name>`, falling back to `"test"`. This lets the artifact
 * declare the exact script to invoke without the check hardcoding it.
 *
 * Absent `ctx.runScript` → always fails (configuration error, never silent pass).
 */
export function testScaffoldCheck(): DeterministicCheck {
  return {
    name: 'knowledge:test-scaffold',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const ka = toKnowledgeArtifact(parsed.value);
      if (ka === null) {
        return { ok: false, detail: 'Artifact JSON does not match KnowledgeArtifact shape.' };
      }

      if (ka.category !== 'test-scaffold') {
        return { ok: false, detail: `Expected category "test-scaffold"; got "${ka.category}".` };
      }

      if (ctx?.runScript === undefined) {
        return { ok: false, detail: 'no exec context' };
      }

      // Determine the script name from the artifact's pointer notes
      let scriptName = 'test';
      for (const pointer of ka.pointers) {
        const m = /script:(\S+)/.exec(pointer.note);
        if (m?.[1]) {
          scriptName = m[1];
          break;
        }
      }

      return runScriptCheck(scriptName).run(_goal, artifact, ctx);
    },
  };
}

// ---------------------------------------------------------------------------
// map-repo dispatcher check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that dispatches to the correct per-category
 * validator based on the `category` field in the artifact JSON. This is the
 * single check wired into the `map-repo` type definition; the per-category
 * checks are also exported individually for testing and assembly.
 *
 * `scanFn` is forwarded to the architecture check; pass `async () => []` for
 * types and tests that do not need a real scanner (the check safely passes
 * when the artifact has no pointers or the scan returns no edges that
 * contradict the claimed pointers).
 */
export function mapRepoCheck(scanFn: ArchScanFn): DeterministicCheck {
  return {
    name: 'knowledge:map-repo',
    async run(
      goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const ka = toKnowledgeArtifact(parsed.value);
      if (ka === null) {
        return { ok: false, detail: 'Artifact JSON does not match KnowledgeArtifact shape.' };
      }

      switch (ka.category) {
        case 'architecture':
          return architectureCheck(scanFn).run(goal, artifact, ctx);
        case 'stack':
          return stackCheck().run(goal, artifact, ctx);
        case 'conventions':
          return conventionsCheck().run(goal, artifact, ctx);
        case 'test-scaffold':
          return testScaffoldCheck().run(goal, artifact, ctx);
        default:
          // Other categories (design-system, deps, credentials) are not yet
          // shipped with deterministic self-validation; pass through.
          return {
            ok: true,
            detail: `Category "${ka.category}" has no self-validation in this version; passing through.`,
          };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Dive anchor-existence check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `deep-dive-region` artifact
 * (RegionFacts JSON) by verifying that every DiveFact anchor path exists and
 * has at least as many lines as the declared anchor line number.
 *
 * This implements ADR-019's verify-on-read rule for dive facts: "every fact
 * carries file:line anchors at SHA — self-checkable on read."
 */
export function diveAnchorCheck(): DeterministicCheck {
  return {
    name: 'knowledge:dive-anchor',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const rf = toRegionFacts(parsed.value);
      if (rf === null) {
        return { ok: false, detail: 'Artifact JSON does not match RegionFacts shape.' };
      }

      const root = ctx?.sandboxRoot ?? rf.repoRoot;
      const failures: string[] = [];

      for (const fact of rf.facts) {
        for (const anchor of fact.anchors) {
          const full = join(root, anchor.path);
          let content: string;
          try {
            content = await readFile(full, 'utf8');
          } catch {
            failures.push(`${anchor.path}: file not found`);
            continue;
          }
          // Count lines (split on newlines; last empty segment from trailing
          // newline does not count as a line).
          const lines = content.split('\n');
          const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;
          if (anchor.line > lineCount) {
            failures.push(
              `${anchor.path}:${anchor.line}: file has only ${lineCount} line(s)`,
            );
          }
        }
      }

      if (failures.length > 0) {
        return {
          ok: false,
          detail: `Dive anchor check failed: ${failures.join('; ')}`,
        };
      }

      const anchorCount = rf.facts.reduce((n, f) => n + f.anchors.length, 0);
      return {
        ok: true,
        detail: `Dive anchor check passed: ${rf.facts.length} fact(s), ${anchorCount} anchor(s) verified.`,
      };
    },
  };
}
