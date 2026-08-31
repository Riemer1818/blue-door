#!/usr/bin/env bash
# Fetches small, real datasets for exercising adapters end to end.
#
# Real rather than synthetic on purpose: generated data agrees with whatever you
# assumed when you generated it, which is exactly the assumption a fixture is
# supposed to test. Both sources are EU-hosted, which keeps the demo consistent
# with where the rest of this is meant to run.
#
# These are seed data, not application data. They belong in the file store like
# any upload - do not build a side door that bypasses type detection, because
# detection is the thing that would have caught them being wrong.
set -euo pipefail
DEST="${1:-/tmp/seed}"
mkdir -p "$DEST"

# ENA (EMBL-EBI): a small Oxford Nanopore E. coli run. ~1 MB gzipped.
ACC=DRR270843
curl -sS "https://ftp.sra.ebi.ac.uk/vol1/fastq/DRR270/${ACC}/${ACC}_1.fastq.gz" \
  -o "$DEST/${ACC}.fastq.gz"
gunzip -f "$DEST/${ACC}.fastq.gz"

# UniProt: reviewed RecA proteins across proteobacteria. Real homologues, so an
# alignment of them is a real alignment and a tree of them is a real tree.
curl -sS "https://rest.uniprot.org/uniprotkb/stream?query=gene:recA+AND+reviewed:true+AND+taxonomy_id:1224&format=fasta" \
  -o "$DEST/recA-all.faa"
python3 - "$DEST" <<'PY'
import sys, pathlib
dest = pathlib.Path(sys.argv[1])
records = (dest / "recA-all.faa").read_text().split(">")[1:31]
(dest / "recA30.faa").write_text(">" + ">".join(records))
(dest / "recA-all.faa").unlink()
PY

for f in "$DEST"/*; do printf '  %-28s %s bytes\n' "$(basename "$f")" "$(stat -c%s "$f")"; done
