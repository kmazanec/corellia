import { createHash } from 'node:crypto';
import type { EventStore } from '../contract/events.js';
import type { Intent, Tier } from '../contract/goal.js';
import type { Registry } from '../contract/goal-type.js';
import type { Artifact } from '../contract/report.js';
import type { Verdict } from '../contract/verdict.js';
import { loadFamilySkill } from '../library/skills.js';

export function enrichRubric(
  registry: Registry,
  baseRubric: string,
  judgeType: string,
  intent: Intent,
): string {
  const intentLine = `The goal's intent is ${intent}. Apply the bar that intent demands per the skill.`;
  const skillBlock = judgeSkillBlock(registry, judgeType);
  return `${baseRubric}\n\n${intentLine}${skillBlock}`;
}

function judgeSkillBlock(registry: Registry, judgeType: string): string {
  if (!registry.has(judgeType)) return '';

  const judgeTypeDef = registry.get(judgeType);
  const familySkill = loadFamilySkill(judgeTypeDef.family);
  if (!familySkill) return '';

  const section = familySkill.sectionFor(judgeType);
  const preamble = familySkill.full.split(/\n## /)[0]!.trim();
  const intentDialSection = familySkill.sectionFor('The intent dial');
  const parts: string[] = [];
  if (preamble) parts.push(preamble);
  if (intentDialSection) parts.push(intentDialSection.trim());
  if (section) parts.push(section.trim());

  return parts.length > 0
    ? `\n\n--- JUDGE SKILL ---\n${parts.join('\n\n')}\n--- END JUDGE SKILL ---`
    : '';
}

export async function appendGoldenCandidate(params: {
  enabled: boolean;
  store: EventStore;
  now: () => number;
  goalId: string;
  judgeType: string;
  artifact: Artifact;
  rubric: string;
  verdict: Verdict;
  tier: Tier;
  brainConfig?: { modelByTier?: Record<string, string> };
}): Promise<void> {
  if (!params.enabled) return;

  const artifactDigest = sha1(artifactDigestInput(params.artifact));
  const rubricDigest = sha1(params.rubric);
  const model = params.brainConfig?.modelByTier?.[params.tier];

  await params.store.append({
    type: 'golden-candidate',
    at: params.now(),
    goalId: params.goalId,
    judgeType: params.judgeType,
    artifactDigest,
    rubricDigest,
    verdictPass: params.verdict.pass,
    tier: params.tier,
    ...(model !== undefined ? { model } : {}),
  });
}

function artifactDigestInput(artifact: Artifact): string {
  return artifact.kind === 'text'
    ? (artifact.text ?? '')
    : JSON.stringify(artifact.files ?? []);
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
