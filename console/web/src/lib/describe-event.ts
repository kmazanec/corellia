/**
 * One trace line per factory event: a short kind, a sentence, and a tone that
 * picks the line's rule colour (the Plate legend: brass active, moss pass,
 * oxblood fail, teal human).
 */

import type { FactoryEvent } from '../factory';
import { usd } from './format';

export type Tone = 'active' | 'pass' | 'fail' | 'human' | 'tool' | 'quiet';

export interface Described {
  kind: string;
  text: string;
  tone: Tone;
}

const spend = (u?: { costUsd?: number }): string => (u?.costUsd ? ` · ${usd(u.costUsd)}` : '');

export function describeEvent(e: FactoryEvent): Described {
  switch (e.type) {
    case 'goal-received':
      return { kind: 'received', text: `[${e.goal.type}] ${e.goal.title}`, tone: 'active' };
    case 'decided': {
      const d = e.decision;
      const text =
        d.kind === 'split'
          ? `split into ${d.children.length}: ${d.children.map((c) => c.title).join(' · ')}`
          : d.kind === 'block'
            ? `block — ${d.brief.question}`
            : 'satisfy here';
      return { kind: 'decided', text: text + spend(e.usage), tone: d.kind === 'block' ? 'human' : 'active' };
    }
    case 'child-spawned':
      return { kind: 'spawned', text: `${e.childType} ${e.childId}${e.dependsOn.length ? ` after ${e.dependsOn.join(', ')}` : ''}`, tone: 'quiet' };
    case 'tool-call': {
      const arg = e.args ? Object.values(e.args)[0] : undefined;
      const text = `${e.tool}${arg !== undefined ? ` ${arg}` : ''}${e.outcome === 'refused' ? ` — refused${e.reason ? `: ${e.reason}` : ''}` : ''}`;
      return { kind: 'tool', text, tone: e.outcome === 'refused' ? 'fail' : 'tool' };
    }
    case 'step':
      return { kind: 'step', text: `#${e.index} → ${e.outputKind}${spend(e.usage)}`, tone: 'quiet' };
    case 'produced':
      return { kind: 'produced', text: `artifact produced${spend(e.usage)}`, tone: 'active' };
    case 'deterministic-checked':
      return { kind: 'checked', text: verdictText(e.verdict), tone: e.verdict.pass ? 'pass' : 'fail' };
    case 'judge-verdict':
      return { kind: 'judged', text: `${e.judgeType} @${e.tier}: ${verdictText(e.verdict)}${spend(e.usage)}`, tone: e.verdict.pass ? 'pass' : 'fail' };
    case 'repair-applied':
      return { kind: 'repair', text: e.prescriptions.join(' · ') || 'repair applied', tone: 'active' };
    case 'tier-escalated':
      return { kind: 'escalated', text: `${e.from} → ${e.to}`, tone: 'active' };
    case 'emitted': {
      const b = e.report.blockers;
      return { kind: 'emitted', text: b.length ? `with ${b.length} blocker(s): ${b.join(' · ')}` : 'clean', tone: b.length ? 'fail' : 'pass' };
    }
    case 'blocked':
      return { kind: `blocked·${e.resolution}`, text: e.brief.question, tone: e.resolution === 'park' || e.resolution === 'answered' ? 'human' : 'fail' };
    case 'parked':
      return { kind: 'parked', text: `awaiting operator — ${e.brief.question}`, tone: 'human' };
    case 'resumed':
      return { kind: 'resumed', text: `answered: ${e.answer}`, tone: 'human' };
    case 'budget-exhausted':
      return { kind: 'budget', text: `${e.dimension} exhausted`, tone: 'fail' };
    case 'ceiling-reached':
      return { kind: 'ceiling', text: `${usd(e.spentUsd)} of ${usd(e.ceilingUsd)}`, tone: 'fail' };
    case 'script-ran':
      return { kind: 'script', text: `${e.command} → ${e.exitStatus ?? 'killed'} (${e.durationMs}ms)`, tone: e.exitStatus === 0 ? 'pass' : 'fail' };
    case 'capture-ran':
      return { kind: 'capture', text: `${e.captureName} (${e.kind})`, tone: e.ok ? 'pass' : 'fail' };
    case 'worktree-created':
      return { kind: 'worktree', text: `${e.branch} at ${e.path}`, tone: 'quiet' };
    case 'worktree-collected':
      return { kind: 'collected', text: `${e.branch} · ${e.commits.length} commit(s)`, tone: 'pass' };
    case 'worktree-preserved':
      return { kind: 'preserved', text: `${e.branch} — ${e.reason}`, tone: 'fail' };
    case 'branch-pushed':
      return { kind: 'pushed', text: `${e.branch} → ${e.remote}`, tone: 'pass' };
    case 'pr-opened':
      return { kind: 'pr', text: e.url, tone: 'pass' };
    case 'scope-escaped':
      return { kind: 'scope', text: `${e.source} wrote outside scope: ${e.paths.join(', ')}`, tone: 'fail' };
    case 'partial-delivered':
      return { kind: 'partial', text: `${e.blockedModules.length} module(s) held back`, tone: 'fail' };
    case 'transport-retry':
    case 'malformation-reprompt':
    case 'context-evicted':
      return { kind: e.type.split('-')[0]!, text: e.detail, tone: 'quiet' };
    case 'memory-written':
      return { kind: 'memory', text: e.pointer.content, tone: 'quiet' };
    case 'knowledge-written':
      return { kind: 'knowledge', text: `${e.artifact.category} artifact`, tone: 'quiet' };
    case 'round-started':
      return { kind: 'round', text: `round ${e.round} · spent ${usd(e.spentUsd)}`, tone: 'active' };
    default:
      return { kind: e.type, text: '', tone: 'quiet' };
  }
}

function verdictText(v: { pass: boolean; findings: { title: string; gating: boolean }[] }): string {
  const gating = v.findings.filter((f) => f.gating);
  if (v.pass) return v.findings.length ? `pass · ${v.findings.length} advisory` : 'pass';
  return `fail · ${gating.map((f) => f.title).join(' · ') || 'no findings given'}`;
}
