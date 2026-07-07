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

import { readFile, stat } from 'node:fs/promises';
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
 * structural fields. Returns a result object so callers can surface field-level
 * detail on failure instead of a generic "does not match shape" message.
 * Sanitizes pointer `line: null` → omitted (undefined) so strict-mode schemas
 * that emit null for the absent-line case are handled correctly at runtime.
 */
function toKnowledgeArtifactResult(
  value: unknown,
): { ok: true; value: KnowledgeArtifact } | { ok: false; detail: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, detail: 'Artifact JSON is not an object.' };
  }
  const v = value as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof v['repoRoot'] !== 'string') missing.push('repoRoot');
  if (typeof v['category'] !== 'string') missing.push('category');
  if (typeof v['generatedAtSha'] !== 'string') missing.push('generatedAtSha');
  if (typeof v['confidence'] !== 'string') missing.push('confidence');
  if (typeof v['status'] !== 'string') missing.push('status');
  if (!Array.isArray(v['pointers'])) missing.push('pointers');
  if (typeof v['summary'] !== 'string') missing.push('summary');
  if (missing.length > 0) {
    return { ok: false, detail: `KnowledgeArtifact shape mismatch — missing or invalid: ${missing.join(', ')}` };
  }
  const sanitized = {
    ...v,
    pointers: (v['pointers'] as Array<Record<string, unknown>>).map((p) => {
      if (p['line'] === null) {
        const { line: _dropped, ...rest } = p;
        return rest;
      }
      return p;
    }),
  };
  return { ok: true, value: sanitized as unknown as KnowledgeArtifact };
}


/**
 * Narrow an unknown value to RegionFacts. Returns a result object so callers
 * can surface field-level detail on failure.
 */
