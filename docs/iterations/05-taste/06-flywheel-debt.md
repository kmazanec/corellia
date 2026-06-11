---
id: F-56
title: Carried exploration, golden capture, caching surfacing
iteration: 05-taste
type: implement
intent: production
status: not-started
dependsOn: []
contracts: [ADR-024]
---

# Feature: The carried debt — retries see the work, judges get remembered

**After:** (1) carried exploration: a failed loop attempt's next attempt
receives a compact digest of the prior transcript's tool RESULTS (what was
read/learned, not just the verdict) via priorAttempt — pinned: attempt 2's
harness shows the digest and the model needn't re-read identical files;
(2) golden capture: judge verdicts on live (non-scripted) runs append
`golden-candidate` events; goldenCandidates projection per type (ADR-024);
(3) cached-token surfacing: usage parsing reads provider cached-token
fields when present into Usage (additive optional field — barrier) and the
cost summary reports cache hit share; (4) live-eyes default dive region
derives from the repo (largest of src/app/lib/pkg) instead of hardcoded
'src'.

Trunk feature (engine.ts for 1; projections + llm usage for 2-3).

## Build plan (approved)
- [ ] Carried-exploration digest + tests (tests/engine/step-loop).
- [ ] golden-candidate event member consumption + projection + capture
  wiring at judge-verdict emission + tests.
- [ ] Usage.cachedPromptTokens? parsing + costSummary share + tests.
- [ ] live-eyes region inference.
