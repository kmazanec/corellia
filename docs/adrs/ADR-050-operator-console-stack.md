---
type: adr
title: "ADR-050: the operator console is a separate workspace — Hono + Zod/OpenAPI + Drizzle server, React + Vite web, the Plate aesthetic"
description: The operator console needs a real application stack (typed API, SSE, schema-managed tables, a component framework) but ADR-001 keeps the factory at zero runtime dependencies. Resolve it with a dependency boundary — the console lives in its own npm workspaces under console/ that may import the factory, never the reverse — and pick the stack inside that boundary; Hono with @hono/zod-openapi for a typed, documented REST+SSE API, Drizzle over the existing pg driver for schema and queries, React + Vite + TanStack Router/Query for the SPA, Tailwind v4 with tokens taken from the factory plate and unstyled accessible primitives instead of a stock component kit.
tags: [adr, ui, operator-console, stack, dependencies, hono, drizzle, react, design]
timestamp: 2026-09-23T12:00:00-05:00
---

# ADR-050: the operator console is a separate workspace with its own stack

**Status:** Accepted · **Date:** 2026-09-23 · **Stretch:** no · **Contract:** no
**Relates to:** ADR-001 (zero runtime deps by default — this ADR is the explicit
exception it requires), ADR-003 (event log is the source of truth), ADR-026
(hosted front door, bearer token), ADR-051 (control plane / worker split),
issue [operator-console-ui](../issues/operator-console-ui.md)

## Context

The operator console ([operator-console-ui](../issues/operator-console-ui.md))
is meant to become the factory's full human entrypoint. It is the start of a
large application, not one page. It needs a typed request/response API that
other clients (CLIs, external tools) can also call, live streams, tables whose
schema is managed rather than hand-written SQL, auth later, and a component
framework for trees, streams, and drill-down views.

ADR-001 keeps the factory itself at zero runtime dependencies (`pg` is the one
approved exception), and says any new runtime dependency needs an ADR. The two
requirements pull against each other only if the console and the factory are one
package.

## Decision

1. **A dependency boundary, not an exception to ADR-001.** The console lives in
   npm workspaces under `console/` (`console/server`, `console/web`). A console
   package may import the factory's contract and projections. The factory
   (`src/`) never imports a console package. The factory's dependency list stays
   `pg` alone; console dependencies are scoped to their workspaces.

2. **Server: Hono + `@hono/zod-openapi` + Drizzle.**
   - **Hono** (on `@hono/node-server`) for HTTP. It is small, built on web-standard
     Request/Response, has first-class SSE (`streamSSE`), and takes auth as
     middleware later (bearer token now, per ADR-026).
   - **`@hono/zod-openapi`** so every route declares its input and output as Zod
     schemas. That one declaration gives request validation, an OpenAPI document
     for non-TS clients, and the `hc` typed client for the web app, with no
     codegen step.
   - **Drizzle** (`drizzle-orm` over the existing `pg` driver, `drizzle-kit` for
     migrations) for tables the console owns and for reading the event log. It
     is a TS-first query builder: queries stay close to SQL without raw strings.
     The factory's self-created tables (`corellia_events`, `corellia_patterns`)
     are mirrored as Drizzle table definitions for reads; ownership of their DDL
     moves only by a later decision.
   - **Not GraphQL.** One first-party client plus a few CLIs does not repay a
     schema/resolver layer, and GraphQL subscriptions would pull in WebSockets.
     REST + OpenAPI + SSE gives the same end-to-end typing with less machinery.
   - **Not Prisma.** Heavier runtime and generation step, and more distance from
     SQL than this codebase wants.

3. **Web: React + Vite SPA, TanStack Router + TanStack Query.** A client-rendered
   SPA, not Next.js: the control plane is already the server, and an operator
   console behind a token needs no SSR. SSE messages update the Query cache.

4. **Design: the factory's Plate aesthetic, not a stock kit.** The visual
   language already exists in `factory.html` (Plate I): dark ground, brass,
   oxblood, teal, moss; Cinzel for crests and headings (sparingly), Spectral for
   prose, JetBrains Mono for data; 2px radii, hairline rules with end ticks,
   grain overlay. Tailwind v4 is used as a utility layer with its `@theme`
   replaced by those tokens; the default palette is not used. Components are
   written in-repo on top of **unstyled accessible primitives**
   (`react-aria-components`) for focus, keyboard, and ARIA behaviour. No shadcn
   or other pre-styled kit. The lighter deck palette (`media/strange-loop-deck.html`)
   is the basis for an optional light theme.

5. **Serving.** The control plane can serve the built SPA for single-box
   deploys; the SPA also works as a separately hosted static bundle pointed at
   the API. Neither is required by the other (ADR-051).

## Tradeoffs

- A second toolchain (Vite, React) in a repo that was pure `tsc`/`tsx`. Mitigated
  by keeping it inside `console/web` with its own `tsconfig`.
- Cross-workspace imports of factory source go through one boundary module in
  `console/server` so the coupling is visible and easy to move to a published
  package later.
- Drizzle mirroring a table the factory creates can drift. The mirror is
  read-only and covered by a test that round-trips a factory-written event.

## Consequences

- `package.json` gains `workspaces: ["console/*"]`; `npm test` keeps running the
  factory suite, and the console suites run in the same vitest invocation.
- The constitution lint and OKF doc lint keep applying to `src/` and `docs/`;
  the console is additive and must not weaken either.
