---
status: working
updated: 2026-08-31
owner: riemer
---

# Working theses

Six theses were written down in `lintel/notes/theses.md` on **2026-06-18**, from conversations
and general reading, before any competitive research had been done. The
[ELN landscape scan](../market/eln-landscape/README.md) was compiled independently on
**2026-08-31**, from secondary sources, without reference to them.

**This page is the reconciliation.** Where the two agree, we have something close to independent
corroboration — a bottom-up read from talking to scientists and a top-down read of the vendor
landscape arriving at the same place. Where they disagree, that is the more interesting finding.

## Scorecard

| # | June thesis | August scan | verdict |
|---|---|---|---|
| 1 | Everybody is making AI agents for biotech — crowded | Layer 3 is 6+ AI-native entrants, all post-2020 | **Confirmed** |
| 2 | Everybody wants to own the physical running of experiments | Layer 4: Lila ~$550M, Automata $45M, Atinary, UniteLabs | **Confirmed, and bigger than assumed** |
| 3 | Adoption in startups and companies is low | *Silent* — the scan measured funding, not usage | **Unchallenged, and the scan's blind spot** |
| 4 | EU-centric matters (*new belief*) | Opening 4: "an EU-hosted, self-hostable agentic ELN has no obvious occupant" | **Independently corroborated** |
| 5 | Data needs to be stored — a hard requirement | Layer 2 (TetraScience, Ganymede) is where the money went | **Confirmed, and it is a layer, not a feature** |
| 6 | PhDs have their own systems and don't budge | Opening 1: rollouts fail on capture friction, not features | **Confirmed from both directions** |

## The two that matter

### #4 — EU-centric, arrived at twice

In June this was flagged as a *new belief*, with a question mark after the reasoning
("regulatory, data residency, market?"). In August the landscape scan independently ended on it
as the one unoccupied position on the board.

Two derivations, from different evidence, is the strongest signal in this collection. And
[Niels Dam](user-research/2026-06-18-niels-dam.md) supplies the mechanism the scan could not:
researchers refuse to put real data into non-EU AI, and use EU-hosted institutional AI instead.
That is not a compliance preference, it is a hard gate on adoption.

**Still open:** whether the trust attaches to *EU hosting* or to *the university being the
counterparty*. If it is the latter, the wedge is a channel problem, not a hosting one, and the
strategy changes completely.

### #3 — the thesis the market scan cannot see

**Adoption is low.** The scan is built from funding announcements, acquisitions and analyst
rankings, so it measures *supply and capital*, not *usage*. Every number in it is a number about
money. Nothing in it would tell you whether a single scientist actually uses any of this.

The interviews say the opposite of the funding narrative: AI use in the lab is **shallow** —
plots, format conversion, wrangling — and the ELN's own core use case is being lost to OneNote.
Meanwhile the category raised hundreds of millions and Ginkgo/OpenAI demoed autonomous
experiment design.

**Hold both.** A category can be simultaneously well-funded and unadopted; that is the normal
shape of a hype cycle, and it is a *good* condition to enter in — but only if you build for the
adoption gap rather than for the funding narrative. Thesis #3 is the main reason to distrust
anything the landscape doc implies about urgency.

## The contradiction we have not resolved

The two interviews describe **opposite failure modes**:

- **[Jenny](user-research/2026-06-16-jenny-bakker.md)** — data never gets *in*. The ELN is clunky
  and unusable on a phone, so the journal migrates to OneNote and the data to Excel. The problem
  is **capture**.
- **[Niels](user-research/2026-06-18-niels-dam.md)** — data is in, and cannot get *out*. The ELN
  holds the crown jewels of a PhD but is not LLM-searchable, so he hand-rolls Obsidian notes
  beside it and asks, unprompted, for an API. The problem is **retrieval**.

These are not the same product. Capture-first is a better notebook — mobile, voice, instrument
ingest — competing head-on with the incumbent for the system of record. Retrieval-first is a
layer *over* the record someone already keeps, which is a far easier sell (no migration, no
switching cost, and thesis #6 says switching cost is the wall) but a weaker position long-term,
since you depend on a vendor who can close the door.

**PARTLY RESOLVED 2026-08-31 by [principles.md](principles.md).** Principle 2 — scientists want
to do science, not catalogue it — rejects the fork as posed: capture-first framed as a better
form is still cataloguing. The position taken is *capture as a byproduct, retrieval as the
payoff*, i.e. both halves with the entry cost driven to zero. That is a conviction, not a
finding; n=2 is still not enough to validate it, and it moves the risk from "which half do we
build" to "can ingest actually produce structure without the user". The next conversations
should be designed to test that.

## What both reads missed

Neither the June theses nor the August scan contains the **actual competitor at the bench**. It
is not another ELN. It is **OneNote, Word, Excel, OneDrive, Obsidian, Nextcloud** — and, for the
AI half, **university-provided "academic AI" portals** which are free at the point of use,
already EU-hosted, and already trusted.

An EU-hosted agentic ELN sold to an academic lab is not competing with Benchling on that lab's
shortlist. It is competing with a free institutional AI portal plus a OneDrive folder. See
[the landscape's own gaps](../market/eln-landscape/README.md#what-this-scan-does-not-tell-us).
