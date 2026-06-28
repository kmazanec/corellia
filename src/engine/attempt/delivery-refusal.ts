import type { Artifact } from '../../contract/report.js';
import type { Verdict } from '../../contract/verdict.js';

/**
 * The deterministic refusal floor.
 *
 * A leaf can produce an artifact whose content is not the deliverable but a
 * first-person statement that it *cannot* deliver — "I have no file access",
 * "producing this would be fabrication", "the blocker is environmental". Left to
 * the LLM judge, a well-argued refusal can read as a coherent, correct artifact
 * and pass, turning total non-delivery into a false success.
 *
 * This floor runs before any judge: a refusal is non-delivery by construction, so
 * it yields a deterministic FAIL that the attempt loop treats like any failing
 * check — it retries and, exhausted, surfaces as a blocker rather than a PASS.
 *
 * The signal is narrow on purpose. It fires only on a `text` artifact (a real
 * file set is delivery) and only when the text both refuses AND grounds the
 * refusal in an inability to proceed — first-person modal refusal near an
 * inability/blocker phrase — so an artifact that merely *discusses* refusal or
 * delivers prose that happens to contain "cannot" does not trip it.
 */

const REFUSAL_PHRASES = [
  'i cannot deliver',
  'i can not deliver',
  'i am unable to deliver',
  "i can't deliver",
  'cannot produce this',
  'cannot be delivered',
  'unable to produce',
  'would be fabrication',
  'i have no file access',
  'i cannot read',
  "i can't read",
  'no access to the',
  'the blocker is environmental',
  'i cannot complete',
  "i can't complete",
  'i am unable to complete',
];

/**
 * True when the artifact is a text body that self-describes as a refusal to
 * deliver. Returns false for file artifacts and for any text that does not carry
 * an explicit inability-to-deliver phrase.
 */
export function isDeliveryRefusal(artifact: Artifact): boolean {
  if (artifact.kind !== 'text') return false;
  const text = artifact.text;
  if (text === undefined || text.trim() === '') return false;

  const haystack = text.toLowerCase();
  return REFUSAL_PHRASES.some((phrase) => haystack.includes(phrase));
}

/**
 * The deterministic FAIL verdict for a refused delivery — shaped like a failing
 * deterministic check (gating, spec dimension, high severity) so the attempt loop
 * routes it through the same failure path.
 */
export function deliveryRefusalVerdict(): Verdict {
  return {
    pass: false,
    findings: [
      {
        title:
          'delivery-refusal: the artifact states it cannot deliver the goal rather than delivering it',
        dimension: 'spec',
        severity: 'high',
        gating: true,
        prescription:
          'Produce the actual deliverable. If the goal is genuinely blocked (missing access, missing capability), raise a blocker — do not emit an artifact that explains the refusal.',
      },
    ],
    failureSignature: 'delivery-refusal',
  };
}
