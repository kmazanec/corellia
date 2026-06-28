---
type: issue
title: Semantic retrieval over the corpus (vector store)
description: The factory can only find text lexically (grep); it has no way to retrieve semantically-related code or docs that don't share keywords.
tags: [library, engine, retrieval, knowledge, embeddings, comprehend]
timestamp: 2026-06-27
status: open
kind: future-work
severity: medium
---

# Semantic retrieval over the corpus (vector store)

## Problem
Retrieval over a large codebase or text corpus is purely **lexical** today. The
broker exposes `Grep` (ripgrep) and `Read`; both match on literal substrings or
regexes. There is no way to ask "what here is *about* X" and get back the
regions that are semantically related but share no keywords — the rename of a
concept, the helper that does the same job under a different name, the doc
paragraph that describes the behavior without using the term.

This bites wherever a step has to locate the *relevant* slice of a large target
before it can act:
- **comprehend** (`map-repo`, `deep-dive-region`) deciding which regions matter;
- **build** leaves locating the right existing module to extend (lexical search
  is why `build-leaf-context-thrash` ends up re-reading the wrong files);
- any future cross-corpus grounding (e.g. retrieving prior knowledge artifacts
  or docs by meaning, not filename).

The result is missed-relevance: the factory either over-reads (thrash, wasted
context budget) or silently never finds the related region at all.

## Evidence
- No semantic-retrieval primitive exists. `grep -rilE "embedding|vector store|
  semantic search|cosine"` over `src/` and `docs/` returns only an unrelated
  `src/flywheel/shape.ts` and a stale iteration note — no implementation, no
  contract, no ADR.
- The only search affordances are `Grep`/`Read` brokered tools and the
  grep-based discipline baked into `src/library/skills/build.md` (the
  "timeless-comment grep", "do not keep searching"). All lexical.
- Knowledge artifacts (`src/contract/knowledge.ts`) are the factory's typed
  project memory but are deliberately **pointers-not-bodies** and
  **verify-on-read** (SHA-anchored, ADR-019). They record *where* to look, not a
  searchable semantic index of *what is there*.
- Adjacent but distinct issues confirm the gap is unowned:
  [ground-fact-external-knowledge](ground-fact-external-knowledge.md) is about
  verifying *external facts*, not finding internal relevant text; and
  [build-leaf-context-thrash](build-leaf-context-thrash.md) is a symptom this
  would relieve (leaves thrash partly because they can only search lexically).

## Proposed direction
*(Rough, deliberately not a committed plan — leave room for the builder.)*

A semantic-retrieval capability that fits the existing knowledge discipline
rather than fighting it:
- A retrieval primitive (a brokered `semantic_search`-style tool, or an
  extension of the retrieval API hinted at in `knowledge.ts`) returning ranked
  **pointers** (path + line anchors + score), not bodies — consumers still
  re-read the region for content, preserving pointers-not-bodies.
- An index that stays **verify-on-read**: embeddings keyed to a SHA, re-embedded
  when the anchored region changes, so a stale chunk is never silently
  retrieved (the same freshness contract as ADR-019 knowledge artifacts).
- An embedding/index substrate decision (local model vs. hosted embeddings;
  on-disk store vs. event-log-projected like knowledge artifacts) — this is the
  load-bearing design choice and likely wants its own ADR.
- Used as a *complement* to grep, not a replacement: grep stays for exact
  matches; semantic retrieval answers "what's related."

Open questions for whoever builds it: where the index lives relative to the
event log; how it's kept fresh incrementally without a full re-embed; whether it
ships as a comprehend-time aid first (narrowest blast radius) before becoming a
general tool.

## Acceptance hint
A step can issue a semantic query against a target corpus and get back ranked
region **pointers** whose relevance does not depend on shared keywords — and a
region whose anchored SHA has changed is either re-embedded or excluded, never
returned stale. Demonstrable on a case where `Grep` for the obvious term misses
a genuinely-related region that semantic retrieval surfaces.
