import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectCodeFiles, lineCount, normalizedScope } from './code-shape/collect.js';
import { findLargeFunctions } from './code-shape/functions.js';
import { renderCodeShapeHint, renderCodeShapeReport } from './code-shape/render.js';
import type {
  CodeShapeFile,
  CodeShapeFunction,
  CodeShapeOptions,
  CodeShapeReport,
} from './code-shape/types.js';

export type {
  CodeShapeFile,
  CodeShapeFunction,
  CodeShapeOptions,
  CodeShapeReport,
} from './code-shape/types.js';

export { renderCodeShapeReport } from './code-shape/render.js';

const DEFAULT_FILE_LINE_THRESHOLD = 300;
const DEFAULT_FUNCTION_LINE_THRESHOLD = 60;
const DEFAULT_MAX_FILES = 600;
const DEFAULT_MAX_FINDINGS = 8;

export function analyzeCodeShape(options: CodeShapeOptions): CodeShapeReport {
  const fileLineThreshold = options.fileLineThreshold ?? DEFAULT_FILE_LINE_THRESHOLD;
  const functionLineThreshold = options.functionLineThreshold ?? DEFAULT_FUNCTION_LINE_THRESHOLD;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const scope = normalizedScope(options.scope);
  const collected = collectCodeFiles(options.root, scope, maxFiles);
  const largeFiles: CodeShapeFile[] = [];
  const largeFunctions: CodeShapeFunction[] = [];

  for (const path of collected.files) {
    let content: string;
    try {
      content = readFileSync(join(options.root, path), 'utf8');
    } catch {
      continue;
    }

    const lines = lineCount(content);
    if (lines > fileLineThreshold) {
      largeFiles.push({ path, lines });
    }

    largeFunctions.push(
      ...findLargeFunctions(path, content, functionLineThreshold),
    );
  }

  return {
    filesScanned: collected.files.length,
    truncated: collected.truncated,
    scope,
    largeFiles: topByLines(largeFiles, maxFindings),
    largeFunctions: topByLines(largeFunctions, maxFindings),
  };
}

export function codeShapeHint(options: CodeShapeOptions): string | undefined {
  return renderCodeShapeHint(analyzeCodeShape(options));
}

function topByLines<T extends { lines: number }>(items: T[], max: number): T[] {
  return [...items].sort((a, b) => b.lines - a.lines).slice(0, max);
}
