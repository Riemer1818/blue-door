#!/usr/bin/env python3
"""Which alphabet is this sequence written in?

The rule lives in porttypes.json, not here. This is one implementation of it;
the uploader in web/src/server/tools/detect.ts is another. Two implementations
are fine - crossing a language boundary for every upload would not be - but two
*rules* would drift, so the thresholds and letter sets are data both sides read,
and a shared corpus is what proves they still agree.

The asymmetry worth understanding before reading the code: nucleotide letters
are a subset of protein letters, so every DNA sequence is also a syntactically
valid protein sequence. Detection can rule protein IN with certainty - one E, F,
I, L, P or Q settles it - but can only ever rule DNA in with enough evidence.
That is why `ambiguous` is a real answer rather than a failure to try harder,
and why a short sequence of only ACGT cannot be resolved by any threshold.
"""

import json
import pathlib
import sys
from collections import Counter

RULES = json.loads(
    (pathlib.Path(__file__).resolve().parent.parent / "porttypes.json").read_text()
)["alphabets"]


def residues(text: str) -> tuple[str, str]:
    """Sequence characters only. Returns (residues, container_format).

    Both halves of this were bugs on the first real file. FASTQ quality lines
    are arbitrary printable ASCII - they contain E, F, I, L, P and Q - so
    treating every non-header line as sequence detected a nanopore run as
    protein with "certain" confidence. And a Newick tree is not a sequence at
    all, but a parser that only skips headers will happily eat the taxon names
    and answer confidently about a file it should have refused.

    So the container is identified first, and anything unrecognised is
    not_sequence rather than a guess. This is the "detection must choose"
    problem: a validator is told what it is looking at, a detector is not.
    """
    strip = set(RULES["strip"])
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return "", "empty"

    def clean(chunk):
        return "".join(c.upper() for c in chunk if c not in strip)

    if lines[0].startswith(">"):
        return clean("".join(ln for ln in lines if not ln.startswith(">"))), "fasta"

    if lines[0].startswith("@"):
        # Records are four lines: header, sequence, '+', quality. Only the second
        # is sequence, and taking the rest is what read quality scores as residues.
        seq = []
        for i in range(0, len(lines) - 1, 4):
            if lines[i].startswith("@"):
                seq.append(lines[i + 1])
        return clean("".join(seq)), "fastq"

    return "", "unrecognised"


def detect(text: str) -> dict:
    """Returns {alphabet, confidence, why} - never a bare guess."""
    seq, container = residues(text)
    if container in ("unrecognised", "empty"):
        return {"alphabet": "not_sequence", "confidence": "certain",
                "why": f"not a recognised sequence container ({container})"}
    if not seq:
        return {"alphabet": "not_sequence", "confidence": "certain",
                "why": f"{container} with no sequence residues"}

    protein_only = set(RULES["rules"]["protein_only_residues"]["letters"])
    nucleotide = set(RULES["rules"]["nucleotide_residues"]["letters"])
    limits = RULES["rules"]["thresholds"]
    counts = Counter(seq)

    # Positive proof beats any count. One of these letters cannot appear in a
    # nucleotide alphabet at all, so its presence settles the question outright.
    found = sorted(protein_only & set(counts))
    if found:
        return {"alphabet": "protein", "confidence": "certain",
                "why": f"contains {', '.join(found)}, which no nucleotide alphabet has"}

    total = len(seq)
    fraction = sum(counts[c] for c in nucleotide) / total

    if total < limits["min_residues_for_confidence"]:
        # The peer's case. A short protein of only ACGT residues is genuinely
        # indistinguishable from DNA, and no threshold rescues it.
        return {"alphabet": "ambiguous", "confidence": "none",
                "why": f"only {total} residues; too little evidence either way"}

    if fraction >= limits["nucleotide_fraction_for_dna"]:
        u, t = counts.get("U", 0), counts.get("T", 0)
        kind = "rna" if u > t else "dna"
        return {"alphabet": kind, "confidence": "high",
                "why": f"{fraction:.1%} of {total} residues are nucleotide letters"
                       + (", U outnumbers T" if kind == "rna" else "")}

    if fraction <= limits["nucleotide_fraction_for_protein"]:
        return {"alphabet": "protein", "confidence": "high",
                "why": f"only {fraction:.1%} of {total} residues are nucleotide letters"}

    return {"alphabet": "ambiguous", "confidence": "low",
            "why": f"{fraction:.1%} nucleotide letters sits between the thresholds"}


def main():
    for path in sys.argv[1:]:
        result = detect(pathlib.Path(path).read_text(errors="replace"))
        print(f"  {pathlib.Path(path).name:<26} {result['alphabet']:<12} "
              f"{result['confidence']:<8} {result['why']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
