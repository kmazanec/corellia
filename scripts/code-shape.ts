import { analyzeCodeShape, renderCodeShapeReport } from '../src/library/code-shape.js';

const root = process.argv[2] ?? '.';
const scope = process.argv.slice(3);

const report = analyzeCodeShape({ root, scope });
console.log(renderCodeShapeReport(report));