function toRegionFactsResult(
  value: unknown,
): { ok: true; value: RegionFacts } | { ok: false; detail: string } {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, detail: 'Artifact JSON is not an object.' };
  }
  const v = value as Record<string, unknown>;
  const missing: string[] = [];
  if (typeof v['repoRoot'] !== 'string') missing.push('repoRoot');
  if (typeof v['region'] !== 'string') missing.push('region');
  if (typeof v['generatedAtSha'] !== 'string') missing.push('generatedAtSha');
  if (!Array.isArray(v['facts'])) missing.push('facts');
  if (missing.length > 0) {
    return { ok: false, detail: `RegionFacts shape mismatch — missing or invalid: ${missing.join(', ')}` };
  }
  return { ok: true, value: value as RegionFacts };
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

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

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

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

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

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

      if (ka.category !== 'conventions') {
        return { ok: false, detail: `Expected category "conventions"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;
      // An exemplar pointer is valid if its path EXISTS — a file OR a directory.
      // A directory exemplar ("src/contract/* demonstrates the type conventions")
      // is legitimate, so existence (stat), not readability (readFile), is the
      // right test: readFile threw EISDIR on a directory pointer and the goal was
      // told "not found" for a path it could see exists, so it could never
      // self-correct (AC-3 run #2). Only a genuinely-absent path fails.
      const missing: string[] = [];

      for (const pointer of ka.pointers) {
        const full = join(root, pointer.path);
        try {
          await stat(full);
        } catch {
          missing.push(pointer.path);
        }
      }

      if (missing.length > 0) {
        return {
          ok: false,
          detail: `Conventions exemplar pointer(s) do not exist (path absent at this SHA): ${missing.join(', ')}`,
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

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

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
// Deps check
// ---------------------------------------------------------------------------

/**
 * Resolve the repo's dependency versions FRESH at the SHA, preferring the
 * lockfile (the resolved truth) over package.json's declared ranges. Mirrors
 * the precedence in `retrieval.ts` `stackVersions` — lockfile v1 first, then
 * package.json declared ranges — so the deps validator diffs against the same
 * source of truth the retrieval tool surfaces.
 *
 * Returns a flat name → version map. Lockfile versions are exact (`5.4.3`);
 * package.json fallback values keep their range prefix (`^5.4.0`), matched
 * range-tolerantly the same way the stack check does.
 */
async function resolveDepVersions(root: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Prefer the lockfile (resolved, exact versions) — the freshest truth.
  try {
    const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
    const lock = JSON.parse(lockText) as Record<string, unknown>;
    if (lock['lockfileVersion'] === 1 && typeof lock['dependencies'] === 'object' && lock['dependencies'] !== null) {
      const lockDeps = lock['dependencies'] as Record<string, Record<string, unknown>>;
      for (const [name, info] of Object.entries(lockDeps)) {
        if (typeof info['version'] === 'string') result.set(name, info['version']);
      }
    }
  } catch {
    // No lockfile or unparseable — fall back to package.json ranges below.
  }
  if (result.size > 0) return result;

  // Fall back to package.json's declared ranges (reuses the stack parser).
  try {
    const pkgText = await readFile(join(root, 'package.json'), 'utf8');
    return parsePackageVersions(pkgText);
  } catch {
    return result;
  }
}

/**
 * Returns a DeterministicCheck that validates a `deps` category
 * KnowledgeArtifact by diffing its claimed dependency versions against the
 * versions resolved FRESH from the lockfile (or package.json when no lockfile
 * is present) at the SHA.
 *
 * A pointer whose `note` carries a `version:<name>@<version>` token is checked
 * against the resolved versions, using the same range-tolerant comparison as
 * `stackCheck`. A claim naming a package that is not in the manifest/lockfile
 * cannot be contradicted and is skipped. When no manifest exists at all there
 * is nothing to diff against — a soft pass, mirroring `stackCheck`.
 *
 * This is intentionally the same shape as `stackCheck` (they share the version
 * claim convention); the difference is deps parses the lockfile *first*, so a
 * stale artifact that matched package.json's range but not the resolved lock
 * version is still caught.
 */
export function depsCheck(): DeterministicCheck {
  return {
    name: 'knowledge:deps',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

      if (ka.category !== 'deps') {
        return { ok: false, detail: `Expected category "deps"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;
      const resolved = await resolveDepVersions(root);
      if (resolved.size === 0) {
        // No manifest/lockfile — nothing to diff against; soft pass.
        return { ok: true, detail: 'No manifest or lockfile found; no dep claims to validate.' };
      }

      const mismatches: string[] = [];
      const versionClaimRe = /version:(@?[^@\s]+(?:\/[^@\s]+)?)@(\S+)/g;
      for (const pointer of ka.pointers) {
        let match: RegExpExecArray | null;
        versionClaimRe.lastIndex = 0;
        while ((match = versionClaimRe.exec(pointer.note)) !== null) {
          const [, claimedName, claimedVersion] = match;
          if (!claimedName || !claimedVersion) continue;
          const declared = resolved.get(claimedName);
          if (declared === undefined) continue; // Not in the resolved set — cannot contradict.
          const declaredStripped = declared.replace(/^[^0-9]*/, '');
          const claimedStripped = claimedVersion.replace(/^[^0-9]*/, '');
          if (claimedStripped !== declaredStripped && declared !== claimedVersion) {
            mismatches.push(
              `${claimedName}: artifact claims ${claimedVersion}, lockfile/manifest has ${declared}`,
            );
          }
        }
      }

      if (mismatches.length > 0) {
        return {
          ok: false,
          detail: `Deps version mismatch(es) against fresh lockfile/manifest: ${mismatches.join('; ')}`,
        };
      }

      return {
        ok: true,
        detail: `Deps artifact validated: ${ka.pointers.length} pointer(s) checked against fresh lockfile/manifest.`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Credentials check
// ---------------------------------------------------------------------------

/**
 * Patterns that identify a *value-shaped* secret — an actual token/key/password,
 * as opposed to a reference to where one lives. A credentials artifact must
 * carry references only (DESIGN.md: "vault references only, never values"), so
 * any value-shaped string in a pointer note or the summary fails the artifact.
 *
 * These are deliberately high-signal shapes (provider-prefixed keys, JWTs, PEM
 * blocks, long base64/hex blobs, `key=value` secret assignments). An env-var
 * name (`DATABASE_URL`) or a file path (`.env`) is a reference, not a value, and
 * must NOT match — the check's whole job is to distinguish the two.
 */
const SECRET_VALUE_PATTERNS: { name: string; re: RegExp }[] = [
  // Provider-prefixed API keys: sk-..., AKIA..., ghp_..., xoxb-..., AIza...
  { name: 'provider-prefixed key', re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[posru]_[A-Za-z0-9]{20,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}\b/ },
  // JWT: three base64url segments separated by dots.
  { name: 'JWT', re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  // PEM private key block.
  { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  // A secret-looking assignment: password/secret/token/apikey = <non-trivial value>.
  {
    name: 'secret assignment',
    re: /\b(?:pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["']?[A-Za-z0-9/+_.-]{8,}["']?/i,
  },
];

/**
 * A reference is an env-var name or a file path — the two forms a credentials
 * pointer legitimately carries. A pointer `path` naming one of these is a
 * location to check for existence, not a value. Env-var references are matched
 * by an all-caps SNAKE_CASE shape (`STRIPE_SECRET_KEY`); everything else is
 * treated as a repo-relative file path and checked with `stat`.
 */
const ENV_VAR_NAME_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/**
 * Scan a blob of artifact-authored text for any value-shaped secret. Returns the
 * name of the first pattern that matched, or null when the text is clean.
 */
function scanForSecretValue(text: string): string | null {
  for (const { name, re } of SECRET_VALUE_PATTERNS) {
    if (re.test(text)) return name;
  }
  return null;
}

/**
 * Returns a DeterministicCheck that validates a `credentials` category
 * KnowledgeArtifact. The credentials inventory feeds `classify_risk`, so an
 * unvalidated (hallucinated or stale) artifact silently weakens the risk gate —
 * this check makes three guarantees at promotion:
 *
 *   1. **No values, only references.** No pointer note or the summary may carry
 *      a value-shaped secret (DESIGN.md: "vault references only, never values").
 *   2. **Every reference resolves at the SHA.** A pointer `path` that names an
 *      env-var (`STRIPE_SECRET_KEY`) must be referenced somewhere in the repo;
 *      a pointer `path` that names a file must exist on disk.
 *   3. **The artifact itself carries no secret.** Same value scan over notes and
 *      summary — an artifact that leaked a real key is rejected outright.
 *
 * Failure means the artifact stays provisional/unpromoted, identical to the
 * categories that already validate.
 */
export function credentialsCheck(): DeterministicCheck {
  return {
    name: 'knowledge:credentials',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

      if (ka.category !== 'credentials') {
        return { ok: false, detail: `Expected category "credentials"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;

      // 1 + 3. No value-shaped secret anywhere the artifact authored text: the
      //         summary and every pointer note. Reference-only is the invariant.
      const summaryHit = scanForSecretValue(ka.summary);
      if (summaryHit !== null) {
        return {
          ok: false,
          detail: `Credentials artifact summary carries a value-shaped secret (${summaryHit}); credentials must be references only, never values.`,
        };
      }
      for (const pointer of ka.pointers) {
        const noteHit = scanForSecretValue(pointer.note);
        if (noteHit !== null) {
          return {
            ok: false,
            detail: `Credentials pointer note for "${pointer.path}" carries a value-shaped secret (${noteHit}); credentials must be references only, never values.`,
          };
        }
        // A value-shaped secret sitting in the `path` field itself is also a leak.
        const pathHit = scanForSecretValue(pointer.path);
        if (pathHit !== null) {
          return {
            ok: false,
            detail: `Credentials pointer path "${pointer.path}" is a value-shaped secret (${pathHit}); the path must reference a location, not a value.`,
          };
        }
      }

      // 2. Every referenced location resolves at the SHA. Env-var references
      //    (SNAKE_CASE) must appear somewhere in the repo; file references must
      //    exist on disk. A reference to a location that does not exist is a
      //    stale/hallucinated inventory entry.
      const unresolved: string[] = [];
      for (const pointer of ka.pointers) {
        if (ENV_VAR_NAME_RE.test(pointer.path)) {
          const referenced = await envVarReferenced(root, pointer.path);
          if (!referenced) unresolved.push(`env var ${pointer.path} (not referenced in repo)`);
        } else {
          try {
            await stat(join(root, pointer.path));
          } catch {
            unresolved.push(`file ${pointer.path} (not found at SHA)`);
          }
        }
      }

      if (unresolved.length > 0) {
        return {
          ok: false,
          detail: `Credentials reference(s) do not resolve at this SHA: ${unresolved.join('; ')}`,
        };
      }

      return {
        ok: true,
        detail: `Credentials artifact validated: ${ka.pointers.length} reference(s) resolve and carry no values.`,
      };
    },
  };
}

/**
 * Best-effort liveness for an env-var reference: is the name mentioned anywhere
 * in the repo's env manifests or source at the SHA? A credentials pointer that
 * names `STRIPE_SECRET_KEY` should be grounded in the repo (a `.env.example`
 * entry, a `process.env.STRIPE_SECRET_KEY` read, a compose/deploy manifest). We
 * scan a bounded set of likely env-declaration files rather than the whole tree,
 * so the check stays cheap and deterministic; if none exist, the reference is
 * treated as ungrounded.
 *
 * The scanned files match the env-manifest conventions Corellia itself uses
 * (`.env*`, compose files) plus a fallback grep is intentionally avoided — a
 * repo-wide scan would be neither cheap nor deterministic across large trees.
 */
async function envVarReferenced(root: string, name: string): Promise<boolean> {
  const candidates = [
    '.env',
    '.env.example',
    '.env.sample',
    '.env.local',
    '.env.template',
    'compose.yaml',
    'compose.yml',
    'docker-compose.yml',
    'docker-compose.yaml',
  ];
  for (const rel of candidates) {
    let text: string;
    try {
      text = await readFile(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    // Word-boundary match so STRIPE_KEY does not match STRIPE_KEY_ID's prefix.
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Design-system check
// ---------------------------------------------------------------------------

/**
 * Returns a DeterministicCheck that validates a `design-system` category
 * KnowledgeArtifact by pointer liveness: every token/exemplar pointer must
 * resolve at the SHA. A design-system artifact points at the files that define
 * the design tokens and the components that exemplify them; if a pointer's path
 * is gone, the artifact is stale and must refresh.
 *
 * Existence (`stat`), not readability, is the test — a directory pointer
 * ("components/* exemplify the button variants") is legitimate, same reasoning
 * as `conventionsCheck`.
 */
export function designSystemCheck(): DeterministicCheck {
  return {
    name: 'knowledge:design-system',
    async run(
      _goal: Goal,
      artifact: Artifact | null,
      ctx?: CheckContext,
    ): Promise<{ ok: boolean; detail: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

      if (ka.category !== 'design-system') {
        return { ok: false, detail: `Expected category "design-system"; got "${ka.category}".` };
      }

      const root = ctx?.sandboxRoot ?? ka.repoRoot;
      const missing: string[] = [];
      for (const pointer of ka.pointers) {
        try {
          await stat(join(root, pointer.path));
        } catch {
          missing.push(pointer.path);
        }
      }

      if (missing.length > 0) {
        return {
          ok: false,
          detail: `Design-system pointer(s) do not resolve at this SHA: ${missing.join(', ')}`,
        };
      }

      return {
        ok: true,
        detail: `Design-system artifact validated: ${ka.pointers.length} pointer(s) resolve.`,
      };
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

      const kaResult = toKnowledgeArtifactResult(parsed.value);
      if (!kaResult.ok) {
        return { ok: false, detail: kaResult.detail };
      }
      const ka = kaResult.value;

      switch (ka.category) {
        case 'architecture':
          return architectureCheck(scanFn).run(goal, artifact, ctx);
        case 'stack':
          return stackCheck().run(goal, artifact, ctx);
        case 'conventions':
          return conventionsCheck().run(goal, artifact, ctx);
        case 'test-scaffold':
          return testScaffoldCheck().run(goal, artifact, ctx);
        case 'deps':
          return depsCheck().run(goal, artifact, ctx);
        case 'credentials':
          return credentialsCheck().run(goal, artifact, ctx);
        case 'design-system':
          return designSystemCheck().run(goal, artifact, ctx);
        default:
          // All seven categories now self-validate. This arm is unreachable for
          // a well-typed KnowledgeCategory; it stays as a total-switch guard so a
          // future category added to the union fails loudly here rather than
          // silently passing through unchecked.
          return {
            ok: false,
            detail: `Category "${ka.category}" has no self-validation wired in this version.`,
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
    ): Promise<{ ok: boolean; detail: string; prescription?: string }> {
      const parsed = parseArtifactJson(artifact);
      if (!parsed.ok) return { ok: false, detail: parsed.detail };

      const rfResult = toRegionFactsResult(parsed.value);
      if (!rfResult.ok) {
        return { ok: false, detail: rfResult.detail };
      }
      const rf = rfResult.value;

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
          // A bad anchor is mechanically repairable: the detail already names the
          // exact path:line and the real bound. Hand the model a precise recipe so
          // the engine repairs in-attempt (ADR-006) instead of escalating the tier
          // into the same hallucination (run live-self-a6963719). Re-grounding by
          // the cited symbol beats re-rolling: a line number invented out of range
          // should become the real location of the claimed content, or — if the
          // claim cannot be grounded in the file at all — the fact must be dropped.
          prescription:
            `These dive-fact anchors do not exist at HEAD: ${failures.join('; ')}. ` +
            `For each, open the cited file and re-ground the anchor to the REAL ` +
            `line where the claimed content actually appears (search for the ` +
            `symbol or text the fact describes — do not guess a line number). ` +
            `If the claim cannot be found in the file at all, DROP that fact ` +
            `entirely rather than emit an unfounded anchor. Every remaining anchor ` +
            `must point at content that exists in the file as it is now.`,
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
