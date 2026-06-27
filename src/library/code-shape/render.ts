import type { CodeShapeReport } from './types.js';

export function renderCodeShapeHint(report: CodeShapeReport): string | undefined {
  if (report.largeFiles.length === 0 && report.largeFunctions.length === 0) {
    return undefined;
  }

  const scopeLabel = report.scope.length > 0 ? report.scope.join(', ') : '.';
  const parts = [
    `Code-shape pressure (scope: ${scopeLabel}; scanned ${scanCount(report)} code file(s)).`,
  ];

  if (report.largeFiles.length > 0) {
    parts.push(
      `Largest files: ${report.largeFiles
        .map((file) => `${file.path} (${file.lines} lines)`)
        .join('; ')}.`,
    );
  }

  if (report.largeFunctions.length > 0) {
    parts.push(
      `Largest functions/methods: ${report.largeFunctions
        .map((fn) => `${fn.name} at ${fn.path}:${fn.startLine} (${fn.lines} lines)`)
        .join('; ')}.`,
    );
  }

  parts.push(
    'Use this as evidence, not a command: keep orchestration as a table of contents; extract domain-verb modules; replace repeated callback wiring with adapters; use explicit context objects when they clarify dependency flow; move focused tests with the ownership boundary.',
  );

  return parts.join(' ');
}

export function renderCodeShapeReport(report: CodeShapeReport): string {
  const lines = [
    `code-shape: scanned ${scanCount(report)} code file(s) in ${report.scope.length > 0 ? report.scope.join(', ') : '.'}`,
  ];

  if (report.largeFiles.length === 0 && report.largeFunctions.length === 0) {
    lines.push('no oversized files or functions found');
    return lines.join('\n');
  }

  for (const file of report.largeFiles) {
    lines.push(`large-file ${file.path} ${file.lines} lines`);
  }

  for (const fn of report.largeFunctions) {
    lines.push(`large-function ${fn.path}:${fn.startLine} ${fn.name} ${fn.lines} lines`);
  }

  return lines.join('\n');
}

function scanCount(report: CodeShapeReport): string {
  return `${report.filesScanned}${report.truncated ? '+' : ''}`;
}
