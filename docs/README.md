# blue door — docs collection

Knowledge that outlives a ticket. A Linear issue says *what we're doing this week*; a doc here says
*what we know*. If a fact would have to be re-derived by the next person (or the next Claude
session), it belongs here.

**Start here:** [product/principles.md](product/principles.md) for what we believe a good product
looks like, then [product/theses.md](product/theses.md) — six theses from June 2026 scored
against the August market scan. It is the shortest path to what we believe, how strongly, and
what is still open.

## Layout

| Folder | Holds | Typical reader |
|---|---|---|
| [product/](product/) | What we're building, for whom, and why. Positioning, personas, scope, roadmap thinking, user research. | Anyone deciding what to build next |
| [market/](market/) | The world outside the repo. Competitors, customers, pricing, regulation, the underlying science and literature. | Anyone deciding whether it's worth building |
| [engineering/](engineering/) | The system we write. Architecture, data models, runbooks, environment setup, hard-won gotchas. | Anyone touching the code |
| [decisions/](decisions/) | Dated ADRs. One file per decision that closed a fork in the road. | Anyone about to re-open a settled argument |

Provenance: much of the current content was collected in June 2026 in `~/Desktop/lintel` and
carried across on 2026-08-31. Whether that folder is retired is
[ADR 0001](decisions/0001-fold-lintel-into-blue-door.md), still `proposed`.

Raw source material (papers, PDFs, exported reports, scraped data) goes in a `_sources/`
subfolder of the section that cites it — never loose in the section root. Keep the file, don't
just link: external URLs rot.

## Conventions

**One topic per file.** `docs/market/competitor-landscape.md`, not `docs/market/notes.md`.
Filenames are lowercase-kebab-case and describe the content, not the date.

**Every file opens with front-matter:**

```markdown
---
status: verified | working | draft | stale
updated: 2026-08-31
owner: riemer
---
```

- `verified` — checked against reality (a run, a source, a call). Say how, in the doc.
- `working` — actively true but still moving. The normal state for a live system doc.
- `draft` — thinking out loud, not yet load-bearing. Don't cite it in a decision.
- `stale` — known out of date, kept for history. Say what replaced it.

**Mark confidence inline.** The single most useful habit in this collection:

> **VERIFIED** — the assay runs at 37C; confirmed against the vendor protocol, 2026-08-31.
> **ASSUMED** — we think procurement takes ~6 weeks. Nobody has checked.
> **OPEN** — do we need CE marking for the research-use-only version? Unresolved.

A confidently wrong doc is worse than no doc. Marking an assumption as an assumption costs one
word and saves a month.

**Date anything perishable.** Prices, competitor features, team sizes, regulatory status, API
versions — write the date you learned it, inline. "As of 2026-08-31, …".

**Cite sources.** For market and science docs, link the paper/filing/page *and* save a copy in
`_sources/`. Quote the sentence you're relying on rather than paraphrasing it into something
stronger than it said.

**Link to Linear, don't duplicate it.** Reference tickets as `BLU-NN`. Don't copy a ticket's
description into a doc — it will drift. Docs explain the *durable* why; tickets track the work.

## When to write one

Write a doc when:
- You just spent more than an hour finding something out
- You made a call that someone will question later → `decisions/`
- You hit a gotcha that will bite the next person
- You read something external that changes what we should build → `market/`

Don't write a doc for: a thing the code already says clearly, a ticket's status, or a decision
nobody has made yet (that's an `OPEN` line in an existing doc, not a new file).
