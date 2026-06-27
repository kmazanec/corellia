export interface CodeShapeOptions {
  root: string;
  scope?: readonly string[];
  fileLineThreshold?: number;
  functionLineThreshold?: number;
  maxFiles?: number;
  maxFindings?: number;
}

export interface CodeShapeFile {
  path: string;
  lines: number;
}

export interface CodeShapeFunction {
  path: string;
  name: string;
  startLine: number;
  lines: number;
}

export interface CodeShapeReport {
  filesScanned: number;
  truncated: boolean;
  scope: string[];
  largeFiles: CodeShapeFile[];
  largeFunctions: CodeShapeFunction[];
}
