# Corellia

A recursive software factory. Every unit of work — a PRD, a design, a diff,
a renamed symbol — is a typed **goal**. One recursive operation drives the whole
machine: receive a goal, decide (satisfy it directly, split it into children, or
block on a human decision), evaluate the result through a deterministic gate and
an LLM judge, repair on prescription, escalate on persistent failure, and emit a
typed report upward. The factory's memory, metrics, and visualizations are
pure projections of an append-only event log — there is no other state.

Full specification: [DESIGN.md](DESIGN.md) · [GOAL-TYPES.md](GOAL-TYPES.md)

---

## Quickstart

```bash
npm install

# Run all tests
npm test

# Run the end-to-end demo (writes to out/greeting/)
npm run demo

# Typecheck
npm run typecheck
```

The demo scripts a complete run of a `deliver-intent` goal ("Ship a greeting
CLI") through split, dependency sequencing, deterministic checks,
`critique-code` judge, the repair rung, and `judge-integration`. Console output
includes the running CLI, the goal tree, trace stats, and a control-loop
summary.

---

## Module map

| Module | What it is |
|---|---|
| `src/contract/` | The frozen type layer — the one handoff schema every layer is built on. No engine or brain logic here. |
| `src/engine/` | The recursive engine (`engine.ts`) and pure budget accounting (`budget.ts`). Drives receive → decide → attempt-loop → repair → integrate → emit. |
| `src/eventlog/` | The append-only event stores (`JsonlEventStore`, `InMemoryEventStore`) and pure projection functions (`renderTree`, `traceStats`, `projectMemory`). Every read-model is a fold over the log. |
| `src/library/` | The starter set of goal-type definitions (`starterTypes()`), the deterministic check library (`checks.ts`), and `createRegistry()`. |
| `src/brains/` | `ScriptedBrain` (deterministic, for tests and demos) and `LlmBrain` (any OpenAI-compatible endpoint). |

---

## Using LlmBrain with any OpenAI-compatible provider

`LlmBrain` talks to any chat-completions endpoint. Supply a `baseUrl`, an
`apiKey`, and a `modelByTier` map:

```ts
import { LlmBrain } from './src/brains/llm.js';

// OpenAI
const brain = new LlmBrain({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: process.env.OPENAI_API_KEY ?? '',
  modelByTier: {
    haiku:  'gpt-4o-mini',
    sonnet: 'gpt-4o',
    opus:   'gpt-4o',
  },
});

// OpenRouter (access Anthropic, Mistral, Llama, etc. through one key)
const brain = new LlmBrain({
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY ?? '',
  modelByTier: {
    haiku:  'anthropic/claude-haiku-4-5',
    sonnet: 'anthropic/claude-sonnet-4-5',
    opus:   'anthropic/claude-opus-4-5',
  },
});

// Local (Ollama, LM Studio, etc.)
const brain = new LlmBrain({
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',          // many local servers accept any value
  modelByTier: {
    haiku:  'llama3.2',
    sonnet: 'llama3.2',
    opus:   'llama3.1:70b',
  },
});
```

Inject a `fetchImpl` to stub the network in tests:

```ts
const brain = new LlmBrain({ ..., fetchImpl: myStubFetch });
```

---

## Deliberately deferred

These are real features — they appear in DESIGN.md — but are not part of this
walking skeleton:

- **Split-memo flywheel** — eval-gated promotion of split patterns to the
  `type` memory layer so the factory learns which decompositions work.
- **Terraced scan** — the brownfield comprehension pass that builds the
  architecture artifact from an existing codebase before any intent runs.
- **Improvement loop** — routing blocker reports back through admission as
  root goals so the factory repairs its own friction.
- **Grant enforcement** — the runtime check that a goal's tool calls stay
  within the grants declared on its type definition.
- **Risk and authority gates** — the pre-fan-out classification that routes
  high-risk or high-authority goals through a human brief before children spawn.
