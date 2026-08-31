---
status: working
updated: 2026-08-31
owner: riemer
---

# Sources — ELN landscape

Cited by id from [vendors.yaml](vendors.yaml) and [README.md](README.md). Add a source here
before citing it; an uncited claim in the landscape is a claim we cannot defend in a pitch.

> **OPEN — URLs are missing.** This scan was compiled from a claude.ai research session on
> 2026-08-31 which cited these publications by name but whose links were not carried across into
> this repo. Before any of this goes in front of an investor or a customer, open each source,
> paste the URL in, save a copy into [_sources/](_sources/), and flip `retrieved` to a real date.
> Deliberately not guessing at URLs here — a plausible-looking wrong link is worse than a blank.
>
> The five rows that **do** have URLs were carried over from `lintel/sources/` on 2026-08-31,
> where they had been collected in June. They are collected but **not yet read** — see the
> reading list below.

| id | publication / title | url | retrieved | copy saved |
|---|---|---|---|---|
| `rdworld-labos` | R&D World — *The lab OS wars: 15 companies at SLAS 2026* | TODO | — | no |
| `37degrees` | 37degrees — *ELN landscape 2026* | TODO | — | no |
| `sacra-benchling` | Sacra — *Benchling revenue & valuation* | TODO | — | no |
| `siemens-dotmatics` | Siemens — acquisition of Dotmatics | TODO | — | no |
| `sapio-elain` | Sapio Sciences — ELaiN partner ecosystem | TODO | — | no |
| `scisure-labfolder` | SciSure — acquisition of Labfolder | TODO | — | no |
| `hitconsultant-scispot` | HIT Consultant — *Scispot $8M Series A* | TODO | — | no |
| `fierce-lila` | Fierce Biotech — *Lila Sciences $235M* | TODO | — | no |
| `businesswire-albert` | Businesswire — Albert Invent Series A | TODO | — | no |
| `crunchbase-tetrascience` | Crunchbase News — *TetraScience $80M Series B* | TODO | — | no |
| `businesswire-ganymede` | Businesswire — Ganymede Series A | TODO | — | no |
| `eln-eval-2025` | *ELN Company Evaluation Report 2025* (analyst report) | TODO | — | no |
| `benchling-ai-report-2026` | Benchling — *Biotech AI Report 2026* | https://www.benchling.com/biotech-ai-report-2026 | 2026-06-18 | no |
| `benchling-ai-guide` | Benchling — *Getting started: biotech AI guide* | https://www.benchling.com/resources/getting-started-biotech-ai-guide | 2026-06-18 | no |
| `benchling-agents-blog` | Benchling — *AI agents for scientists* (blog) | https://www.benchling.com/blog/ai-agents-for-scientists | 2026-06-18 | no |
| `benchling-ai-overview` | Benchling — AI product overview | https://www.benchling.com/ai | 2026-06-18 | no |
| `adaptyv-benchling` | Adaptyv Bio — blog post on Benchling | https://www.adaptyvbio.com/blog/benchling | 2026-06-18 | no |

## How to add a source

1. Give it a stable kebab-case id: `publisher-subject`.
2. Add the row above with the real URL and the date you actually opened it.
3. Save a copy — PDF or single-file HTML — into [_sources/](_sources/) named after the id.
   External URLs rot, vendor pages get rewritten, and funding pages get quietly updated.
4. Reference the id from `vendors.yaml` (`sources: [...]`) or inline in prose.

## Source quality notes

- **Vendor-published research is marketing.** Sapio's "45% shadow GenAI / 65% repeated
  experiments" numbers come from Sapio. Useful framing for a pitch, not independent evidence.
- **Funding figures are last-disclosed, not current.** A company with a `$8M Series A (June 2026)`
  row may well have raised since. Never present a funding number without its date.
- **Analyst category-leader rankings** (`eln-eval-2025`) reflect enterprise procurement criteria —
  validation, support, breadth — not product quality or AI depth. They tell you who wins an RFP,
  which is a different question from who has the better product.

## Reading list — collected but not read

Carried over from `lintel/sources/` with its TODOs intact. These are the only primary sources we
have links to, and none of them has been read and summarised:

- [ ] **Benchling's four AI pages** (`benchling-*`) — the market leader's own framing of AI agents
      for scientists. Read for: what they claim, which use cases they lead with, and what they
      conspicuously do not mention. Vendor marketing, so read it as positioning rather than as
      evidence. Worth doing carefully — the landscape doc rates their AI as bolt-on, and this is
      the material that would confirm or break that rating.
- [ ] **Adaptyv Bio on Benchling** (`adaptyv-benchling`) — an outside perspective on Benchling,
      and the natural counterpoint to the four pages above. Read for: what an actual user or
      competitor says breaks, versus the vendor's own account.

Reading the Benchling set against the Adaptyv post is the highest-value few hours available in
this collection right now: it is cheap, the links already exist, and it directly tests the one
rating the whole landscape hangs on.
