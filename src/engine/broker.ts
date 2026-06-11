/**
 * The single mediator for every tool call. One instance per tree, bound to
 * that tree's sandbox root. `execute` checks the goal-type's exact grant via
 * the GRANT_TOOL_MAP, checks write paths against the goal's scope, appends a
 * tool-call event (ran or refused), then dispatches to the matching ToolImpl.
 *
 * Refusal is data, never a throw: ungranted and out-of-scope calls return
 * `ok: false` with a stated reason, and execution continues.
 */

import type { Goal } from '../contract/goal.js';
import type { ToolCall, ToolDef, ToolImpl, ToolResult } from '../contract/tool.js';
import { GRANT_TOOL_MAP } from '../contract/tool.js';
import type { EventStore } from '../contract/events.js';
import type { Registry } from '../contract/goal-type.js';
import { resolveSandboxPath, isInScope } from './tools.js';

/**
 * Options for constructing a Broker. The dispatch table is injectable so
 * additional tool impls (e.g. run_script) can be registered at assembly
 * without modifying this file.
 */
export interface BrokerOptions {
  /** The tree's sandbox root; paths for write_file are validated against it. */
  root: string;
  /** Goal-type registry for resolving the calling goal's grants. */
  registry: Registry;
  /** Event store for appending tool-call events. */
  store: EventStore;
  /** The injectable dispatch table of tool implementations. */
  tools: ToolImpl[];
}

/**
 * The ToolBroker implementation. One instance per tree. The dispatch table is
 * supplied at construction; the broker never reaches beyond it.
 */
export class Broker {
  readonly #root: string;
  readonly #registry: Registry;
  readonly #store: EventStore;
  readonly #tools: Map<string, ToolImpl>;

  constructor(options: BrokerOptions) {
    this.#root = options.root;
    this.#registry = options.registry;
    this.#store = options.store;
    this.#tools = new Map(options.tools.map((t) => [t.def.name, t]));
  }

  /**
   * Mediate one tool call for a goal: grant-check → scope-check (write_file
   * only) → append event → dispatch. Returns a refusal result for any
   * enforcement failure rather than throwing.
   */
  async execute(goal: Goal, call: ToolCall): Promise<ToolResult> {
    // 1. Resolve the goal-type's grants.
    let goalType;
    try {
      goalType = this.#registry.get(goal.type);
    } catch {
      return this.#refuse(goal, call, `unknown goal type "${goal.type}"`);
    }

    // 2. Grant check: the goal-type's grants must include at least one of the
    //    GRANT_TOOL_MAP entries for the requested tool.
    const requiredGrants = GRANT_TOOL_MAP[call.name as keyof typeof GRANT_TOOL_MAP];
    if (requiredGrants === undefined) {
      // Tool name not in the map — unknown tool.
      return this.#refuse(goal, call, `unknown tool "${call.name}"`);
    }

    const granted = requiredGrants.some((g) => goalType.grants.includes(g));
    if (!granted) {
      const needed = requiredGrants.join(' or ');
      return this.#refuse(goal, call, `not granted: ${needed}`);
    }

    // 3. For write_file: check sandbox containment and goal scope before
    //    touching the event log. An out-of-scope write is logged as 'refused'
    //    with a reason — not as 'ran' — so the audit trail is honest.
    if (call.name === 'write_file') {
      const rawPath = typeof call.args['path'] === 'string' ? call.args['path'] : '';
      const full = rawPath ? resolveSandboxPath(this.#root, rawPath) : null;
      if (full === null) {
        return this.#refuse(goal, call, `write_file: path "${rawPath}" is outside the sandbox root`);
      }
      if (!isInScope(rawPath, goal.scope)) {
        return this.#refuse(goal, call, `write_file: path "${rawPath}" is outside the goal's declared scope`);
      }
    }

    // 4. Look up the implementation.
    const impl = this.#tools.get(call.name);
    if (impl === undefined) {
      return this.#refuse(goal, call, `tool "${call.name}" is not registered in this broker`);
    }

    // 5. Append a 'ran' event and dispatch.
    await this.#store.append({
      type: 'tool-call',
      at: Date.now(),
      goalId: goal.id,
      tool: call.name,
      callId: call.id,
      outcome: 'ran',
    });

    const outcome = await impl.execute(goal, call.args);
    return { callId: call.id, ok: outcome.ok, output: outcome.output };
  }

  /**
   * Expose the ToolDef for every registered tool implementation.
   * Used by the engine's deriveToolDefs to obtain real parameter schemas
   * instead of synthesizing empty ones.
   */
  defs(): ToolDef[] {
    return Array.from(this.#tools.values()).map((impl) => impl.def);
  }

  /** Append a refusal event and return a refusal ToolResult. */
  async #refuse(goal: Goal, call: ToolCall, reason: string): Promise<ToolResult> {
    await this.#store.append({
      type: 'tool-call',
      at: Date.now(),
      goalId: goal.id,
      tool: call.name,
      callId: call.id,
      outcome: 'refused',
      reason,
    });
    return { callId: call.id, ok: false, output: reason };
  }
}
