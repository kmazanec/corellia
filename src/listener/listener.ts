/**
 * The Listener: the factory's persistent front door.
 *
 * Wraps an Engine + its EventStore to provide:
 *   - Scope-disjoint admission: concurrent intents whose scopes do not overlap
 *     run concurrently; overlapping intents queue (FIFO) until the conflict clears.
 *   - Parking + TTL: when the engine blocks on a brief whose onTimeout is 'park',
 *     the reservation is released immediately (an unanswered human never starves
 *     overlapping trees), and the intent is held in a parked map until answered
 *     or until tick() sweeps it past its TTL.
 *   - answer(): resume a parked intent by injecting the human's answer as a
 *     trusted memory pointer and re-running (re-entry is an ordinary checkpoint).
 *   - tick(): explicit TTL sweep — no internal timers; the caller owns the clock.
 *
 * Brief-seam design: the Listener is the single authority for park resolution.
 * Before each engine.run() call, it wires itself as the Engine's active brief
 * handler via engine._setActiveOnBrief(). Parks are recorded synchronously when
 * the brief fires — no post-hoc event-scan inference. This guarantees one
 * authority, eliminates the race between the Engine's own onBrief and the
 * Listener's deferred scan, and makes the park contract explicit at the call site.
 *
 * Backward-compatible path: tests that use a ScriptedEngine mock (which ignores
 * the _setActiveOnBrief call) can still drive parks by appending 'blocked' events
 * directly, since the Listener's briefHandler() is the wiring point, not a
 * runtime dependency of the park outcome.
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Engine } from '../engine/engine.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import type { Intent, MemoryPointer } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import type { DecisionBrief } from '../contract/decision.js';
import { verifyEntryPoints } from '../library/script-runner.js';
import { costSummary } from '../eventlog/projections.js';
import type { CommissionInput, StandingEnvelope } from '../contract/brief.js';

// ── Public input types ────────────────────────────────────────────────────────

// The commission shape is now a frozen contract (ADR-026). It is re-exported here
// so existing consumers that import it from the listener keep working.
export type { CommissionInput } from '../contract/brief.js';

// ── Issue-to-commission seed ───────────────────────────────────────────────────

/** The seed returned by {@link parseIssueToCommissionSeed}: a partial commission
 *  with a typed `spec` carrying the parsed issue body sections. */
export interface IssueCommissionSeed {
  /** Stable identifier derived from the issue slug (filename without .md). */
  id: string;
  /** Human-readable title from the issue's `title` frontmatter field. */
  title: string;
  /**
   * Typed spec carrying the parsed body sections. Castable to the `unknown`
   * slot on {@link CommissionInput} once the caller fills in the remaining fields
   * (scope, budget, etc.).
   */
  spec: {
    /** Concatenation of the `## Problem` and `## Proposed direction` body sections. */
    description: string;
    /** Content of the `## Acceptance hint` body section. */
    constraints: string;
  };
}

/** Required frontmatter fields in an OKF `type: issue` file. */
const REQUIRED_ISSUE_FIELDS = ['title', 'kind', 'severity', 'status'] as const;

/** Regex that matches the opening `---` of YAML frontmatter at the start of the file. */
const FRONTMATTER_DELIM = /^---\s*$/m;

