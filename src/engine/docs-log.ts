/**
 * `docs/log.md` — the OKF change log, newest date first. Entries are one line
 * each under a `## YYYY-MM-DD` heading; a missing heading is created at the top
 * of the log body.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Insert `line` directly under the `## <date>` heading of docs/log.md. No-op when the log is absent. */
export function appendLogEntry(root: string, date: string, line: string): void {
  const logPath = join(root, 'docs', 'log.md');
  if (!existsSync(logPath)) return;

  let content = readFileSync(logPath, 'utf-8');
  const dateHeading = `## ${date}`;

  if (content.includes(dateHeading)) {
    const headingIdx = content.indexOf(dateHeading);
    const afterHeading = content.slice(headingIdx + dateHeading.length);
    const nextNewline = afterHeading.indexOf('\n');
    let insertIdx = headingIdx + dateHeading.length + (nextNewline === -1 ? afterHeading.length : nextNewline + 1);
    if (content.startsWith('\n', insertIdx)) insertIdx += 1;
    content = content.slice(0, insertIdx) + line + '\n' + content.slice(insertIdx);
  } else {
    const firstHeadingMatch = content.match(/^# .+\n\n/m);
    const insertIdx = firstHeadingMatch
      ? content.indexOf(firstHeadingMatch[0]) + firstHeadingMatch[0].length
      : content.indexOf('\n\n') + 2;
    const newSection = `\n${dateHeading}\n\n${line}\n`;
    content = content.slice(0, insertIdx) + newSection + content.slice(insertIdx);
  }

  writeFileSync(logPath, content, 'utf-8');
}
