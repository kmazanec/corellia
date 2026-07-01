// Declared render script for the runtime-capture done-condition fixture (ADR-042).
//
// Reads an invoice JSON and renders a plain-text document whose "Total:" line
// must carry the invoice amount. Placement is the property under test: a real
// renderer here stands in for a PDF/HTML renderer that a script runner cannot
// reduce to a boolean. If the amount does not land on the total line, the
// renderer refuses to write output and exits non-zero — a document that misplaces
// the value is not a document we will hand to a judge.
//
// Invocation (via the declared-script runner, node-file form):
//   node render-invoice.mjs
// Reads INVOICE_PATH and writes OUTPUT_PATH from the environment, so the fixture
// test can point it at the correct or the defective input without shell text.

import { readFileSync, writeFileSync } from 'node:fs';

const invoicePath = process.env.INVOICE_PATH;
const outputPath = process.env.OUTPUT_PATH;
if (!invoicePath || !outputPath) {
  console.error('render-invoice: INVOICE_PATH and OUTPUT_PATH must be set');
  process.exit(2);
}

const invoice = JSON.parse(readFileSync(invoicePath, 'utf8'));
const { amount, lines } = invoice;

// Build the document from the declared lines; the total line must show the amount.
const rendered = lines
  .map((line) => (line.label === 'Total' ? `Total: ${line.value}` : `${line.label}: ${line.value}`))
  .join('\n');

const totalLine = lines.find((l) => l.label === 'Total');
const placedCorrectly = totalLine !== undefined && totalLine.value === amount;

if (!placedCorrectly) {
  // The amount is on the wrong line (or missing): refuse to render. The capture's
  // deterministic floor sees no output and the criterion fails — automatically.
  console.error(`render-invoice: amount ${amount} is not on the Total line; refusing to render`);
  process.exit(1);
}

writeFileSync(outputPath, rendered + '\n', 'utf8');
console.log(`render-invoice: wrote ${outputPath}`);
