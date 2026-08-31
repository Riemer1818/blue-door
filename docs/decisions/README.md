# Decisions (ADRs)

One file per decision that closed a fork in the road. Numbered, dated, never edited after the fact
except to add a `Superseded by` line.

Filename: `NNNN-short-slug.md` (e.g. `0002-pick-a-backend-stack.md`).

## Recorded

- [0001 — Fold lintel into blue door](0001-fold-lintel-into-blue-door.md) — `proposed`. Whether the June 2026 `~/Desktop/lintel` research folder becomes part of this repo, and what it costs.
- [0002 — Postgres as the source of truth](0002-postgres-as-source-of-truth.md) — `accepted`. Scaleway Managed PostgreSQL, row-level security, SQL-first schema, table-backed plugin catalogue. Names what it costs: auth is ours to build.
- [0003 — Buy the notebook, keep the library](0003-off-the-shelf-notebook.md) — `accepted`. BlockNote for the block editor and react-arborist for the tree, rather than building either.
- **Not yet written — the two open ones that matter:**
  - *Capture as a byproduct* — the design principles reject the capture-vs-retrieval fork and take a harder third position. It has not been written up as a decision, and it carries the product's central technical bet. See [../product/principles.md](../product/principles.md#what-these-principles-settle).
  - *How customization gets done* — principles 1 and 4 (power to the user) pull against 2 and 3 (take work away from the user). Split the audience, let the agent do it, or lean on defaults. See [../product/principles.md](../product/principles.md#the-tension-we-have-to-design-around).

Template:

```markdown
---
status: accepted | superseded | proposed
date: 2026-08-31
---

# NNNN. Title

## Context
What was true that forced a choice. Constraints, deadlines, what we knew and didn't.

## Options
The alternatives that were genuinely considered, each with its real cost.

## Decision
What we picked.

## Consequences
What this buys us, and what it costs us. Include the thing we gave up -- that is the line
future-us will come back to read.
```

Write one when someone will predictably ask "why is it like this?" six months from now. Don't
write one for a choice with no live alternative.
