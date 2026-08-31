---
status: draft
updated: 2026-08-31
owner: riemer
---

# Design principles

Stated by Riemer on 2026-08-31. These are **convictions, not findings** — they come from
judgement about the space rather than from the [field notes](user-research/README.md), though
three of the four turn out to have supporting evidence. Recorded as principles so that when a
design decision contradicts one, the contradiction is visible instead of silent.

---

## 1. Everything should be very customizable

**Commits us to:** configuration as a first-class surface, not a settings page. Users shape the
data model, the views and the workflow, rather than accepting ours.

**Why it's defensible:** the customization work that enterprise LIMS vendors charge six figures
of professional services for is exactly what makes those systems sticky. Making it self-serve
and free attacks the incumbent's business model, not just its feature list. It is also what makes
eLabFTW, Obsidian and Nextcloud hold ground they have no marketing budget to hold.

**Cost:** every configurable thing is a decision the user has to make, a thing that can be
misconfigured, and a migration hazard for us later. See the tension below.

## 2. Scientists want to do science, not sit at a PC cataloguing it

**The strongest principle here, and the sharpest positioning.** An ELN *is* a cataloguing tool.
Saying the cataloguing should approach zero is an attack on the category's premise, not a feature
within it.

**Commits us to:** capture as a **byproduct**, not a task. Instrument ingest, voice, mobile,
passive capture, inference of structure after the fact. The target for "how long did logging this
experiment take" is not "less"; it is "you didn't".

**Evidence — the best-supported principle in this document:**
- [Jenny Bakker](user-research/2026-06-16-jenny-bakker.md) lost her lab journal to OneNote
  because the ELN was "barely usable on the phone". The record migrated to whatever demanded
  less.
- The [landscape scan](../market/eln-landscape/README.md) independently concluded that ELN
  rollouts fail on capture friction and broken search, not on missing features.
- Thesis #6 in [theses.md](theses.md): scientists have entrenched personal workflows and won't
  budge for a tool that costs them time.

**Cost — and it is a real one:** if nobody catalogues, structure has to come from somewhere.
Instruments, inference, and the agent. That is the hard technical bet of the whole product, and
if ingest doesn't work the result is a searchable pile of mush. The scan's warning applies in
reverse here: an agent over data nobody entered is useless, so *we* have to enter it.

**It also forecloses something.** Regulated labs (21 CFR Part 11, GxP) require deliberate, signed,
audit-trailed records — cataloguing is the point there. Principle 2 is incompatible with that
world without a mode switch. Consistent with starting in discovery and academia, but it is a door
closing, and worth closing knowingly.

## 3. Fewer touchpoints is better

**Read this carefully, because the obvious reading is wrong.** It cannot mean "one monolith that
does everything" — Jenny's stack is fragmented across five tools *because each was smoother for
its job than the ELN was*. Consolidation that makes any single job worse loses to OneNote again.

**The useful reading:** minimise the number of **moments where a scientist must stop and deal
with software** — not the number of applications. Those are different metrics and they sometimes
point in opposite directions.

**Commits us to:** meeting people where they already are — the phone, the instrument, the chat
thread they're already in — instead of pulling them into a portal they have to remember to open.
One capture that lands everywhere beats five well-integrated apps.

**Tension with 1 and 4:** an ecosystem of custom tools is *more* surface area, not less. See below.

## 4. Science is diverse — anyone can add their own tools and use them immediately

**Commits us to** an architecture, not just a feature: a tool/plugin layer with hot loading,
sandboxing, and a path to sharing what you built. "Immediately" is the load-bearing word — it
rules out a review queue, a rebuild, a redeploy, or us in the loop.

**Why it's right:** the long tail of science is longer than any roadmap. We cannot ship the tools
for every assay, instrument and subfield, so the people doing the work have to be able to. This
is the same reason the route-around stack wins — Excel does *anything* — and the same reason
eLabFTW holds academia.

**It is also the moat.** Tools that users build and share accumulate; a competitor can copy our
features but not that library. This is the one principle here with compounding returns.

**Two notes from the field:**
- Niels Dam **hasn't come across MCP yet** but asked, unprompted, for **an API so something could
  read the data in**. The primitive he wants exists and has a standard shape; the audience just
  hasn't met it. That is a good position — we're not inventing a concept, we're delivering one.
- He runs **LM Studio locally on a 32GB machine**. Appetite for running your own things is real
  in this segment, which fits both a plugin layer and the EU/self-hosted wedge.

---

## The tension we have to design around

**Principles 1 and 4 give the scientist power. Principles 2 and 3 take work away from them.
Those pull in opposite directions.**

Customization is configuration work. "Add your own tools" is *building* work. Both are time at a
PC not doing science — which is precisely what principle 2 forbids. Every highly customizable
system in existence pays for its flexibility in setup burden, and the systems that lose to
"barely usable on the phone" tend to be the configurable ones.

This is not fatal, but it has to be resolved deliberately. Three ways out, and they are not
mutually exclusive:

**A. Split the audience.** One power user per lab — the bioinformatician, the postdoc who likes
tools — customizes; everyone else only consumes. This is how Obsidian, Grafana and Home Assistant
work, and how eLABjournal's strain collection got set up in Jenny's lab. Cheap, proven, and it
means principles 1 and 4 apply to a *different person* than principle 2 does. Risk: labs without
that person get nothing, and that is most small labs.

**B. The agent does the customizing.** The scientist says what they want in words; the system
builds the tool, the view, the schema. This collapses the tension rather than splitting it, and
it is the one resolution the incumbents structurally cannot copy — their customization is a
config UI built for a decade-old schema. It is also the most technically ambitious, and the
failure mode (a generated tool that quietly does the wrong thing to research data) is severe.

**C. Defaults so good most people never customize.** Necessary regardless, sufficient for nobody.
Science is too diverse — principle 4 exists because this alone doesn't work.

**Recommendation: B as the ambition, A as the floor, C as table stakes.** B is the interesting
bet and the one consistent with an agentic architecture; A is what ships while B is unreliable.

**OPEN — this belongs in an ADR** once there's enough conviction to write one. It is downstream
of, and now partly answers, the capture-versus-retrieval fork in
[theses.md](theses.md#the-contradiction-we-have-not-resolved).

## What these principles settle

The [product fork](theses.md#the-contradiction-we-have-not-resolved) was: capture-first (Jenny's
data never gets in) or retrieval-first (Niels's data can't get out).

**Principle 2 answers it: neither, as posed.** Capture-first framed as "a better form to fill in"
is still cataloguing, and principle 2 rules it out. The position these principles describe is
**capture as a byproduct, retrieval as the payoff** — ingest without effort, then an agent over
what accumulated. Both halves, with the entry cost driven to zero.

That is a harder product than either branch of the fork. It is also the only version consistent
with all four principles, and the only one that isn't already being built by somebody on the
[board](../market/eln-landscape/README.md).
