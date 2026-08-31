---
status: working
updated: 2026-08-31
owner: riemer
---

# Tool adapters (P0)

The first rung of the tool-integration platform. It proves one claim: **heterogeneous
command-line tools can be wrapped in a single strict manifest and executed identically**,
with nothing tool-specific in the runner. Everything here is local Docker. No cloud, no
coding agent, no spend.

## Running it

Needs Docker and Python 3 (standard library only - no pip install, no virtualenv).

```
./tools/build-local-images.sh     once, builds portlab; seqkit pulls itself
python3 tools/runner/conform.py   grade every adapter
```

Everything else:

```
python3 tools/runner/conform.py                    grade every adapter
python3 tools/runner/conform.py tools/seqkit       grade one
python3 tools/runner/conform.py --update-goldens   record expectations
python3 tools/runner/run.py tools/seqkit stats --input sequences=path.fasta

python3 tools/runner/probe.py --adapter tools/seqkit -- seqkit --help
```

`pip install -r tools/requirements.txt` adds `jsonschema`, which turns manifest
validation on. Without it the grader still runs but warns that the schema was not
enforced. CI always installs it.

## The four files that are the actual contract

| File | What it fixes |
|---|---|
| [manifest.schema.json](manifest.schema.json) | What the platform knows about a tool. The **single source** - the HTTP endpoint, the MCP tool definition and the UI form are all projections of it, generated, never hand-maintained in parallel |
| [porttypes.json](porttypes.json) | The port-type vocabulary. Each type is a triple: meaning, formats, sniffer. Adding a type is a data change |
| [machineclasses.json](machineclasses.json) | Hardware as a closed vocabulary. An adapter names a class and never states raw numbers |
| [runner/conform.py](runner/conform.py) | The grader. The thing that makes a catalogue anyone can add to trustworthy |

[runner/probe.py](runner/probe.py) is the counterpart to the runner: it executes an
arbitrary command inside an adapter's image, in the same sandbox, so a tool can be
explored before any manifest exists. `run.py` answers "do what this manifest declares";
`probe.py` answers "what can this thing even do". Discovery needs the second one, and an
agent reverse-engineering a CLI lives in it.

## Why hand-written first

An agent cannot be asked to produce an artefact whose shape has not been pinned down.
Writing the first two adapters by hand is how the schema gets discovered; only once
`conform.py` is green does the agent have a gradeable target. The agent's job then stops
being "integrate this software" and becomes "produce an artefact that passes conform.py" -
bounded, checkable, and eventually safe to auto-merge.

## The adapters

**[portlab/](portlab/)** is not science. It is a fake tool that misbehaves on purpose, with
one subcommand per real-world failure mode: progress on stdout, exit 0 on failure, stdin-only,
directory output, embedded timestamps, memory hunger, overrunning its budget. Real tools break
in unknown ways, which is what you want for validation and exactly what you do not want in an
inner loop. portlab breaks in known ways, in milliseconds, offline. It is the graded exam for
the future adapter agent.

**[seqkit/](seqkit/)** is the first real tool, pulled straight from BioContainers and pinned by
digest. It passes with zero seqkit-specific code in the runner, which is the whole point: the
thousands of tools already containerised by Bioconda/BioContainers and already described by
nf-core `meta.yml` are reachable by conversion, not by integration.

## The error taxonomy

Outcomes are typed, and the taxonomy carries more weight than it looks:

    ok              declared outputs exist, are non-empty, and sniff as the declared type
    nonzero_exit    the tool reported failure honestly
    timeout         exceeded the declared budget
    oom             killed against the machine class memory cap
    missing_output  a declared output is absent or empty, whatever the exit code
    type_mismatch   an output exists but is not the declared type
    image_missing   the image could not be obtained - infrastructure, not the tool

`missing_output` earns its keep. A tool that exits 0 having produced nothing is not a success,
and the exit code alone cannot tell you that. `oom` is separate from `nonzero_exit` so the
platform can say "wrong machine class" rather than "broken".

## Two things learned by building it

**Sniffing had to skip comment headers.** `portlab stamp` writes a `#` provenance header before
its TSV rows, and the Table sniffer rejected it. Comment headers are near-universal in this
field (VCF, GFF, BED), so `comment_prefix` belongs on the *format*, not on each operation.
Found on the first conformance run - which is the argument for building the grader early.

**Normalisation is a fact about the tool.** Many tools embed a timestamp, a temp path or the
full command line in their output, so a golden suite rots overnight without it. The rules are
declared per operation in the manifest rather than hardcoded in the runner, because which lines
are noise is knowledge about that tool. The determinism check - run twice, compare - is what
forces the question to be answered.

## Deliberately not here

Coding agent, cloud provisioning, GPU lane, reference-dataset registry, canvas UI, MCP
projection. `runner/run.py` is a development harness, not the production runner; production is a
job queue with autoscaled workers. What has to survive from here is the **manifest contract and
the error taxonomy**, not that file.

The `datasets` field exists in the schema but is unimplemented. It is the next thing that
matters: reference data, not CPU, is the real hardware problem in this domain, and it is what
stands between this and BLAST, Bakta or Kraken2.
