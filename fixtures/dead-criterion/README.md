# Dead-criterion fixture (criteria-well-formed)

A milestone's acceptance criteria are gated at author-time by
`criteriaWellFormed`: every criterion's `check` must be a sandbox-runnable
predicate, and a `{ script }` check must name one of the DECLARED script names —
never a raw shell command line. A criterion minted with command text can never
pass at run time (the runner refuses undeclared names), so it is rejected while
the author can still fix it. This is the "dead on arrival" failure seen live
(live-tail run 18: 4 of 11 criteria named raw commands and could never pass).

Both variants declare the same script set (`{ "test": "vitest run" }`).

- The **clean** criteria name the declared script `test`, so
  `criteriaWellFormed` **passes**.
- The **defective** twin names the raw command line `vitest run --coverage`
  instead of the declared name — a `{ script }` check that no runner will accept.
  `criteriaWellFormed` **fails**, naming the offending criterion and the declared
  set.

The criteria artifact is a text artifact carrying JSON (the loop's format); the
test runs the real check with the declared script names in the context, exactly
as the milestone ship gate does (ADR-032 §2.3).

- `declared-scripts.json` — the declared script names passed in the check context.
- `criteria.clean.json` — criteria that name only declared scripts.
- `criteria.defect.json` — the same criteria with one raw-command `{ script }`.
