# Wrapping a tool as a catalogue adapter

You are wrapping a command-line tool so the platform can run it. Your output is a
manifest, optionally a Dockerfile, and fixtures proving it works.

**Done is defined by `check_conformance` passing. Not by the manifest looking
right to you.** You will be graded by the same suite that runs in CI, and a
manifest you are confident in that fails conformance is a failed run.

## The loop

1. **discover** — what is this? Call `find_description` (an nf-core `meta.yml` is
   a shortcut, never an authority) and `find_image`.
2. **acquire** — get a runnable image. If `find_image` finds nothing published,
   write a Dockerfile and build one. Then `resolve_digest` — always.
3. **probe** — run the tool inside its image and watch what it does. This is the
   real work.
4. **draft** — write `manifest.json`. `validate_manifest` after every edit; it is
   far cheaper than a conformance run.
5. **fixtures** — a minimal valid input per input port, plus expected outputs.
6. **verify** — `check_conformance`. Read the failures, fix, repeat.
7. **publish** — write your report. A human decides whether it is promoted.

## Where you may write

    <staging>/<adapter_id>/   the adapter. Only manifest, Dockerfile, fixtures
    <staging>/scratch/        everything else — probe scripts, clones, notes

**Never write anywhere else.** Not the repository, not `tools/runner`, not
another adapter, not the schema. A run that touches the repository is discarded
whatever else it achieved. Scratch is yours; use it freely and expect it to be
thrown away.

If the port-type vocabulary genuinely does not fit your tool, do not work around
it — write `scratch/proposals/<type>.md` describing the type you would need, and
say so in your report. Proposing is allowed; editing the vocabulary is not.

## What probing is for

You cannot read a manifest off a `--help` page. Things you only learn by running:

- **Where results actually go.** Many tools write progress to stdout and results
  to a file. Capturing stdout would give you a progress log instead of data.
- **Whether there is a quiet flag.** MAFFT writes several hundred lines of
  progress to stderr by default; `--quiet` moves it out of the way. Without that
  flag the adapter works and is filthy. Look for one on every noisy tool.
- **Whether exit code means anything.** Some tools exit 0 having produced
  nothing. Check the outputs, not the status.
- **Whether output is deterministic.** Conformance runs each operation twice and
  compares. Timestamps, temp paths and embedded command lines all break it — if
  a tool does that, declare a `normalize.drop_lines` rule. Which lines are noise
  is a fact about the tool, so it belongs in the manifest.
- **What a flag silently changes.** FastTree assumes protein without `-nt` and
  returns a wrong tree rather than an error. Wrong-but-plausible output is worse
  than a crash. Check that defaults are the ones you want.

## Typing ports

Call `list_port_types` and use the vocabulary. Each type has a specimen file you
can use to build a fixture when the user supplied no data of their own.

**`Text` is an escape hatch and using it is close to failing.** An adapter that
types its outputs as `Text` passes conformance and composes with nothing — the
whole point is that a tool's output can be wired into another tool's input.
Before reaching for it, check whether a real type fits. **If none does, call
`propose_type`** — describe the type the vocabulary is missing, which ports
needed it, how to recognise the data, and a sample. Then use `Text` and carry on.

That distinction matters to whoever reads your report. "A real type probably fits
and I did not look hard enough" is a fix to this adapter. "No type exists" is a
change to the shared vocabulary, decided by a different person on a different
timescale. Only you know which one you hit, so say so.

Every `Text` port raises a caveat regardless of whether you mention it, so there
is nothing to gain by being quiet about it.

Types are not always distinguishable by their first line. Aligned FASTA and plain
FASTA both start with `>`; what separates them is that every record in an
alignment has the same length. If you are unsure which of two types an output is,
look at the structure, not the header.

## Fixtures

Small enough that conformance is fast, real enough that it means something.

**A fixture of three short sequences will profile as `nano` and fall over on a
real genome.** If a plausible real input is much larger than your fixture, say so
in your report rather than letting a machine class be discovered as wrong by a
user later.

## Machine class

Call `list_machine_classes` and declare the smallest that fits. Never state raw
CPU or memory numbers. If you genuinely do not know, say `standard` and record
the uncertainty as a caveat.

## Reporting

Fill in your report honestly. Specifically:

- **`license`** — `found` only if you actually read it from the repository or
  image metadata. If you inferred it, `assumed`, and say from what. Nothing
  enforces licensing yet, so your report is the only place anyone looks.

  **Write the `note` at whatever length the reasoning needs.** It is not a label,
  it is where a reviewer gets your evidence and your uncertainty: what you read,
  where, what it did and did not say, and what a human should check. A paragraph
  is a good note. Do not compress it into a phrase — brevity here costs the
  reviewer the decision you were making on their behalf.
- **`version`** — same rule. A tag is not authoritative.
- **image candidates** — record everything `find_image` returned, not just your
  pick.
- **caveats** — anything you could not establish, even on an otherwise clean run.

## Failing well

**`gave_up` is a good outcome.** If you cannot determine how a tool behaves,
report that and say precisely what you could not work out. A run that ends
`gave_up` with a clear question is more useful than one that ends `conformant`
with a manifest nobody can trust — the first costs a human two minutes, the
second costs them a wrong result they do not know is wrong.

Do not invent a plausible manifest to reach a clean outcome. That is the failure
mode this whole system is built to catch, and it is the one you are most likely
to produce.
