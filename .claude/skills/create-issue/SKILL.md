---
name: create-issue
description: Create an OKF issue in docs/issues/ — capture an idea, bug, or future-work item as an ephemeral, structured backlog entry. Use when the user wants to file an issue, capture a bug/idea/TODO, record future work, or turn a loose thought into a tracked-but-unplanned item. Produces the issue file only; it does not plan or build it (that is the commission front door's job). Pairs with the commission skill, which can consume an existing issue.
---

# create-issue — file an OKF issue into the backlog

## What this is

Corellia's `docs/issues/` directory is an **ephemeral, unordered backlog** of work
that is *unplanned and undone*: ideas, bugs, and future work. An issue is NOT a
commitment to build — it is a captured intent. Issues are **destroyed** once
implemented: turned into an [iteration](../../docs/iterations/index.md), an
[ADR](../../docs/adrs/index.md), and actual code, then deleted.

This skill turns a loose intent into one well-formed OKF issue file on disk. **It
produces the file and stops.** It does not plan, scope a commission, or run the
factory — that is the [`commission`](../commission/SKILL.md) skill's job, which can
pick this issue up later.

See the OKF discipline in [docs/index.md](../../docs/index.md): every doc has a
`type`; `index.md` and `log.md` are reserved. Issues use `type: issue`.

## The target shape (OKF issue)

Write `docs/issues/<kebab-slug>.md`. Pick a short, descriptive kebab slug that
doubles as the filename stem (e.g. `salvage-on-repeated-failure`,
`decide-json-robustness`). Exact frontmatter:

```
---
type: issue
title: <short noun/imperative phrase>
description: <one sentence — what's wrong or wanted>
tags: [<a few kebab tags: a domain (engine|brain|broker|library|harness|docs) + a theme>]
timestamp: <today, YYYY-MM-DD>
status: open
kind: <bug | idea | future-work>
severity: <high | medium | low>
---

# <title>

## Problem
<What's wrong or missing, and why it matters. Concrete, not hand-wavy.>

## Evidence
<Where this came from: a run, a file:line, a doc, an observed failure. Cite it.
If it came from an iteration record, link the iteration index.md.>

## Proposed direction
<A rough idea, explicitly NOT a committed plan. Leave room for the builder.>

## Acceptance hint
<How we'd know it's done — the observable that closes the issue.>
```

`kind`: **bug** (something is broken), **idea** (a possible improvement, low
commitment), **future-work** (known-needed, not yet scheduled).
`severity`: judge by blast radius / how much it blocks, not by how much you like it.

## The interview — gather just enough

Ask only what you need to write a crisp issue; infer and state defaults. Cover:

1. **The problem** — what is wrong or wanted? Push for something concrete enough
   that someone else could recognize when it's fixed.
2. **Evidence** — where did this surface? A run, a file, a doc, a symptom. An issue
   with no evidence is usually an idea; mark it `kind: idea` and say so.
3. **kind + severity** — classify. If unsure between bug and idea, ask.
4. **A rough direction** (optional) — if the user has one, capture it as
   *proposed*, not prescribed. Do not invent a detailed plan; that's premature.

If the intent is too vague to write a recognizable acceptance hint, ask one
clarifying question rather than filing a mushy issue — a backlog of mush is the
failure mode this skill exists to prevent.

## After writing

Update the backlog catalog: add a row for the new issue to
[`docs/issues/index.md`](../../docs/issues/index.md) under the matching severity
section (it groups by high/medium/low). Keep the catalog in sync — it is the OKF
`index.md` for the bundle.

Then **stop and report**: the issue path, its kind/severity, and a one-line
summary. Tell the user it is filed but unplanned — to actually build it, hand it to
the [`commission`](../commission/SKILL.md) skill (which now accepts an existing
issue), or fold it into an iteration.

## What you must NOT do

- **Do not plan or build it.** No commission artifact, no engine run, no code. File
  and stop.
- **Do not invent a detailed implementation plan** in the issue. "Proposed
  direction" is a hint, deliberately loose.
- **Do not file duplicates.** Check `docs/issues/index.md` first; if a close issue
  exists, update it instead of adding a near-twin.
- **Do not let issues rot in the body of the log or an iteration.** Unplanned,
  undone work belongs here as its own file, not buried in prose.

## Relationship to the rest of the bundle

`create-issue` (capture) → `commission` (plan into a CommissionInput) → an
**iteration** builds it (possibly minting **ADRs**) → the issue is **deleted** and
the work is recorded as a line in [`docs/log.md`](../../docs/log.md). This skill
owns the first step only.
