---
status: proposed
date: 2026-08-31
---

# 0001. Fold lintel into blue door

**Status is `proposed`, not `accepted` — this is Riemer's call to make, not one already made.**

## Context

`~/Desktop/lintel` is an unversioned folder created 2026-06-18, described in its own README as
"an organized inbox of raw material" for "an eventual library/tool around biotech lab workflows
and AI for scientists". It holds six working theses, two conversations with working scientists,
and five collected-but-unread source links.

`~/Desktop/bluedoor` was created 2026-08-31 with a GitHub remote (`Riemer1818/blue-door`), a
Linear workspace (`bluedoorbiotech`, team BLU) and an August market scan of the ELN category.

They are the same project at two moments. The August scan and the June theses were written
independently and agree on four of six points, including the EU-sovereignty position that both
land on as the opening — the June notes were simply not consulted when the scan was written.
The cost of that was concrete: the scan asserted there was no customer evidence for its two
main openings while two supporting interviews sat unread one directory over.

(The names are continuous, too: a lintel is the beam above a door.)

## Options

**A. Copy the material into `blue-door/docs/`, leave `lintel/` in place.** No loss, but two
copies immediately begin to drift, and the next scan can make exactly the same mistake again.

**B. Move it, and leave `lintel/` as a tombstone pointing here.** One source of truth, versioned,
backed up by the GitHub remote, and covered by the docs conventions. Costs a small amount of
rewriting, and `lintel`'s flat `sources/`+`notes/` shape does not map one-to-one.

**C. Keep them separate — `lintel` as the raw inbox, `blue-door` as the product repo.** Clean in
theory. In practice it reproduces the failure that just happened: research that nobody reads
because it lives somewhere else.

## Decision

**Proposed: B.** As of this commit the *content* has been carried across under option A —
`lintel` is untouched and unmodified — so nothing is lost either way and the move is reversible.
Adopting B means deleting `lintel/notes` and `lintel/sources` and replacing `lintel/README.md`
with a pointer.

Landing sites:

| lintel | blue door |
|---|---|
| `notes/theses.md` | [docs/product/theses.md](../product/theses.md) — carried forward *and* scored against the August scan |
| `notes/lab-workflows.md` | [docs/product/user-research/](../product/user-research/) — split one file per person |
| `sources/benchling.md`, `sources/adaptyvbio.md` | rows in [docs/market/eln-landscape/sources.md](../market/eln-landscape/sources.md), TODOs preserved as a reading list |

## Consequences

**Buys us:** one place to look; version control and an off-machine backup for the only primary
research we have; the interviews sitting next to the market scan so the next strategy document
cannot ignore them; and the reconciliation in `theses.md`, which only exists because the two
were put side by side.

**Costs us:** `lintel`'s low-friction inbox quality. It was a folder you could throw a link into
in ten seconds. `blue-door/docs` has conventions — front-matter, dates, confidence markers,
sources cited by id — and conventions are friction. If capture friction is the thesis we are
building a company on, we should notice when we impose it on ourselves. Mitigation: an unindexed
`docs/inbox/` where raw material can land unformatted, cleared periodically. Not created yet.

**Gives up:** the option of `lintel` becoming its own thing — the "library/tool" its README
imagined, separate from the product. Nothing so far suggests that was going to happen.
