import type { ToolDef } from '../contract/tool.js';
import { GRANT_TOOL_MAP } from '../contract/tool.js';

export const NOTE_TOOL_DEF: ToolDef = {
  name: 'note',
  description:
    'Record a short note in your durable working memory (your scratchpad). Use it to ' +
    'distill what a file you read MEANS for the task (e.g. "collectTree is called at ' +
    'engine.ts ~563 in the success branch") so the raw file can be dropped from context ' +
    'without losing the insight. Notes persist across steps; raw reads may be evicted.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The note to remember.' } },
    required: ['text'],
  },
};

/**
 * Whether a goal type's grants include at least one grant that maps to a known
 * tool in GRANT_TOOL_MAP. This predicate selects the step-loop path.
 */
export function isToolGranted(grants: string[]): boolean {
  const allGranted = Object.values(GRANT_TOOL_MAP).flat();
  return grants.some((grant) => allGranted.includes(grant as never));
}

/**
 * Derive the ToolDef array the brain receives for a step, from the intersection
 * of the type's grants and GRANT_TOOL_MAP. The broker remains the executor.
 */
export function deriveToolDefs(
  grants: string[],
  broker?: { defs?: () => ToolDef[] },
): ToolDef[] {
  const brokerDefMap = broker?.defs !== undefined
    ? new Map(broker.defs().map((def) => [def.name, def] as const))
    : new Map<string, ToolDef>();

  const defs: ToolDef[] = [];
  for (const [toolName, toolGrants] of Object.entries(GRANT_TOOL_MAP)) {
    if (!toolGrants.some((grant) => grants.includes(grant))) {
      continue;
    }
    defs.push(brokerDefMap.get(toolName) ?? fallbackToolDef(toolName));
  }
  return defs;
}

function fallbackToolDef(name: string): ToolDef {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: { type: 'object', properties: {}, additionalProperties: true },
  };
}
