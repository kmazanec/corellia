import type { InputValidator } from '../contract/goal-type.js';

export const ANY_STRUCTURED_SPEC_SCHEMA = {
  type: 'object',
  additionalProperties: true,
};

export const DELIVER_INTENT_SPEC_SCHEMA = {
  oneOf: [
    { type: 'string' },
    { type: 'object', additionalProperties: true },
  ],
};

export const structuredSpecInput: InputValidator = (spec) => {
  if (typeof spec === 'string') {
    return 'only deliver-intent accepts free-text input; lower goal specs must be structured';
  }
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return 'goal spec must be a structured object';
  }
  return null;
};

export const deliverIntentInput: InputValidator = (spec) => {
  if (typeof spec === 'string') return null;
  if (typeof spec === 'object' && spec !== null && !Array.isArray(spec)) return null;
  return 'deliver-intent spec must be free text or a structured object';
};
