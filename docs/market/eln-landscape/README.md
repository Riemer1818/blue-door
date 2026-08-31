---
status: draft
updated: 2026-08-31
owner: riemer
---

# The lab notebook stack — ELN competitive landscape

**Scan date: August 2026.** Compiled from secondary sources only — no vendor calls, no demos,
no pricing pages pulled. Treat positioning as our read and funding figures as last-disclosed.

This folder is a small system, not a page:

| file | what it is |
|---|---|
| `README.md` (this file) | the narrative read — layers, movements, where the openings are |
| [vendors.yaml](vendors.yaml) | the structured data. **Add competitors here**, one record each |
| [sources.md](sources.md) | numbered sources, cited by id from the other two |
| [_sources/](_sources/) | saved copies of those sources, because links rot |

Related: the [working theses](../../product/theses.md) reconcile this scan against six theses
written independently in June 2026, and the [user research](../../product/user-research/README.md)
holds the field notes behind them.

**To add a competitor:** append a record to `vendors.yaml` following the field contract at the
top of that file. Only touch this narrative if the newcomer changes the shape of the board.
The data file is meant to grow; the prose is meant to stay short.

## The thesis

Electronic lab notebooks are being pulled apart into three layers: the **system of record** that
incumbents own, the **data plumbing** underneath it, and a new **agentic layer** on top that wants
to read instruments, run analysis and draft the next experiment. Almost every 2025–26 startup in
the category is attacking layer three and hoping to eat layer one from above.

We classify AI depth three ways, because the distinction decides who is actually a competitor:
**bolt-on** (a chat panel beside an old schema), **through-workflow** (AI in the primitives), and
**AI-native** (built after LLMs rather than retrofitted).

## Layer 1 — the incumbents

*System of record, enterprise pricing. Where the money is and where the switching cost lives.*

The defining event of the last 18 months was consolidation: **Siemens bought Dotmatics for
$5.1B**, and **SciSure rolled up three European ELNs**. These vendors are all shipping AI now, but
it sits on top of a schema designed a decade ago.

**Benchling** is the biotech default — sequence-aware ELN plus registry, inventory and workflows,
free for academics, which is how it won bottom-up. ~$210M ARR reported as of May 2024, ~1,300
customers, ~$175K average contract, $6.1B valuation from 2021. Its AI arrived as a layer (an
Anthropic partnership, structural-biology model integrations), not a rebuild.

**Sapio Sciences** is the incumbent that moved fastest: ELaiN shipped Sept 2025 as a
"third-generation AI lab notebook", with a partner ecosystem (NVIDIA BioNeMo, Elsevier, DISGENET)
opened Jan 2026. The most aggressive incumbent repositioning on the board, and the one whose
messaging most overlaps with an AI-native pitch.

**SciSure** is the European roll-up and the incumbent nearest our own ground — eLabNext merged
with SciShield, then took Labfolder and Labregister off Labforward in Sept 2025. Strong in
academic and mid-market EU labs where data residency matters, and **early on AI**.

The regulated tier — **Revvity Signals, IDBS, STARLIMS, LabWare, Dassault BIOVIA** — is validated,
GxP-heavy and sold through procurement. Unreachable without a compliance story, and their
customers are unmovable. **LabArchives** (the NIH-academia institutional default) and **Labguru**
(10–30 person biotechs) are both usable and both near-zero on AI.

## Layer 1b — open source and self-hosted

*The free floor under the market. It caps what you can charge small labs.*

**eLabFTW** is the most polished open-source ELN: free, AGPL, self-hosted, and very strong in
European academia precisely for GDPR and data-sovereignty reasons. No AI. **SciNote** is
open-core with a generous free tier — usually the first ELN a lab tries. **RSpace** positions as
an integration hub and is further along on AI than the rest of this tier.

For us this tier matters more than its size suggests: it is simultaneously the price ceiling for
small EU labs and the closest thing to a template for what a self-hostable ELN looks like.

## Layer 2 — data plumbing

*The unglamorous prerequisite. Nothing agentic works until instrument output stops being a PDF in
a shared drive.*

**TetraScience** ($80M Series B, Google Cloud partnership) is the closest thing the category has
to a standard for instrument data. **Ganymede** ($12.75M Series A, 2022) is the developer-first
alternative — code-native pipelines rather than a configured product.

Both are more plausibly **integration targets than competitors**, and this is where the
"AI-ready data" money has actually gone so far.

## Layer 3 — the AI-native challengers

*Our actual competitive set. Built after LLMs rather than retrofitted.*

Two distinct bets are visible:

1. **A chat/agent surface over lab data** — **Scispot** (Toronto, $8M Series A June 2026, the most
   commercially visible; also running an aggressive comparison-SEO play worth studying as a GTM in
   its own right), **Genemod** (Seattle, chasing the same sub-100-person lab), **Colabra**
   (design-led, the Notion-of-the-lab angle, weak on sequence tooling, ~$1.5M disclosed).
2. **Instrument streaming plus automated analysis** — **OMĒOS**, live instrument data with
   GPU-backed agentic analysis, aimed at instrument-heavy labs (microscopy, plate readers,
   sensors) rather than sequence work. The genuinely new corner of the map, and the least crowded.