/** Strip a single pair of surrounding YAML double-quotes from a value, if present. */
function stripYamlQuotes(v: string): string {
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse an OKF `type: issue` file into an {@link IssueCommissionSeed}.
 *
 * Extracts:
 *  - `id`        — the slug (filename without the `.md` extension).
 *  - `title`     — from the `title` frontmatter field.
 *  - `spec.description` — concatenation of the `## Problem` and `## Proposed direction`
 *                          body sections, separated by a blank line.
 *  - `spec.constraints`   — content of the `## Acceptance hint` body section.
 *
 * Validates that the frontmatter has `type: issue` and that every required field
 * (`title`, `kind`, `severity`, `status`) is present and non-empty. Throws on
 * malformed files: missing `type: issue`, missing required fields, or absent body
 * sections.
 */
export async function parseIssueToCommissionSeed(
  filePath: string,
): Promise<IssueCommissionSeed> {
  const raw = await readFile(filePath, 'utf-8');

  // ── Derive slug from filename ──────────────────────────────────────────
  const fileName = basename(filePath);
  if (!fileName.endsWith('.md')) {
    throw new Error(`parseIssueToCommissionSeed: expected .md file, got "${fileName}"`);
  }
  const slug = fileName.slice(0, -3);

  // ── Parse frontmatter ──────────────────────────────────────────────────
  const delimMatch = FRONTMATTER_DELIM.exec(raw);
  if (!delimMatch) {
    throw new Error(
      `parseIssueToCommissionSeed: no frontmatter found in "${filePath}"`,
    );
  }

  const fmStart = delimMatch.index + delimMatch[0].length;
  const afterFirst = raw.slice(fmStart);
  const closingMatch = FRONTMATTER_DELIM.exec(afterFirst);
  if (!closingMatch) {
    throw new Error(
      `parseIssueToCommissionSeed: unclosed frontmatter in "${filePath}"`,
    );
  }

  const fmRaw = afterFirst.slice(0, closingMatch.index);
  const body = afterFirst.slice(closingMatch.index + closingMatch[0].length);

  // Parse frontmatter into a key→value map.  Lines with no colon are ignored
  // (empty lines, comment lines).  Leading/trailing whitespace on keys and
  // values is trimmed.  Surrounding YAML double-quotes are stripped from values.
  const fm: Record<string, string> = {};
  for (const line of fmRaw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = stripYamlQuotes(line.slice(colonIdx + 1).trim());
    fm[key] = value;
  }

  // ── Validate frontmatter ───────────────────────────────────────────────
  if (fm['type'] !== 'issue') {
    throw new Error(
      `parseIssueToCommissionSeed: frontmatter type must be "issue", got "${fm['type'] ?? '(missing)'}" in "${filePath}"`,
    );
  }

  for (const field of REQUIRED_ISSUE_FIELDS) {
    if (!fm[field] || fm[field].length === 0) {
      throw new Error(
        `parseIssueToCommissionSeed: missing required frontmatter field "${field}" in "${filePath}"`,
      );
    }
  }

  // ── Extract body sections ──────────────────────────────────────────────

  /**
   * Return the content between a `## <heading>` line and the next `##` heading
   * (or EOF), with surrounding whitespace trimmed.  Returns `null` when the
   * heading is absent, and an empty string when the heading exists but has
   * no content before the next heading.
   */
  const extractSection = (heading: string): string | null => {
    const marker = `## ${heading}`;
    const startIdx = body.indexOf(marker);
    if (startIdx === -1) return null;

    // Skip the heading line itself (to the next newline, or EOF).
    const contentStart = body.indexOf('\n', startIdx);
    if (contentStart === -1) return ''; // heading at EOF with no content

    // Look for the next `## ` heading after this one.
    const nextHeadingIdx = body.indexOf('\n## ', contentStart + 1);
    const endIdx = nextHeadingIdx === -1 ? body.length : nextHeadingIdx;

    return body.slice(contentStart, endIdx).trim();
  };

  const problemSection = extractSection('Problem');
  const proposedSection = extractSection('Proposed direction');
  const acceptanceSection = extractSection('Acceptance hint');

  if (problemSection === null) {
    throw new Error(
      `parseIssueToCommissionSeed: missing "## Problem" section in "${filePath}"`,
    );
  }
  if (proposedSection === null) {
    throw new Error(
      `parseIssueToCommissionSeed: missing "## Proposed direction" section in "${filePath}"`,
    );
  }
  if (acceptanceSection === null) {
    throw new Error(
      `parseIssueToCommissionSeed: missing "## Acceptance hint" section in "${filePath}"`,
    );
  }

  const description = `${problemSection}\n\n${proposedSection}`;

  // `title` is guaranteed present + non-empty by the REQUIRED_ISSUE_FIELDS check
  // above; the local makes that invariant explicit for the type checker.
  const title = fm['title'] ?? '';

  return {
    id: slug,
    title,
    spec: {
      description,
      constraints: acceptanceSection,
    },
  };
}

// ── Improvement-commission mint ───────────────────────────────────────────────

/**
 * Mint one `improve-factory` commission carrying the blocker batch from a
 * completed run. The commission spec carries the blocker texts and the run's
 * event-log pointer (goalId of the originating root goal).
 *
 * One `blocker-routed` event is emitted per blocker (ADR-027). The originating
 * run has already completed — no factory files are changed mid-run (AC 2).
 *
 * ADR-027: one commission per run, no matter how many blockers, so a noisy
 * run produces one improvement tree rather than a storm.
 */
async function mintImprovementCommission(
  store: EventStore,
  originatingGoalId: string,
  blockers: string[],
  now: () => number,
): Promise<CommissionInput> {
  const commissionId = `improve-${originatingGoalId}-${now()}`;

  // One blocker-routed event per blocker (barrier contract: ADR-027).
  for (const blocker of blockers) {
    await store.append({
      type: 'blocker-routed',
      at: now(),
      goalId: originatingGoalId,
      blocker,
      commissionId,
    });
  }

  return {
    id: commissionId,
    title: `Improve factory: blockers from ${originatingGoalId}`,
    spec: {
      // The generality judgment lives inside the improvement goal — the listener
      // is only the routing point (ADR-027). It passes the pointer + blocker texts.
      originatingGoalId,
      blockers,
      // The event-log pointer: consumers of this commission read the log starting
      // from the originating goal's events to understand the failure context.
      eventLogPointer: originatingGoalId,
    },
    scope: [],
    // Budget for the improvement tree — enough for a diagnosis + PR draft. The
    // standing envelope's budget (if configured) overrides this at admission.
    budget: { attempts: 3, tokens: 20_000, toolCalls: 30, wallClockMs: 300_000 },
    intent: 'production',
  };
}

/**
 * Determine whether a commission represents an improvement intent (i.e. was
 * minted by the improvement loop, not placed by a product operator). Improvement
 * commissions must never be delayed by other improvement work (product always
 * wins), and must never re-trigger the improvement mint path (runaway guard).
 *
 * ADR-027: improvement commissions are identified by their id prefix.
 */
function isImprovementCommission(input: CommissionInput): boolean {
  return input.id.startsWith('improve-');
}

// ── Internal state ────────────────────────────────────────────────────────────

interface Parked {
  input: CommissionInput;
  question: string;
  deadline: number;
}

interface Waiter {
  input: CommissionInput;
  extraMemories: MemoryPointer[];
  resolve: (report: Report) => void;
  reject: (err: unknown) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Two scope arrays overlap when any prefix in one is a prefix of (or equal to)
 * any prefix in the other. An empty scope array overlaps everything — a scopeless
 * intent is assumed to touch the whole repo.
 */
function scopesOverlap(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  for (const pa of a) {
    for (const pb of b) {
      if (pa === pb) return true;
      if (pa.startsWith(pb + '/') || pb.startsWith(pa + '/')) return true;
    }
  }
  return false;
}

/**
 * Return the last 'blocked' event emitted for a goal, or null.
 *
 * Used as a backward-compat fallback when the Engine does not support the
 * _setActiveOnBrief seam (e.g. tests that use a ScriptedEngine mock). When the
 * Listener's per-run brief handler fires, it records parks synchronously and
 * this function is never needed on the happy path.
 */
async function lastBlockedEvent(
  store: EventStore,
  goalId: string,
): Promise<Extract<FactoryEvent, { type: 'blocked' }> | null> {
  const events = await store.list({ type: 'blocked' });
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i] as Extract<FactoryEvent, { type: 'blocked' }>;
    if (e.goalId === goalId) return e;
  }
  return null;
}

