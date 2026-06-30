import type { Artifact } from '../contract/report.js';

/**
 * The byte budget for the subject-artifact section of a judge prompt. The
 * provider rejects a request whose total text input exceeds a hard ceiling
 * (observed at 8 MB); a judge's verdict does not need every byte of every file
 * to rule on whether the integrated artifact satisfies the goal, so the subject
 * section is bounded well under that ceiling and the rest of the prompt (rubric,
 * goal context, memories) fits in the remaining headroom.
 */
export const JUDGE_SUBJECT_BYTE_BUDGET = 600_000;

/** How much of an over-budget file's head to keep as an excerpt. */
const FILE_HEAD_EXCERPT_BYTES = 4_000;

function byteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Render an artifact as the SUBJECT ARTIFACT block of a judge prompt, bounded to
 * `budget` bytes. Every file PATH is always listed — the judge must see the shape
 * of what was integrated even when content is elided — and full content is
 * included greedily until the budget is reached; thereafter each file is reduced
 * to its path, byte length, and a head excerpt, so a verdict still has signal
 * without the request growing unboundedly with round or child count.
 *
 * A `files` artifact whose contents all fit returns the same full rendering the
 * judge saw before; the elision only engages once the total would exceed budget.
 */
export function summarizeJudgeSubject(
  subject: Artifact,
  budget: number = JUDGE_SUBJECT_BYTE_BUDGET,
): string {
  if (subject.kind === 'text') {
    const text = subject.text ?? '';
    if (text === '') return 'Text body:\n(empty)';
    if (byteLength(text) <= budget) return `Text body:\n${text}`;
    const head = text.slice(0, FILE_HEAD_EXCERPT_BYTES);
    return (
      `Text body (${byteLength(text)} bytes, truncated to fit the judge input budget):\n` +
      `${head}\n…[${byteLength(text) - byteLength(head)} more bytes elided]`
    );
  }

  const files = subject.files ?? [];
  if (files.length === 0) return '(empty files artifact)';

  const blocks: string[] = [];
  let spent = 0;
  for (const f of files) {
    const full = `  File: ${f.path}\n\`\`\`\n${f.content}\n\`\`\``;
    const fullBytes = byteLength(full);
    if (spent + fullBytes <= budget) {
      blocks.push(full);
      spent += fullBytes;
      continue;
    }
    // Over budget: keep the path + size + a head excerpt so the judge still has
    // signal about this file without inlining its whole body.
    const contentBytes = byteLength(f.content);
    const head = f.content.slice(0, FILE_HEAD_EXCERPT_BYTES);
    const elided = contentBytes - byteLength(head);
    const excerpt =
      `  File: ${f.path} (${contentBytes} bytes, excerpted to fit the judge input budget)\n` +
      `\`\`\`\n${head}\n…[${elided} more bytes elided]\n\`\`\``;
    blocks.push(excerpt);
    spent += byteLength(excerpt);
  }
  return blocks.join('\n');
}
