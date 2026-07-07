/**
 * Whether a round of acceptance criteria feeds the judge an IMAGE, so the judge
 * call must resolve to a vision-capable model (ADR-042 × ADR-044).
 *
 * ADR-042's `{ capture }` criteria produce runtime output the judge reads. Two
 * capture kinds produce an image — `render-document` (a rendered PDF/HTML) and
 * `screenshot-ui` (a screenshot of a running UI) — and a judge blind to images
 * cannot assess them. `drive-endpoint` produces a text response body, which any
 * model can read. This predicate is the bridge ADR-044 recorded as unwired: it
 * lets the screenshot-judge call site declare `needs.vision` so the catalog
 * routes it to a vision-capable model instead of the band's default text model.
 */

import type { CaptureDef, DeclaredCaptures } from '../contract/capture.js';
import type { AcceptanceCriterion } from './acceptance-criteria.js';

/** Capture kinds whose captured output is an image the judge must see. */
const IMAGE_CAPTURE_KINDS: readonly CaptureDef['kind'][] = ['render-document', 'screenshot-ui'];

/** True when a declared capture produces an image (rather than a text body). */
export function captureProducesImage(def: CaptureDef): boolean {
  return IMAGE_CAPTURE_KINDS.includes(def.kind);
}

/**
 * True when any criterion is a `{ capture }` check naming a declared,
 * image-producing capture — i.e. the judge for this round will be handed an
 * image and therefore needs a vision-capable model. Criteria naming undeclared
 * or non-image captures (and pure script/file criteria) do not demand vision.
 */
export function criteriaNeedVision(
  criteria: AcceptanceCriterion[],
  declaredCaptures: DeclaredCaptures | undefined,
): boolean {
  if (declaredCaptures === undefined) return false;
  return criteria.some((criterion) => {
    const check = criterion.check;
    if (!('capture' in check)) return false;
    const def = declaredCaptures[check.capture];
    return def !== undefined && captureProducesImage(def);
  });
}