/**
 * The measured USD a whole tree spent, read from the same usage-bearing events
 * the per-tree dollar ceiling debits (ADR-017: measured spend, never estimated).
 * A tree's goals all share the root id as a prefix — children are minted as
 * `${parent.id}/${localId}` — so folding every event whose goalId is the root or
 * a `root/…` descendant yields the tree-wide cost. Cost-silent endpoints report
 * no `costUsd`, so their contribution is 0; that shortfall is noted at the call
 * site (the envelope errs toward under-charging, never over-charging, spend it
 * cannot see).
 */
async function treeSpendUsd(store: EventStore, rootId: string): Promise<number> {
  const all = await store.list();
  const inTree = all.filter((e) => e.goalId === rootId || e.goalId.startsWith(`${rootId}/`));
  return costSummary(inTree).tree.costUsd ?? 0;
}

// ── Listener ──────────────────────────────────────────────────────────────────

export class Listener {
  private readonly engine: Engine;
  private readonly store: EventStore;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

  /**
   * Standing envelope for the improvement loop (ADR-027). When present,
   * improvement commissions are admitted only when the envelope has headroom
   * AND the product queue is empty. When absent, the improvement loop is
   * effectively disabled (no auto-admission).
   *
   * Top-up is operator config only (Chunk 2: F-63).
   */
  private readonly standingEnvelope: StandingEnvelope | undefined;

