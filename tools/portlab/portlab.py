#!/usr/bin/env python3
"""portlab - a fake bioinformatics tool that misbehaves on purpose.

Every subcommand here reproduces something a real tool actually does. Real tools
break in unknown ways, which is what you want for validating an adapter and
exactly what you do not want in an inner loop. portlab breaks in known ways, in
milliseconds, offline.

This is the graded exam for the adapter agent. An adapter that handles all of
these handles most of Bioconda.

    revcomp   the happy path                 Sequence -> Sequence
    stats     a different output type        Sequence -> Table
    noisy     progress on stdout, result in a file
    liar      exits 0 on failure
    pipe      reads stdin only, writes stdout
    spray     emits a directory, not a file
    slow      outlives a short timeout
    stamp     embeds a timestamp and the command line in its output
    hungry    allocates until it meets a memory cap
"""

import argparse
import datetime
import os
import sys
import time

COMPLEMENT = str.maketrans("ACGTUNacgtun", "TGCAANtgcaan")


def read_fasta(handle):
    """Yield (header, sequence). Deliberately forgiving; the point is elsewhere."""
    header, chunks = None, []
    for line in handle:
        line = line.rstrip("\n")
        if line.startswith(">"):
            if header is not None:
                yield header, "".join(chunks)
            header, chunks = line[1:], []
        elif line.strip():
            chunks.append(line.strip())
    if header is not None:
        yield header, "".join(chunks)


def write_fasta(handle, records, width=60):
    for header, seq in records:
        handle.write(f">{header}\n")
        for i in range(0, len(seq), width):
            handle.write(seq[i : i + width] + "\n")


def load(path):
    records = list(read_fasta(open(path)))
    if not records:
        # An empty input is an error, not an empty success. Silent empty output
        # is how a broken pipeline stays broken for three weeks.
        sys.stderr.write("portlab: no FASTA records found in input\n")
        sys.exit(2)
    return records


def cmd_revcomp(args):
    records = load(args.infile)
    out = [(h, s.translate(COMPLEMENT)[::-1]) for h, s in records]
    with open(args.outfile, "w") as fh:
        write_fasta(fh, out)


def cmd_stats(args):
    records = load(args.infile)
    with open(args.outfile, "w") as fh:
        fh.write("name\tlength\tgc_percent\n")
        for header, seq in records:
            gc = sum(seq.upper().count(b) for b in "GC")
            pct = (100.0 * gc / len(seq)) if seq else 0.0
            fh.write(f"{header.split()[0]}\t{len(seq)}\t{pct:.2f}\n")


def cmd_noisy(args):
    """Chatters on stdout and puts the real answer in a file.

    An adapter that captures stdout as the result gets a progress log instead of
    data. Extremely common in the wild.
    """
    records = load(args.infile)
    for i, (header, _) in enumerate(records, 1):
        print(f"[{i}/{len(records)}] processing {header.split()[0]} ...")
        sys.stdout.flush()
    print("done.")
    with open(args.outfile, "w") as fh:
        write_fasta(fh, [(h, s.upper()) for h, s in records])


def cmd_liar(args):
    """Fails, reports the failure on stderr, and exits 0 anyway.

    Exit code is not a health signal. The adapter has to assert on the declared
    outputs actually existing and sniffing as the declared type.
    """
    sys.stderr.write("ERROR: portlab could not complete the analysis\n")
    open(args.outfile, "w").close()  # truthfully empty, technically present
    sys.exit(0)


def cmd_pipe(args):
    """Reads stdin, writes stdout. No file arguments exist at all."""
    records = list(read_fasta(sys.stdin))
    if not records:
        sys.stderr.write("portlab: empty stdin\n")
        sys.exit(2)
    write_fasta(sys.stdout, [(h, s.lower()) for h, s in records])


def cmd_spray(args):
    """One output per input record, in a directory whose contents are not known
    until the tool has run. The BLAST-database case in miniature."""
    records = load(args.infile)
    os.makedirs(args.outdir, exist_ok=True)
    for header, seq in records:
        name = header.split()[0].replace("/", "_")
        with open(os.path.join(args.outdir, f"{name}.fasta"), "w") as fh:
            write_fasta(fh, [(header, seq)])
    print(f"wrote {len(records)} files to {args.outdir}")


def cmd_slow(args):
    time.sleep(args.seconds)
    with open(args.outfile, "w") as fh:
        fh.write(f"slept {args.seconds}s\n")


def cmd_stamp(args):
    """Embeds a timestamp and the invocation in its own output.

    Byte comparison of two runs will differ. The fix is a declared normalize
    rule in the manifest, not sed in the test harness - which line is noise is a
    fact about the tool, so it belongs with the tool.
    """
    records = load(args.infile)
    with open(args.outfile, "w") as fh:
        fh.write(f"# portlab stamp\n")
        fh.write(f"# generated: {datetime.datetime.now().isoformat()}\n")
        fh.write(f"# command: {' '.join(sys.argv)}\n")
        for header, seq in records:
            fh.write(f"{header.split()[0]}\t{len(seq)}\n")


def cmd_hungry(args):
    """Allocates roughly N megabytes, then reports success.

    Under a memory cap the kernel kills this. The runner has to surface an OOM
    as a typed, distinguishable error rather than a generic non-zero exit.
    """
    block = bytearray(1024 * 1024)
    held = []
    for _ in range(args.megabytes):
        held.append(bytes(block))
    with open(args.outfile, "w") as fh:
        fh.write(f"held {args.megabytes} MB\n")


def main():
    parser = argparse.ArgumentParser(prog="portlab", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    def with_io(name, fn, out="outfile"):
        p = sub.add_parser(name)
        p.add_argument("--in", dest="infile", required=True)
        p.add_argument("--out", dest=out, required=True)
        p.set_defaults(func=fn)
        return p

    with_io("revcomp", cmd_revcomp)
    with_io("stats", cmd_stats)
    with_io("noisy", cmd_noisy)
    with_io("stamp", cmd_stamp)
    with_io("spray", cmd_spray, out="outdir")

    p = sub.add_parser("liar")
    p.add_argument("--in", dest="infile", required=True)
    p.add_argument("--out", dest="outfile", required=True)
    p.set_defaults(func=cmd_liar)

    p = sub.add_parser("pipe")
    p.set_defaults(func=cmd_pipe)

    p = sub.add_parser("slow")
    p.add_argument("--seconds", type=int, default=30)
    p.add_argument("--out", dest="outfile", required=True)
    p.set_defaults(func=cmd_slow)

    p = sub.add_parser("hungry")
    p.add_argument("--megabytes", type=int, default=2048)
    p.add_argument("--out", dest="outfile", required=True)
    p.set_defaults(func=cmd_hungry)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
