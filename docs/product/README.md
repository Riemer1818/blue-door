---
status: draft
updated: 2026-08-31
owner: riemer
---

# Product

What we're building, for whom, and why.

## What's here

- **[theses.md](theses.md)** — six working theses from June 2026, reconciled against the August
  market scan. **Start here**: it is where the bottom-up and top-down reads meet, and where the
  one unresolved product fork is named.
- **[principles.md](principles.md)** — the four design principles, what each commits us to,
  and the tension between them that has to be designed around.
- **[user-research/](user-research/)** — field notes from people who actually run labs. n=2,
  both academic, both Dutch. Small, but it is the only primary evidence in this repo.

## Where we appear to be aiming

**DRAFT — a reading, not a decision.** Two independent routes arrive at the same place: the
[landscape scan](../market/eln-landscape/README.md) ends on an **EU-hosted, self-hostable,
agentic ELN** as the one unoccupied position, and the June theses had already flagged EU-centric
as a new belief before any competitive research was done.

What the evidence actually supports, at what strength:

- **EU data sovereignty is the wedge — strongest claim we have.** Corroborated from both
  directions, and [Niels Dam](user-research/2026-06-18-niels-dam.md) supplies the mechanism:
  researchers *refuse* to put real data into non-EU AI and use EU-hosted institutional AI
  instead. That is a hard gate, not a preference.
- **Switching cost is the wall.** Thesis #6 and [Jenny Bakker](user-research/2026-06-16-jenny-bakker.md)
  both say scientists have entrenched personal workflows and route around anything clunky. Any
  plan that begins with a migration is fighting this.
- **ASSUMED — capture friction beats feature gaps.** Well supported by Jenny, and by the scan's
  opening 1. But see the fork below: it is not the only failure mode we observed.
- **ASSUMED — the funding narrative overstates readiness.** Thesis #3 says adoption is low and
  observed AI use is shallow (plots, format conversion). The market scan cannot see this; it
  measures capital, not usage.

## The fork, and what the principles do to it

The two interviews describe **opposite failure modes** — Jenny's data never gets *in*, Niels's
data is in and cannot get *out*. Capture-first is a better notebook competing for the system of
record; retrieval-first is a layer over the record someone already keeps.

**[Principle 2](principles.md) rejects the fork as posed.** Capture-first framed as a better form
to fill in is still cataloguing, and the principle says cataloguing should approach zero. What is
left is **capture as a byproduct, retrieval as the payoff**: ingest without effort, then an agent
over what accumulated. Harder than either branch, and the only version nobody on the
[board](../market/eln-landscape/README.md) is currently building.

**What that costs:** structure now has to come from instruments, inference and the agent rather
than from the user. That is the central technical bet of the product. If ingest doesn't work, the
result is a searchable pile of mush — and it rules out regulated labs, where deliberate signed
records are the point.

**Still needs an ADR**, along with the customization tension in
[principles.md](principles.md#the-tension-we-have-to-design-around).

## Other open questions

- **OPEN — is the trust in EU hosting, or in the university being the counterparty?** If the
  latter, the wedge is a channel problem, not a hosting one, and the strategy changes completely.
- **OPEN — which lab do we start in?** Instrument-heavy (microscopy, plate readers, sensors) and
  sequence-first (Benchling's turf) are different products.
- **OPEN — biotech or materials?** Chemicals/materials R&D has the same workflows, worse software
  and a tenth of the competition.
- **OPEN — how do we beat free?** Not just eLabFTW (AGPL, self-hosted, good) but the actual
  default: OneNote plus a OneDrive folder plus a free university AI portal. Self-hostable + EU is
  not by itself a differentiator against that.

## Still to write

- `problem-statement.md` — the problem, stated so a stranger could tell whether we solved it
- `positioning.md` — who it's for, what it replaces, what it explicitly is not. Blocked on the
  fork above.
- `personas.md` — the two or three people whose day changes if this works
- `scope.md` — what's in v1 and, more importantly, what is deliberately out

## The cheapest next steps

Both are hours, not weeks, and both attack the load-bearing unknowns:

1. **Read the Benchling AI set against the Adaptyv Bio critique.** The links already exist in
   [the reading list](../market/eln-landscape/sources.md#reading-list--collected-but-not-read)
   and have sat unread since June. It directly tests the "bolt-on AI" rating the whole landscape
   hangs on.
2. **Ask Niels which academic-AI platform he uses**, who runs it and how it is procured. It is one
   message, and the answer is either our biggest competitor or our distribution channel.

Conventions live in [../README.md](../README.md).