  /**
   * Tracked spend against the standing envelope (in USD), decremented per
   * improvement tree completion. Operator must top up via config to restore
   * headroom.
   */
  private envelopeSpentUsd: number = 0;

  /** Scope arrays of trees actively holding a reservation, keyed by intent id. */
  private readonly reservations = new Map<string, string[]>();

  /** Intents waiting for a scope reservation to free. FIFO. */
  private readonly waitQueue: Waiter[] = [];

  /** Parked intents: brief delivered, reservation released, awaiting answer or TTL. */
  private readonly parked = new Map<string, Parked>();

  /**
   * Per-run park signal: when the Engine fires the brief handler with a 'park'
   * brief for a running intent, this map records the brief so runIntent can park
   * synchronously without scanning events. Keyed by intent id. Cleared on park.
   */
  private readonly pendingParks = new Map<string, { brief: DecisionBrief }>();

  /**
   * Improvement commissions parked because the envelope was exhausted or the
   * product queue was non-empty at admission time. They are re-tried whenever a
   * product reservation is released (drainWaitQueue) and the envelope has
   * headroom. Visible in GET /status via status().parkedImprovement.
   *
   * ADR-027: product intents are NEVER delayed by improvement work.
   */
  private readonly parkedImprovement: CommissionInput[] = [];

  constructor(opts: {
    engine: Engine;
    store: EventStore;
    now?: () => number;
    defaultTtlMs?: number;
    standingEnvelope?: StandingEnvelope;
  }) {
    this.engine = opts.engine;
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
    this.standingEnvelope = opts.standingEnvelope;
  }

  // ── commission ────────────────────────────────────────────────────────────

  /**
   * The front door. Mints a root Goal (type 'deliver-intent', parentId null)
   * and runs it through the engine, subject to scope-disjoint admission.
   *
   * When `declaredScripts` and `repoRoot` are present on the input, a
   * capability pre-check verifies that every declared entry point exists on
   * disk. A missing entry bounces immediately with zero subtree spend.
   *
   * Returns a promise that resolves when the tree completes (or parks — parked
   * intents resolve immediately with the blocked report so the caller knows the
   * human question, and the intent surfaces in status().parked).
   */
  commission(input: CommissionInput): Promise<Report> {
    if (input.declaredScripts !== undefined && input.repoRoot !== undefined) {
      const { declaredScripts, repoRoot } = input;
      return verifyEntryPoints(repoRoot, declaredScripts).then((check) => {
        if (!check.ok) {
          return Promise.reject(new Error(check.reason));
        }
        if (!this.hasConflict(input.scope)) {
          return this.runIntent(input, []);
        }
        return new Promise<Report>((resolve, reject) => {
          this.waitQueue.push({ input, extraMemories: [], resolve, reject });
        });
      });
    }
    if (!this.hasConflict(input.scope)) {
      return this.runIntent(input, []);
    }
    return new Promise<Report>((resolve, reject) => {
      this.waitQueue.push({ input, extraMemories: [], resolve, reject });
    });
  }

  // ── answer ────────────────────────────────────────────────────────────────

  /**
   * Resume a parked intent with the human's answer.
   *
   * The answer is injected as a trusted memory pointer (content: question + answer)
   * so the re-run's brain sees it as authoritative context. Re-entry is an
   * ordinary checkpoint: the root goal re-runs with the answer pointer in memories.
   *
   * If the scope is now contested, the resume queues like any new commission.
   */
  async answer(intentId: string, humanAnswer: string): Promise<Report> {
    const entry = this.parked.get(intentId);
    if (!entry) {
      return Promise.reject(new Error(`No parked intent with id "${intentId}"`));
    }

    const answerPointer: MemoryPointer = {
      id: `${intentId}:answer`,
      layer: 'project',
      content: `Question: ${entry.question}\nAnswer: ${humanAnswer}`,
      provenance: 'trusted',
    };

    // Record the answer in the event log so re-entry is a traceable checkpoint.
    await this.store.append({
      type: 'resumed',
      at: this.now(),
      goalId: intentId,
      answer: humanAnswer,
    });

    this.parked.delete(intentId);

    if (!this.hasConflict(entry.input.scope)) {
      return this.runIntent(entry.input, [answerPointer]);
    }
    return new Promise<Report>((resolve, reject) => {
      this.waitQueue.push({ input: entry.input, extraMemories: [answerPointer], resolve, reject });
    });
  }