Off to the side, **Albert Invent** (~$45M) and **Uncountable** are the same play aimed at
chemicals and materials rather than biology.

**Rounds here are small.** That tells you the category is still early and still fundable.

## Layer 4 — autonomous labs

*Adjacent, but it sets the ceiling.*

Where the category goes if the agentic bet works: the notebook stops being a record and becomes
the control plane. **Lila Sciences** (Flagship Pioneering, ~$550M, unicorn) is not an ELN
competitor but is the story pulling capital into the whole category. The orchestration tier —
**Automata** ($45M Series C with Danaher Ventures money), **UniteLabs** (Python SDK, 100+ hardware
connectors, SiLA 2), **Atinary** (closed-loop DMTA with ABB, Agilent, Bruker, Mettler-Toledo) and
**Synthace** (design of experiments) — is where instrument connectivity actually gets solved.

Ginkgo and OpenAI demoed autonomous experiment design with GPT-5 ahead of SLAS 2026, claiming
~40% cost improvement over benchmark.

## Missing from this board

**Added 2026-08-31 after folding in the June field notes** — see
[user research](../../product/user-research/README.md). The scan was built from vendor and
funding sources, so it only sees things that raise money. Two competitors that do not, and that
actually hold the ground:

**The route-around stack.** The tool an academic lab really keeps its work in is **OneNote, Word,
Excel, OneDrive, Obsidian and Nextcloud**. Jenny Bakker uses eLABjournal for strains and protocols
and keeps her actual lab journal in OneNote, because the ELN is "barely usable on the phone". The
ELN did not lose on features; it lost its own core use case on smoothness. Nothing on this board
competes with OneNote, and yet that is the incumbent.

**University-provided "academic AI" portals.** Institutional platforms — chat, custom assistants,
a settings "lab" — that the university pays for and that process **within the EU**. Niels Dam uses
one on real research data precisely because he will not hand that data to external AI. This is
free at the point of use, already EU-hosted, and already trusted, which makes it either the main
obstacle to an EU-sovereignty pitch or the distribution channel for one. It appears nowhere in any
ELN market map, including this one.

**Consequence for opening 4 below:** an EU-hosted agentic ELN sold into an academic lab is not on
a shortlist against Benchling. It is up against a free institutional AI portal plus a OneDrive
folder — a much harder comparison, and a completely different pitch.

## Where the openings are

**This section is a read on the market, not reported fact.** It is the part most likely to be
wrong and the part most worth arguing with.

**1 — Capture, not chat.** Most ELN rollouts fail on friction at the point of capture and on
broken search, not on missing features. An agent that answers questions about data nobody entered
solves the wrong half. Voice, instrument ingest and passive capture are the harder, more
defensible half.

**2 — The regulated moat is real.** 21 CFR Part 11, GxP validation and audit trails are why
pharma pays incumbents. That is a genuine barrier, and it is also why every AI-native player is
starting in unregulated discovery-stage labs and academia.

**3 — Materials is underbuilt.** Biotech ELN is crowded. Chemicals, materials, food, cosmetics
and battery R&D have similar workflows, worse software and far fewer challengers. Albert and
Uncountable are close to alone there.

**4 — EU data sovereignty is a wedge.** Most AI-native entrants are US SaaS. European academic and
clinical labs need residency and GDPR answers, which is why eLabFTW and SciSure hold ground.
**An EU-hosted, self-hostable, agentic ELN has no obvious occupant.**

## What this scan does not tell us

Named honestly, because these are the questions a serious investor asks first:

- **OPEN — no primary sources.** Every URL in [sources.md](sources.md) is still a TODO. Nothing
  here has been verified against a vendor page, a filing or a call.
- **OPEN — no pricing data.** We have "enterprise pricing" and "free tier" and almost nothing in
  between. Without real numbers we cannot size a wedge or price against the free floor.
- **CORRECTED 2026-08-31 — there is customer evidence, and it was collected before this scan.**
  This section originally said openings 1 and 4 were supported by nobody we had spoken to. That
  was wrong: two conversations from June 2026 sat in the `lintel` folder and were not consulted
  when this scan was written. Both support opening 1 (capture friction) and opening 4 (EU
  sovereignty), the second with a mechanism — researchers *refuse* non-EU AI for real data. See
  [user research](../../product/user-research/README.md) and the
  [thesis reconciliation](../../product/theses.md). It is still only **n=2**, both academic, both
  Dutch, neither structured — enough to sharpen a hypothesis, not to validate one.
- **OPEN — the scan measures money, not usage.** Every figure here is a funding round, an
  acquisition or an analyst ranking. Nothing in it indicates whether scientists actually use any
  of this, and the June field notes say adoption is low and AI use is shallow — plots and file
  conversion, not analysis. A category can be well-funded and unadopted at the same time. Do not
  read urgency out of this document.
- **OPEN — OMĒOS is a gap.** They occupy the quadrant nearest an instrument-first play and we have
  no primary source on them at all. Find them first.
- **ASSUMED — layer assignments and AI-depth ratings are ours.** No vendor would necessarily
  accept how we have classified them.
