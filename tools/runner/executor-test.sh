#!/usr/bin/env bash
# End-to-end checks for the executor, along the path the app uses.
#
# Every case asserts it actually RAN before asserting what it found. The first
# version of this was a shell loop with 2>/dev/null, and a missing directory
# meant execute.py died, produced no JSON, and the loop reported nothing while I
# committed a message claiming the check had passed. A test that can fail to run
# and still look fine is worse than no test, and this is the third time today one
# of those has surfaced.
set -uo pipefail
cd "$(dirname "$0")/../.."
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
fail=0

run() {  # run <name> <expected-outcome> <run-id> <adapter> <operation> <args...>
  local name=$1 expect=$2 rid=$3 adapter=$4 op=$5; shift 5
  mkdir -p "$STAGE/$rid/out"
  local out
  out=$(python3 tools/runner/execute.py --run-id "$rid" --adapter "$adapter" \
        --operation "$op" --output-dir "$STAGE/$rid/out" \
        --events "$STAGE/$rid/events.jsonl" "$@" 2>"$STAGE/$rid/err")
  if ! printf '%s' "$out" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "  FAIL  $name - executor produced no result: $(head -1 "$STAGE/$rid/err")"
    fail=1; return
  fi
  local got
  got=$(printf '%s' "$out" | python3 -c "import sys,json; print(json.load(sys.stdin)['outcome'])")
  if [ "$got" != "$expect" ]; then
    echo "  FAIL  $name - expected $expect, got $got"
    fail=1; return
  fi
  echo "  pass  $name ($got)"
  printf '%s' "$out" > "$STAGE/$rid/result.json"
}

field() { python3 -c "
import json,sys
r=json.load(open('$STAGE/$1/result.json'))
print(r['outputs'][0].get('$2'))"; }

run "stats on real ENA reads" ok ena tools/faster stats \
    --input "reads=$(pwd)/tools/corpus/alphabet/06-dna-fastq-protein-looking-quality.fastq"

run "hash mismatch refused" precondition_failed tamper tools/faster stats \
    --input "reads=$(pwd)/tools/examples/sequence.fastq" \
    --hash "reads=$(printf deadbeef | sha256sum | cut -d' ' -f1)"

# The join that was broken: an output must carry an alphabet, or the second step
# of every pipeline is unreachable however correct each piece is.
run "step 1 aligns protein" ok p1 tools/mafft align \
    --input "sequences=$(pwd)/tools/corpus/alphabet/01-protein-recA.fasta"
if [ -f "$STAGE/p1/result.json" ]; then
  alpha=$(field p1 alphabet)
  if [ "$alpha" != "protein" ]; then
    echo "  FAIL  step 1 output alphabet - expected protein, got $alpha"; fail=1
  else
    echo "  pass  step 1 output is labelled $alpha"
  fi
  run "step 2 refuses protein" precondition_failed p2 tools/fasttree infer \
      --input "alignment=$STAGE/p1/out/alignment.aln.fasta"
fi

run "step 1 aligns DNA" ok d1 tools/mafft align \
    --input "sequences=$(pwd)/tools/examples/sequence.fasta"
[ -f "$STAGE/d1/result.json" ] && run "step 2 accepts DNA" ok d2 tools/fasttree infer \
    --input "alignment=$STAGE/d1/out/alignment.aln.fasta"

# Re-run against the state the previous run left, not a clean slate. A test that
# only ever sees an empty directory has only ever tested an empty directory.
first=""
for pass in 1 2 3; do
  run "re-run pass $pass over leftovers" ok rerun tools/faster stats \
      --input "reads=$(pwd)/tools/examples/sequence.fastq"
  [ -f "$STAGE/rerun/result.json" ] || continue
  hash=$(field rerun content_hash)
  [ -z "$first" ] && first=$hash
  if [ "$hash" != "$first" ]; then
    echo "  FAIL  pass $pass differs: $hash vs $first"; fail=1
  fi
done
[ -n "$first" ] && echo "  pass  three passes over leftovers agree (${first:0:12})"

[ $fail -eq 0 ] && echo "  executor end-to-end holds"
exit $fail