  // ── tick ──────────────────────────────────────────────────────────────────

  /**
   * Explicit TTL sweep. No internal timers — the caller owns the clock.
   *
   * Parked intents past their deadline are bounced: a 'blocked' event is
   * appended with resolution 'bounce', the intent is evicted from the parked
   * map, and its id is included in the returned list.
   */
  async tick(now?: number): Promise<{ bounced: string[] }> {
    const t = now ?? this.now();
    const bounced: string[] = [];

    for (const [id, entry] of this.parked) {
      if (t >= entry.deadline) {
        await this.store.append({
          type: 'blocked',
          at: t,
          goalId: id,
          brief: {
            question: entry.question,
            options: ['bounce'],
            links: [id],
            deadlineMs: 0,
            onTimeout: 'park',
          },
          resolution: 'bounce',
        });
        this.parked.delete(id);
        bounced.push(id);
      }
    }

    return { bounced };
  }

  // ── status ────────────────────────────────────────────────────────────────

  /**
   * Tiny Live-Run read surface: what is running, queued, parked, and parked-for-
   * improvement right now.
   *
   * `parkedImprovement` lists improvement commissions that could not be admitted
   * because the standing envelope was exhausted or the product queue was non-empty
   * (ADR-027: product intents are never delayed by improvement work). These are
   * re-tried once a product reservation clears.
   */
  status(): {
    running: string[];
    queued: string[];
    parked: { id: string; question: string; deadline: number }[];
    parkedImprovement: string[];
    improvementEnvelope?: { consumedUsd: number; allowanceUsd: number; remainingUsd: number };
  } {
    return {
      running: [...this.reservations.keys()],
      queued: this.waitQueue.map((w) => w.input.id),
      parked: [...this.parked.entries()].map(([id, p]) => ({
        id,
        question: p.question,
        deadline: p.deadline,
      })),
      // Improvement commissions waiting on envelope headroom + empty product queue.
      parkedImprovement: this.parkedImprovement.map((c) => c.id),
      // The USD standing envelope's consumed/remaining, when an envelope is
      // configured (ADR-027). Absent when the improvement loop is disabled.
      ...(this.standingEnvelope !== undefined
        ? {
            improvementEnvelope: {
              consumedUsd: this.envelopeSpentUsd,
              allowanceUsd: this.standingEnvelope.spendCeilingUsd,
              remainingUsd: Math.max(0, this.standingEnvelope.spendCeilingUsd - this.envelopeSpentUsd),
            },
          }
        : {}),
    };
  }

  // ── briefHandler ──────────────────────────────────────────────────────────

