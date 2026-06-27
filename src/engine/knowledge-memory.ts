import type { MemoryPointer } from '../contract/goal.js';
import type { RegionFacts } from '../contract/knowledge.js';

export type FactsForRegions = (repoRoot: string, scope: string[]) => Promise<RegionFacts[]>;

export async function diveFactsAsMemories(params: {
  factsForRegions: FactsForRegions | undefined;
  repoRoot: string;
  scope: string[];
  headSha: string;
}): Promise<MemoryPointer[]> {
  if (params.factsForRegions === undefined || params.repoRoot.length === 0) return [];

  let regionFacts: RegionFacts[];
  try {
    regionFacts = await params.factsForRegions(params.repoRoot, params.scope);
  } catch {
    return [];
  }

  return regionFactsToMemories(regionFacts, params.headSha);
}

export function regionFactsToMemories(regionFacts: RegionFacts[], headSha: string): MemoryPointer[] {
  const pointers: MemoryPointer[] = [];

  for (const facts of regionFacts) {
    const fresh = headSha.length > 0 && facts.generatedAtSha === headSha;
    facts.facts.forEach((fact, index) => {
      const anchors = fact.anchors.map((anchor) => `${anchor.path}:${anchor.line}`).join(', ');
      pointers.push({
        id: `dive:${facts.region}#${index}`,
        layer: 'project',
        content: anchors.length > 0 ? `${fact.claim} — ${anchors}` : fact.claim,
        provenance: fresh ? 'trusted' : 'provisional',
      });
    });
  }

  return pointers;
}
