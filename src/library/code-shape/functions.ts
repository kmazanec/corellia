import type { CodeShapeFunction } from './types.js';

interface FunctionCandidate {
  name: string;
  startLine: number;
  depth: number;
}

export function findLargeFunctions(
  path: string,
  content: string,
  threshold: number,
): CodeShapeFunction[] {
  const lines = content.split('\n');
  const found: CodeShapeFunction[] = [];
  let current: FunctionCandidate | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;

    if (current === undefined) {
      const name = functionName(line);
      if (name === undefined) continue;
      const depth = braceDelta(line);
      if (depth <= 0) continue;
      current = { name, startLine: index + 1, depth };
      if (current.depth <= 0) current = undefined;
      continue;
    }

    current.depth += braceDelta(line);
    if (current.depth <= 0) {
      const linesSpanned = index + 1 - current.startLine + 1;
      if (linesSpanned > threshold) {
        found.push({
          path,
          name: current.name,
          startLine: current.startLine,
          lines: linesSpanned,
        });
      }
      current = undefined;
    }
  }

  return found;
}

function functionName(line: string): string | undefined {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return undefined;

  const declaration = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  if (declaration && declaration[1] !== undefined) return declaration[1];

  const arrow = trimmed.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/);
  if (arrow && arrow[1] !== undefined) return arrow[1];

  const method = trimmed.match(/^(?:(?:public|private|protected|static|async|readonly)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\([^)]*\)\s*(?::[^{]+)?\{/);
  if (method && method[1] !== undefined && !isControlKeyword(method[1])) {
    return method[1];
  }

  return undefined;
}

function isControlKeyword(word: string): boolean {
  return ['if', 'for', 'while', 'switch', 'catch', 'function'].includes(word);
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of stripLineComment(line)) {
    if (char === '{') delta++;
    if (char === '}') delta--;
  }
  return delta;
}

function stripLineComment(line: string): string {
  const index = line.indexOf('//');
  return index >= 0 ? line.slice(0, index) : line;
}