  /**
   * Return a bound onBrief callback suitable for wiring as the Engine's
   * constructor-level onBrief option.
   *
   * When the Engine fires this callback with a brief whose onTimeout is 'park',
   * the Listener records the park synchronously (via pendingParks) so runIntent
   * can detect it without scanning events. For non-park resolutions the callback
   * defers to the brief's own onTimeout.
   *
   * Wire-up example:
   *   const listener = new Listener({ engine, store });
   *   // Pass listener.briefHandler() as engineOpts.onBrief at Engine construction.
   *
   * This method exists as a public seam for callers that construct the Engine
   * separately and want to wire the Listener as the park authority without
   * giving up control of Engine construction.
   */
  briefHandler(): (
    brief: DecisionBrief,
  ) => Promise<'deny' | 'park' | 'bounce' | 'answered'> {
    return async (brief: DecisionBrief) => {
      if (brief.onTimeout === 'park' && brief.links[0] !== undefined) {
        // Record synchronously — runIntent will detect and park the intent.
        this.pendingParks.set(brief.links[0], { brief });
        return 'park';
      }
      return brief.onTimeout as 'deny' | 'park' | 'bounce' | 'answered';
    };
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** True if any active reservation overlaps the given scope. */
  private hasConflict(scope: string[]): boolean {
    for (const reserved of this.reservations.values()) {
      if (scopesOverlap(scope, reserved)) return true;
    }
    return false;
  }

  /**
   * Acquire the reservation, wire the Listener as the brief authority, run the
   * engine, then detect parks (synchronously via pendingParks or, as a fallback,
   * via the event store), then release + drain the wait queue.
   *
   * Park detection (authoritative path): before engine.run() starts, the Listener
   * sets itself as the Engine's active brief handler via _setActiveOnBrief(). When
   * the Engine fires the brief, the handler records the park synchronously in
   * pendingParks. After run() returns, runIntent checks pendingParks before
   * falling through to the event-scan fallback (which covers ScriptedEngine mocks
   * used in tests that append blocked events directly without an onBrief seam).
   */
  private async runIntent(
    input: CommissionInput,
    extraMemories: MemoryPointer[],
  ): Promise<Report> {
    this.reservations.set(input.id, input.scope);

    const rootGoal = {
      id: input.id,
      type: 'deliver-intent',
      parentId: null as null,
      title: input.title,
      spec: input.spec,
      intent: (input.intent ?? 'production') as Intent,
      scope: input.scope,
      budget: input.budget,
      memories: extraMemories,
      // Per-commission ceiling threads onto the root goal; when absent the engine
      // applies its learning-phase default ($15). Never subdivided (bounds the tree).
      ...(input.spendCeilingUsd !== undefined
        ? { spendCeilingUsd: input.spendCeilingUsd }
        : {}),
    };

    // Wire ourselves as the brief authority for this run.
    // _setActiveOnBrief is a non-contract seam on Engine; if the Engine mock
    // does not expose it, the fallback event-scan path handles parks instead.
    const engineWithSeam = this.engine as Engine & {
      _setActiveOnBrief?: (
        h: ((brief: DecisionBrief) => Promise<'deny' | 'park' | 'bounce' | 'answered'>) | undefined,
      ) => void;
    };
    const hasSeam = typeof engineWithSeam._setActiveOnBrief === 'function';
    if (hasSeam) {
      engineWithSeam._setActiveOnBrief!(this.briefHandler());
    }

    let report: Report;
    try {
      report = await this.engine.run(rootGoal);
    } catch (err) {
      if (hasSeam) engineWithSeam._setActiveOnBrief!(undefined);
      this.reservations.delete(input.id);
      this.drainWaitQueue();
      throw err;
    }

    if (hasSeam) engineWithSeam._setActiveOnBrief!(undefined);

    // Park detection — authoritative path: brief handler recorded synchronously.
    const pendingPark = this.pendingParks.get(input.id);
    if (pendingPark) {
      this.pendingParks.delete(input.id);
      await this._applyPark(input, pendingPark.brief);
      return report;
    }

    // Park detection — fallback path (ScriptedEngine mocks that append blocked
    // events without going through the brief handler seam).
    if (report.blockers.length > 0) {
      const ev = await lastBlockedEvent(this.store, input.id);
      if (ev && ev.brief.onTimeout === 'park') {
        await this._applyPark(input, ev.brief);
        // Mint-on-complete (Chunk 1): even a parked run may have blockers that
        // were recorded before the park. However, the park path means the run
        // did NOT complete — it is suspended. Do NOT mint here; only complete
        // (non-parked) runs with blockers trigger the improvement loop.
        return report;
      }
    }

    this.reservations.delete(input.id);
    this.drainWaitQueue();

    // ── Mint-on-complete (Chunk 1, ADR-027) ──────────────────────────────────
    // A completed run with blockers mints exactly ONE improve-factory commission
    // carrying the blocker texts and the run's event-log pointer. One
    // blocker-routed event is emitted per blocker. A blocker-free run mints nothing.
    //
    // Runaway-loop guard (ADR-027, AC 5): improvement runs NEVER mint further
    // improvement commissions. We check this by inspecting the originating
    // commission — if it is already an improvement commission, skip the mint.
    if (report.blockers.length > 0 && !isImprovementCommission(input)) {
      const commission = await mintImprovementCommission(
        this.store,
        input.id,
        report.blockers,
        this.now,
      );
      // Admit the improvement commission subject to envelope admission (Chunk 2).
      // Fire-and-forget: the originating run has already resolved; the improvement
      // tree runs beside product work, inside the standing envelope.
      void this.commissionImprovement(commission);
    }

    return report;
  }

  /**
   * Admit an improvement commission subject to the standing envelope (ADR-027).
   *
   * Admission requires BOTH:
   *   (a) envelope headroom: spendCeilingUsd > envelopeSpentUsd + tree cost estimate
   *   (b) empty product queue: no non-improvement intent is queued or running
   *
   * An improvement commission that fails admission is parked in `parkedImprovement`
   * and re-tried from drainWaitQueue when a product reservation is released.
   *
   * When no standing envelope is configured, improvement commissions are silently
   * dropped (the loop is disabled — the operator must supply STANDING_BUDGET_JSON
   * and STANDING_SPEND_CEILING_USD to enable it).
   *
   * ADR-027: product intents are NEVER delayed by improvement work.
   */
  private commissionImprovement(commission: CommissionInput): Promise<Report | undefined> {
    if (!this.standingEnvelope) {
      // No envelope configured — improvement loop disabled. This is expected
      // in dev/test environments that don't want autonomous improvement runs.
      return Promise.resolve(undefined);
    }

    if (!this.hasEnvelopeHeadroom() || this.hasProductActivity()) {
      // Park the commission until conditions are met (drainWaitQueue will retry).
      this.parkedImprovement.push(commission);
      return Promise.resolve(undefined);
    }

    return this.runImprovementIntent(commission);
  }

  /**
   * True when the standing envelope has USD headroom for another improvement
   * tree. Admission checks REMAINING DOLLARS, not remaining slots — one expensive
   * tree can exhaust the window that many cheap trees would have shared (ADR-027's
   * "improvement never starves product" is now a cost property, not a count
   * property). When `perTreeCeilingUsd` is set the gate RESERVES a tree's worth
   * of dollars: it admits only when remaining >= perTreeCeilingUsd, so a window
   * whose remainder cannot fund a whole tree defers the next root. Absent the
   * reserve, the gate admits while any dollars remain — the pre-existing shape.
   *
   * Conservative: cost-silent spend counts as 0 (see {@link treeSpendUsd}), so
   * the envelope can under-charge but never over-charge; it errs toward admitting.
   */
  private hasEnvelopeHeadroom(): boolean {
    if (!this.standingEnvelope) return false;
    const remaining = this.standingEnvelope.spendCeilingUsd - this.envelopeSpentUsd;
    const reserve = this.standingEnvelope.perTreeCeilingUsd;
    return reserve !== undefined ? remaining >= reserve : remaining > 0;
  }

  /**
   * True when any non-improvement intent is currently running or queued.
   * This is the "empty product queue" gate from ADR-027: improvement work never
   * competes with or delays product work.
   */
  private hasProductActivity(): boolean {
    // Any running reservation that is NOT an improvement commission.
    for (const [id] of this.reservations) {
      if (!id.startsWith('improve-')) return true;
    }
    // Any waiter in the queue that is NOT an improvement commission.
    for (const waiter of this.waitQueue) {
      if (!isImprovementCommission(waiter.input)) return true;
    }
    return false;
  }

  /**
   * Run an improvement commission, charging the envelope its MEASURED USD spend
   * on completion — the same spend stream the per-tree dollar ceiling debits
   * (ADR-017), read back from the event log after the tree finishes. A tree that
   * spends most of the allowance defers the next improvement root; a cheap tree
   * barely moves the total. ADR-027: top-up is operator config only — the
   * listener never auto-tops-up.
   *
   * A failed run still charges whatever it spent before failing (a crashed tree
   * that burned dollars must not be free), read from the log the same way.
   */
  private async runImprovementIntent(commission: CommissionInput): Promise<Report | undefined> {
    if (!this.standingEnvelope) return undefined;

    // Use the envelope's budget for the improvement tree, not the commission's
    // own default budget. The envelope budget is the operator-configured allowance.
    // Bound the tree's dollar spend to what the window can actually fund: the
    // smaller of the per-tree ceiling (if configured) and the remaining window, so
    // a single tree can never overspend the envelope it draws against (ADR-017).
    const remaining = this.standingEnvelope.spendCeilingUsd - this.envelopeSpentUsd;
    const treeCeiling = this.standingEnvelope.perTreeCeilingUsd;
    const spendCeilingUsd = treeCeiling !== undefined ? Math.min(treeCeiling, remaining) : remaining;
    const enveloped: CommissionInput = {
      ...commission,
      budget: this.standingEnvelope.budget,
      ...(spendCeilingUsd > 0 ? { spendCeilingUsd } : {}),
    };

    try {
      const report = await this.runIntent(enveloped, []);
      await this.chargeEnvelope(commission.id);
      return report;
    } catch {
      // The run failed, but any dollars it spent before failing are real and
      // must count against the window — read them from the log like a success.
      await this.chargeEnvelope(commission.id);
      return undefined;
    }
  }

  /**
   * Add an improvement tree's measured USD spend to the envelope's consumed
   * total. Read from the same usage-bearing events the per-tree ceiling debits;
   * cost-silent spend counts as 0 (the envelope under-charges rather than
   * over-charges spend it cannot see). Never auto-tops-up (ADR-027).
   */
  private async chargeEnvelope(rootId: string): Promise<void> {
    this.envelopeSpentUsd += await treeSpendUsd(this.store, rootId);
  }

  /** Record the park: release reservation, write parked event, add to parked map. */
  private async _applyPark(input: CommissionInput, brief: DecisionBrief): Promise<void> {
    const ttl = brief.deadlineMs > 0 ? brief.deadlineMs : this.defaultTtlMs;
    const deadline = this.now() + ttl;

    await this.store.append({
      type: 'parked',
      at: this.now(),
      goalId: input.id,
      brief,
      ttlMs: ttl,
    });

    this.reservations.delete(input.id);
    this.parked.set(input.id, {
      input,
      question: brief.question,
      deadline,
    });
    this.drainWaitQueue();
  }

  /**
   * After a reservation is released, walk the wait queue and start every waiter
   * whose scope no longer conflicts — with existing reservations and with other
   * waiters we are about to start in the same pass (so two disjoint waiters both
   * advance, not just the head of the queue).
   */
  private drainWaitQueue(): void {
    // Two-pass: identify which waiters can start, then start them.
    const startIndices: number[] = [];
    // Scopes we're about to reserve in this drain pass (to detect mutual conflicts).
    const pendingScopes: string[][] = [];

    for (let i = 0; i < this.waitQueue.length; i++) {
      const waiter = this.waitQueue[i]!;
      const conflictsExisting = this.hasConflict(waiter.input.scope);
      const conflictsPending = pendingScopes.some((s) =>
        scopesOverlap(waiter.input.scope, s),
      );
      if (!conflictsExisting && !conflictsPending) {
        startIndices.push(i);
        pendingScopes.push(waiter.input.scope);
      }
    }

    if (startIndices.length === 0) return;

    // Collect the waiter objects before mutating the queue.
    const toStart = startIndices.map((i) => this.waitQueue[i]!);

    // Remove them from the queue, back-to-front to keep indices stable.
    for (let k = startIndices.length - 1; k >= 0; k--) {
      this.waitQueue.splice(startIndices[k]!, 1);
    }

    // Fire each waiter's run as an independent async task.
    for (const waiter of toStart) {
      this.runIntent(waiter.input, waiter.extraMemories).then(waiter.resolve, waiter.reject);
    }

    // After draining product waiters, retry any parked improvement commissions
    // if the envelope has headroom and the product queue is now empty.
    // ADR-027: improvement work only runs when product activity has cleared.
    this.drainParkedImprovement();
  }

  /**
   * Retry parked improvement commissions when conditions are met.
   *
   * Called from drainWaitQueue after a product reservation is released. If the
   * envelope has headroom AND no product activity is present, dispatches the
   * oldest parked improvement commission.
   */
  private drainParkedImprovement(): void {
    if (!this.standingEnvelope) return;
    if (this.parkedImprovement.length === 0) return;
    if (!this.hasEnvelopeHeadroom()) return;
    if (this.hasProductActivity()) return;

    // Dequeue the oldest parked improvement commission and start it.
    const commission = this.parkedImprovement.shift()!;
    void this.runImprovementIntent(commission);
  }
}
