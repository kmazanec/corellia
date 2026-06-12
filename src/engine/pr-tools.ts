/**
 * `push_branch` and `open_pr` — the PR-opening boundary tools (ADR-025).
 *
 * Both tools run IN THE ENGINE PROCESS, not in any spawned child. The
 * GITHUB_TOKEN is read from the engine's `process.env` at execute time and
 * passed to git via GIT_ASKPASS (never placed in argv). The transcript and
 * the event log never contain a credential (ADR-012).
 *
 * Token-passing approach: GIT_ASKPASS.
 *   Rationale: placing the token in a remote URL (https://token@host) would
 *   expose it in `git remote -v` output and in reflog messages — both
 *   user-visible, both risk surfaces. GIT_ASKPASS provides the token to git's
 *   credential-query path via a tiny helper script that writes the token to
 *   stdout; the token never appears in argv (no ps-visible leak) and git does
 *   not write it to any log. The helper is written to a secure tmpfile, chmod
 *   0700, referenced via GIT_ASKPASS, then deleted after push — it is never
 *   left on disk. On failure the cleanup still runs (try/finally).
 *
 * Process-clean gate (AC-20): `push_branch` runs `scanDiffForProcessLanguage`
 *   over `git diff HEAD origin/<branch>` (or the full diff when the remote
 *   branch does not yet exist) before pushing. A dirty diff refuses and names
 *   every offending file:line; nothing reaches the remote.
 *
 * Idempotence:
 *   - `push_branch`: a fast-forward repeat is allowed; git itself is
 *     idempotent for fast-forward pushes when the remote already has the ref.
 *   - `open_pr`:  a second call for the same treeId is refused and returns
 *     the existing URL, read from `pr-opened` events in the event log.
 */

import { execFileSync, execFile } from 'node:child_process';
import { writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Goal } from '../contract/goal.js';
import type { ToolImpl } from '../contract/tool.js';
import type { EventStore } from '../contract/events.js';
import { scanDiffForProcessLanguage } from './process-clean.js';

// ---------------------------------------------------------------------------
// Fetch transport injection — isolates the GitHub REST path so tests never
// touch the network. The real implementation uses global `fetch` (zero deps,
// Node ≥18). Tests supply a stub that matches the same interface.
// ---------------------------------------------------------------------------

/** The minimal response surface `open_pr` reads from the GitHub REST API. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/**
 * Injectable fetch transport. The real transport wraps global `fetch`; tests
 * supply a stub that never makes network calls.
 */
export type FetchTransport = (url: string, init: RequestInit) => Promise<FetchResponse>;

/** The real (global `fetch`) transport. Passes through to the platform fetch. */
export const realFetchTransport: FetchTransport = (url, init) => fetch(url, init) as Promise<FetchResponse>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Write a tiny GIT_ASKPASS helper to a secure tmpfile, set it executable, and
 * return its path. The helper echoes the supplied token on stdout when git
 * queries credentials. Caller MUST delete the file after use (try/finally).
 *
 * The token never appears in argv or any git command string — only inside the
 * helper file's content, which is 0700 and tmpdir-scoped.
 */
