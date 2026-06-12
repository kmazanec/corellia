# Corellia — working instructions

## Never use cross-session memory for this repo

Do **not** write auto-memory / cross-session memory files about this repository —
not its design, defects, decisions, architecture, state, **nor any preference
about how to work on it**. Everything that needs to persist lives **in the repo**:
in this `CLAUDE.md`, in `DESIGN.md`, in `docs/PRD.md`, in `docs/adrs/`, in
`docs/prototype-build-notes.md`, in the iteration specs under `docs/iterations/`,
or in code comments and commit messages.

The repo is the single source of truth about itself. Memory files duplicate it,
drift from it, and leak repo context into a store meant for something else. When
something non-obvious is worth recording, write it **into the repo**, never into
memory.
