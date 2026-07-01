# Runtime-capture done-condition fixture (ADR-042)

This fixture demonstrates the runtime/visual verification rung end-to-end, with
no human looking. It produces a document in which a value must appear in the
correct place, and carries a `{ capture }` acceptance criterion asserting that
placement.

- With the document **correct**, the render produces a non-empty rendered output
  and the criterion's deterministic floor (`captureSucceeded`) **passes**.
- With a **deliberately introduced defect** — the amount transposed onto the
  wrong line, the kind of error no unit test catches — the render refuses to
  produce output, so the **same** criterion **fails**.

The rung catches the defect automatically. The proof is driven by
`tests/library/runtime-capture-fixture.test.ts`, which runs the real capture
runner against both the correct and the defective document.

- `render-invoice.mjs` — the declared render script: reads an invoice JSON,
  verifies the amount sits on the declared total line, and writes the rendered
  document to the declared output path. If the amount is misplaced it writes
  nothing and exits non-zero — a render that cannot honestly place the value
  does not produce output.
- `invoice.correct.json` / `invoice.defect.json` — the two inputs.