function writeAskpassHelper(token: string): string {
  const name = `corellia-askpass-${randomBytes(8).toString('hex')}.sh`;
  const path = join(tmpdir(), name);
  // The helper is a POSIX shell script: print the token, exit 0.
  // Newlines in the token would be catastrophic but GITHUB_TOKEN is an
  // alphanumeric opaque string — safe to embed verbatim.
  writeFileSync(path, `#!/bin/sh\nprintf '%s\\n' '${token.replace(/'/g, "'\\''")}'  \n`, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

/**
 * Get the remote URL for the repo (origin), used for the process-clean diff
 * and to derive the push target. Returns null if origin is not configured.
 */
function getOriginUrl(repoRoot: string): string | null {
  try {
    return execFileSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get the diff between the local branch HEAD and the remote branch, or the
 * full diff from the initial commit if the remote branch does not exist yet.
 * Used by the process-clean gate before pushing.
 */
function getDiffForCleanCheck(repoRoot: string, branch: string): string {
  // Try diff against the remote tracking branch.
  const remoteBranch = `origin/${branch}`;
  try {
    // Check whether the remote ref exists by asking git rev-parse.
    execFileSync('git', ['-C', repoRoot, 'rev-parse', '--verify', remoteBranch], { stdio: 'pipe' });
    // Remote ref exists — diff against it.
    return execFileSync(
      'git',
      ['-C', repoRoot, 'diff', `${remoteBranch}...HEAD`],
      { stdio: 'pipe', encoding: 'utf-8' },
    );
  } catch {
    // Remote ref does not exist — diff from the root commit (initial push).
    try {
      const rootCommit = execFileSync(
        'git',
        ['-C', repoRoot, 'rev-list', '--max-parents=0', 'HEAD'],
        { stdio: 'pipe', encoding: 'utf-8' },
      ).trim();
      return execFileSync(
        'git',
        ['-C', repoRoot, 'diff', `${rootCommit}..HEAD`],
        { stdio: 'pipe', encoding: 'utf-8' },
      );
    } catch {
      // Fallback: empty diff — let git push decide.
      return '';
    }
  }
}

/**
 * Run `git push` with the token injected via GIT_ASKPASS. The token never
 * appears in argv. The askpass helper is deleted in a finally block regardless
 * of push outcome.
 */
function pushWithToken(
  repoRoot: string,
  branch: string,
  remote: string,
  token: string,
): Promise<void> {
  const helperPath = writeAskpassHelper(token);
  return new Promise((resolve, reject) => {
    try {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_ASKPASS: helperPath,
        GIT_TERMINAL_PROMPT: '0',        // Prevent interactive prompts.
        GIT_SSH_COMMAND: 'ssh -oBatchMode=yes', // No interactive SSH either.
      };
      // Remove GITHUB_TOKEN from the child env — the askpass helper is the
      // sole credential path; letting it leak into the child is redundant
      // and widens the surface.
      delete env['GITHUB_TOKEN'];
      delete env['GH_TOKEN'];

      const child = execFile(
        'git',
        ['-C', repoRoot, 'push', remote, `${branch}:${branch}`],
        { env },
        (err) => {
          try { unlinkSync(helperPath); } catch { /* already gone */ }
          if (err) reject(new Error(`git push failed: ${err.message}`));
          else resolve();
        },
      );
      // Swallow stdout/stderr from git push — they may contain the token
      // echo in credential-query protocols. We only care about the exit code.
      child.stdout?.resume();
      child.stderr?.resume();
    } catch (e) {
      try { unlinkSync(helperPath); } catch { /* already gone */ }
      reject(e);
    }
  });
}

// ---------------------------------------------------------------------------
// push_branch ToolImpl
// ---------------------------------------------------------------------------

/**
 * Options for the push_branch ToolImpl factory. Separating deps from the
 * `execute` closure simplifies testing.
 */
export interface PushBranchDeps {
  /** The tree's sandbox worktree root — where git commands are run. */
  worktreeRoot: string;
  /** The tree's branch name (e.g. `tree/<treeId>`). */
  branch: string;
  /** The treeId for event emission. */
  treeId: string;
  /** Append `branch-pushed` to the log on success. */
  store: EventStore;
}

/**
 * Factory that returns the `push_branch` ToolImpl for a specific tree. The
 * tool:
 *   1. Reads `GITHUB_TOKEN` from `process.env` at execute time.
 *   2. Runs the process-clean gate over the diff.
 *   3. Pushes via `GIT_ASKPASS` — token never in argv.
 *   4. Appends a `branch-pushed` event.
 *   5. A fast-forward repeat is allowed (git is idempotent for ff pushes).
 */
export function pushBranchTool(deps: PushBranchDeps): ToolImpl {
  const { worktreeRoot, branch, treeId, store } = deps;

  return {
    def: {
      name: 'push_branch',
      description:
        'Push the tree\'s branch to the bound repo\'s origin. Runs the process-clean gate before pushing — a dirty diff (factory-internal content) is refused with the offending file:line list. The GITHUB_TOKEN is read from the engine environment at execute time; it never appears in the transcript. A fast-forward repeat is allowed.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },

    async execute(goal: Goal, _args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      // 1. Read the token from the engine's environment at execute time.
      const token = process.env['GITHUB_TOKEN'] ?? '';
      if (!token) {
        return {
          ok: false,
          output: 'push_branch: GITHUB_TOKEN is not set in the engine environment. Set it before running live pushes.',
        };
      }

      // 2. Determine the remote (must be 'origin').
      const remote = 'origin';
      const originUrl = getOriginUrl(worktreeRoot);
      if (!originUrl) {
        return {
          ok: false,
          output: 'push_branch: no "origin" remote is configured for this worktree\'s repo.',
        };
      }

      // 3. Process-clean gate (AC-20, ADR-025). Run over the diff before any
      //    push; a dirty diff refuses naming offending file:line; nothing reaches
      //    the remote.
      const diff = getDiffForCleanCheck(worktreeRoot, branch);
      const cleanResult = scanDiffForProcessLanguage(diff);
      if (!cleanResult.ok) {
        const lines = cleanResult.offenses.slice(0, 20).join('\n');
        const truncated = cleanResult.offenses.length > 20
          ? `\n...and ${cleanResult.offenses.length - 20} more`
          : '';
        return {
          ok: false,
          output:
            `push_branch: process-clean gate rejected the diff — factory-internal content detected.\n` +
            `Offending locations:\n${lines}${truncated}`,
        };
      }

      // 4. Push via GIT_ASKPASS — token never in argv.
      try {
        await pushWithToken(worktreeRoot, branch, remote, token);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, output: `push_branch: ${msg}` };
      }

      // 5. Append branch-pushed event.
      await store.append({
        type: 'branch-pushed',
        at: Date.now(),
        goalId: goal.id,
        treeId,
        branch,
        remote: originUrl,
      });

      return {
        ok: true,
        output: `push_branch: pushed ${branch} to ${originUrl}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// open_pr ToolImpl
// ---------------------------------------------------------------------------

/**
 * Options for the open_pr ToolImpl factory.
 */
export interface OpenPrDeps {
  /** The tree's branch name (e.g. `tree/<treeId>`). */
  branch: string;
  /** The treeId — used for idempotence guard (pr-opened lookup) and event. */
  treeId: string;
  /** The GitHub owner/repo slug, e.g. `acme/factory`. Derived from origin URL at factory config time. */
  repoSlug: string;
  /** Append `pr-opened` to the log on success. */
  store: EventStore;
  /** Injectable fetch transport; defaults to `realFetchTransport` in production. */
  fetchTransport?: FetchTransport;
}

/**
 * Extract `owner/repo` from a GitHub remote URL. Handles HTTPS and SSH forms:
 *   https://github.com/owner/repo.git  →  owner/repo
 *   git@github.com:owner/repo.git      →  owner/repo
 * Returns null if the URL is not a recognised GitHub remote.
 */
export function extractRepoSlug(url: string): string | null {
  // HTTPS: https://github.com/owner/repo[.git]
  const https = url.match(/^https?:\/\/[^/]*github\.com\/([^/]+\/[^/]+?)(?:\.git)?(?:\/)?$/i);
  if (https?.[1]) return https[1];

  // SSH: git@github.com:owner/repo[.git]
  const ssh = url.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (ssh?.[1]) return ssh[1];

  return null;
}

/**
 * Factory that returns the `open_pr` ToolImpl for a specific tree. The tool:
 *   1. Checks the event log for a prior `pr-opened` for this treeId —
 *      idempotence: refuses with the existing URL on a repeat call.
 *   2. Reads `GITHUB_TOKEN` from `process.env` at execute time.
 *   3. Calls the GitHub REST API (POST /repos/{owner}/{repo}/pulls) via the
 *      injectable fetch transport.
 *   4. Returns the PR URL and appends a `pr-opened` event.
 *
 * No merge/approve/close capability — structural (ADR-025, R13).
 */
export function openPrTool(deps: OpenPrDeps): ToolImpl {
  const { branch, treeId, repoSlug, store, fetchTransport = realFetchTransport } = deps;

  return {
    def: {
      name: 'open_pr',
      description:
        'Open a pull request for the tree\'s branch on the bound GitHub repo. The body should carry proof artifacts, learned notes, and commit SHAs. Idempotent: a second call for the same tree refuses and returns the existing PR URL. No merge, approve, or close capability exists.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'PR title (concise, human-readable).' },
          body: {
            type: 'string',
            description:
              'PR body in Markdown. Include: proof artifacts, learned notes, commit SHAs, and context for the reviewer.',
          },
          base: {
            type: 'string',
            description: 'Base branch for the PR (defaults to "main").',
          },
        },
        required: ['title', 'body'],
      },
    },

    async execute(goal: Goal, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
      // 1. Idempotence: check the event log for a prior pr-opened for this treeId.
      const allEvents = await store.list({ type: 'pr-opened' });
      const prior = allEvents.find(
        (e) => e.type === 'pr-opened' && e.treeId === treeId,
      );
      if (prior && prior.type === 'pr-opened') {
        return {
          ok: false,
          output:
            `open_pr: a PR for tree "${treeId}" already exists: ${prior.url}\n` +
            `Call push_branch again if you have new commits to add, but open_pr is a one-shot operation.`,
        };
      }

      // 2. Read the token from the engine's environment at execute time.
      const token = process.env['GITHUB_TOKEN'] ?? '';
      if (!token) {
        return {
          ok: false,
          output: 'open_pr: GITHUB_TOKEN is not set in the engine environment.',
        };
      }

      // 3. Validate args.
      const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
      const body = typeof args['body'] === 'string' ? args['body'] : '';
      const base = typeof args['base'] === 'string' && args['base'].trim()
        ? args['base'].trim()
        : 'main';

      if (!title) {
        return { ok: false, output: 'open_pr: "title" must be a non-empty string.' };
      }

      // 4. Call the GitHub REST API.
      const apiUrl = `https://api.github.com/repos/${repoSlug}/pulls`;
      let response: FetchResponse;
      try {
        response = await fetchTransport(apiUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title, body, head: branch, base }),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, output: `open_pr: fetch failed: ${msg}` };
      }

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const json = await response.json() as Record<string, unknown>;
          if (typeof json['message'] === 'string') detail = json['message'];
        } catch { /* ignore json parse errors */ }
        return { ok: false, output: `open_pr: GitHub API error: ${detail}` };
      }

      let prUrl: string;
      try {
        const json = await response.json() as Record<string, unknown>;
        prUrl = typeof json['html_url'] === 'string' ? json['html_url'] : '';
        if (!prUrl) throw new Error('html_url missing from GitHub response');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, output: `open_pr: could not read PR URL from GitHub response: ${msg}` };
      }

      // 5. Append pr-opened event.
      await store.append({
        type: 'pr-opened',
        at: Date.now(),
        goalId: goal.id,
        treeId,
        branch,
        url: prUrl,
      });

      return { ok: true, output: `open_pr: PR opened: ${prUrl}` };
    },
  };
}
