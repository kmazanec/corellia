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

import type { Engine } from '../engine/engine.js';
import type { EventStore, FactoryEvent } from '../contract/events.js';
import type { Intent, MemoryPointer } from '../contract/goal.js';
import type { Report } from '../contract/report.js';
import type { DecisionBrief } from '../contract/decision.js';
import { verifyEntryPoints } from '../library/script-runner.js';
import type { CommissionInput } from '../contract/brief.js';

// ── Public input types ────────────────────────────────────────────────────────

// The commission shape is now a frozen contract (ADR-026). It is re-exported here
// so existing consumers that import it from the listener keep working.
export type { CommissionInput } from '../contract/brief.js';

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

// ── Listener ──────────────────────────────────────────────────────────────────

export class Listener {
  private readonly engine: Engine;
  private readonly store: EventStore;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

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

  constructor(opts: {
    engine: Engine;
    store: EventStore;
    now?: () => number;
    defaultTtlMs?: number;
  }) {
    this.engine = opts.engine;
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
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
  answer(intentId: string, humanAnswer: string): Promise<Report> {
    const entry = this.parked.get(intentId);
    if (!entry) {
      return Promise.reject(new Error(`No parked intent with id "${intentId}"`));
    }

    this.parked.delete(intentId);

    const answerPointer: MemoryPointer = {
      id: `${intentId}:answer`,
      layer: 'project',
      content: `Question: ${entry.question}\nAnswer: ${humanAnswer}`,
      provenance: 'trusted',
    };

    // Record the answer in the event log so re-entry is a traceable checkpoint.
    void this.store.append({
      type: 'resumed',
      at: this.now(),
      goalId: intentId,
      answer: humanAnswer,
    });

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
  tick(now?: number): { bounced: string[] } {
    const t = now ?? this.now();
    const bounced: string[] = [];

    for (const [id, entry] of this.parked) {
      if (t >= entry.deadline) {
        void this.store.append({
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
   * Tiny Live-Run read surface: what is running, queued, and parked right now.
   */
  status(): {
    running: string[];
    queued: string[];
    parked: { id: string; question: string; deadline: number }[];
  } {
    return {
      running: [...this.reservations.keys()],
      queued: this.waitQueue.map((w) => w.input.id),
      parked: [...this.parked.entries()].map(([id, p]) => ({
        id,
        question: p.question,
        deadline: p.deadline,
      })),
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
        return report;
      }
    }

    this.reservations.delete(input.id);
    this.drainWaitQueue();
    return report;
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
  }
}
