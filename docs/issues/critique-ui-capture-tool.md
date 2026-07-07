---
type: issue
title: critique-ui has no built-in capture tool — run_capture is a grant with no implementation
description: The run_capture grant string has no ToolImpl; UI proof works only if the target repo ships its own screenshot script, so critique-ui and the screenshot-judge path are not self-sufficient.
tags: [engine, broker, tool, critique-ui, capture, vision]
timestamp: 2026-07-07
status: open
kind: future-work
severity: medium
---

# critique-ui has no built-in capture tool — run_capture is a grant with no implementation

## Problem
GOAL-TYPES.md gives `critique-ui` "drive browser; screenshot" and `implement`'s
proof includes before/after screenshots for UI surfaces. In code, `run_capture`
exists only as a grant string — there is no ToolImpl behind it; captures delegate
to a repo-declared start/screenshot script (src/engine/capture-runner.ts:120-144).
A product repo that ships no such script (most repos; every greenfield project)
leaves UI goals with no way to produce their own proof artifact, and the ADR-042
visual-verification path has nothing to feed the vision judge.

## Evidence
- capability-scout sweep (2026-07-07): "run_capture is a grant string with NO
  ToolImpl" (src/engine/tools.ts, src/engine/capture-runner.ts:120-144).
- GOAL-TYPES.md judge table (critique-ui grant) and implement proof row.
- Related: vision-needs-wiring.md (the judge call site doesn't set needs.vision).

## Proposed direction
A built-in fallback capture ToolImpl: start the repo's declared serve command (or
a static file server for plain HTML), drive a headless browser to a URL/route,
save a PNG into the worktree's proof area. Playwright is the obvious engine; keep
it an optional dependency resolved at runtime so the factory core stays
dependency-light and the tool is simply not offered when the engine is absent
(same degrade pattern as other env-gated capability). Repo-declared capture
scripts keep precedence — the built-in is the floor, not the override.

## Acceptance hint
Against a fixture repo with a trivial web page and no capture script of its own,
a critique-ui (or implement-with-UI-scope) goal produces a real screenshot proof
artifact via the built-in tool, and the capture-runner tests cover both the
repo-script and built-in paths.

---

> **Fixed (2026-07-07, branch `issue/capture-tool`; pending live proof).** The
> `screenshot-ui` capture now has a built-in FALLBACK path so UI proof works
> against repos that ship no screenshot script. A `ScreenshotUiCapture` gains an
> optional `screenshotMode` (`'script'` | `'built-in'`, default `'script'`): the
> default keeps every existing declaration byte-identical (the repo's `startScript`
> both serves AND screenshots — the repo-script path always wins). In `'built-in'`
> mode the factory drives a headless browser itself — it brings a server up (a
> declared `startScript` serve command + `port`, fired-without-await and killed by
> the capture timeout exactly like `drive-endpoint`; or, with no `startScript`, a
> built-in static file server rooted at a worktree-relative `staticDir` for a
> plain-HTML repo), waits for the loopback port, navigates to `route`, and writes
> the PNG to `outputPath`. The deterministic floor is unchanged: a non-empty image
> at the declared path, or the capture is `ok: false` — so the downstream
> judge/vision wiring is untouched.
>
> Playwright is an OPTIONAL runtime-resolved dependency: `resolvePlaywrightLauncher`
> dynamic-imports it with a computed specifier (so `tsc` never puts it in the
> static module graph and the factory declares NO dependency on it — not even in
> devDependencies). When it is absent the resolver returns null and the built-in
> path degrades to a clear failure ("no headless browser is installed"); the
> repo-script path and the zero-dep core are unaffected. The runtime browser is an
> injected `BrowserLauncher` seam, so the whole built-in path is unit-provable
> without ever downloading a browser in CI.
>
> **Judgment calls (owner's discretion, per the task):**
> - **Mode is an explicit declared field, not auto-detected.** A repo cannot
>   reliably be sniffed for "does the startScript screenshot or just serve?" — a
>   serve command never exits, so awaiting it to detect output would hang until the
>   timeout. `screenshotMode` makes WHO screenshots a config-time fact (the ADR-016
>   declaration discipline), defaulting to the original `script` behavior so nothing
>   existing changes. This keeps precedence deterministic: repo-script wins by being
>   the default; the built-in is opt-in and the floor.
> - **`startScript` and `port` became optional on `ScreenshotUiCapture`** to admit
>   the built-in-static shape (no serve command, free port). `validateDeclaredCaptures`
>   now branches per mode so the invariants hold: script mode still requires a
>   `startScript` + valid port; built-in-with-serve-script still requires a valid
>   port; built-in-static requires neither but any declared `startScript` must be in
>   the declared set and `staticDir` must stay in-bounds. No other code reads these
>   fields, so widening them is safe.
> - **Built-in static server binds an OS-assigned free port** (not a declared one)
>   to avoid the port-contention footgun ADR-042 §Tradeoffs names; a declared serve
>   command still uses its declared port. The static server is loopback-only, serves
>   only under `staticDir`, and 403s path traversal (proven).
> - **Assembly needs no change:** `createCaptureRunner`'s launcher-resolver argument
>   defaults to `resolvePlaywrightLauncher`, so the production wiring
>   (`assembly.ts` `checkContextFor`) picks up the built-in path automatically
>   wherever Playwright is present and is silently unavailable otherwise.
>
> Mechanism in `src/library/browser-capture.ts` (the launcher seam, the optional
> Playwright resolver, and the loopback static server) and `src/library/capture-runner.ts`
> (mode branch, `runBuiltInScreenshot`, per-mode validation). Unit-proven at the
> runner seam (`tests/library/capture-runner.test.ts`): built-in static + injected
> launcher writes a PNG; nested `staticDir` + route; declared serve-script + port;
> playwright-absent degrade; deterministic floor when the launcher writes nothing;
> script-mode precedence never resolves a browser. Static-server safety and the
> real playwright-absent resolver are proven in `tests/library/browser-capture.test.ts`.
> A live critique-ui run against a real greenfield UI (with Playwright installed) is
> the confirming proof.
