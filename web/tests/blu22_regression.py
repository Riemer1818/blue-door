#!/usr/bin/env python3
"""BLU-22 regression: a protein alignment must never be offered to FastTree.

The bug: `sequences-to-phylogeny` was run on real RecA PROTEIN sequences and
every check passed. FastTree was invoked with `-nt` - nucleotide mode - on a
protein alignment, and produced a real tree with real branch lengths under the
wrong evolutionary model. Nothing failed anywhere.

The UI half of that is this file. A dropdown is a stronger claim than a passing
type check: a script's silence is the absence of an objection, while a list
containing exactly one plausible option reads as a recommendation. So the file
picker must not offer a protein alignment for a nucleotide-only port.

WHY EVERY NEGATIVE HERE IS PRECEDED BY A POSITIVE

The tool-platform session's own regression harness passed for the wrong reason
on its first run: fixture paths were repo-relative, the script had changed
directory, no fixture existed, and the pipeline exited non-zero - which is
indistinguishable from a refusal. Both "must be refused" cases reported pass,
and would have gone on passing after the check they test was deleted.

A negative assertion is satisfied by absence. That is the whole trap, so this
file asserts three things before it asserts anything negative:

  1. the fixtures uploaded, and detected as the types the test assumes
  2. the port ACTUALLY declares `requires: {alphabet: nucleotide}` - without
     this, every negative below would pass simply because nothing constrains
  3. the protein file is IN the candidate set, so it is being rejected rather
     than merely missing

And the last case is the proof the harness can fail: the same protein file is
OFFERED by an unconstrained query and BLOCKED by the constrained one. If the
blocking logic were removed, that pair could not both hold.

RUNNING IT

Needs a scratch database - never the dev one, which holds real work:

    createdb bluedoor_reg
    DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/bluedoor_reg ./db/apply.sh
    DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/bluedoor_reg ./db/seed-dev.sh
    cd web && DATABASE_URL=postgres://bluedoor_app:bluedoor_app@127.0.0.1:5433/bluedoor_reg \
      DEV_USER_ID=00000000-0000-4000-8000-000000000d01 pnpm next dev --port 3313
    python3 tests/blu22_regression.py

Not yet wired into CI; that is separate work, and the peer's pipeline-level
regressions already run beside conform.py.
"""
import base64, json, pathlib, sys, urllib.parse, urllib.request, uuid

BASE = "http://localhost:3313/api/trpc"
CORPUS = pathlib.Path("/home/thartist/Desktop/bluedoor-agent/tools/corpus/alphabet")
EXAMPLES = pathlib.Path("/home/thartist/Desktop/bluedoor/tools/examples")

failures = []
def check(label, condition, detail=""):
    print(f"  {'ok  ' if condition else 'FAIL'} {label}" + (f"  [{detail}]" if detail else ""))
    if not condition:
        failures.append(label)

def call(proc, payload, mutation=False):
    if mutation:
        req = urllib.request.Request(f"{BASE}/{proc}?batch=1",
            data=json.dumps({"0": {"json": payload}}).encode(),
            headers={"content-type": "application/json"})
    else:
        q = urllib.parse.quote(json.dumps({"0": {"json": payload}}))
        req = urllib.request.Request(f"{BASE}/{proc}?batch=1&input={q}")
    body = json.loads(urllib.request.urlopen(req).read())[0]
    if "error" in body:
        raise RuntimeError(body["error"]["json"]["message"])
    return body["result"]["data"]["json"]

# Unique per invocation: the tree refuses two files with the same name in one
# folder, so a fixed name makes the test pass once and 409 forever after.
RUN = uuid.uuid4().hex[:8]

def upload(path, name=None):
    return call("files.upload", {"parentId": None, "name": f"{RUN}-{name or path.name}",
                                 "content": base64.b64encode(path.read_bytes()).decode()},
                mutation=True)

print("--- fixtures ---")
protein_aln = upload(CORPUS / "05-aligned-protein.aln.fasta")
dna_aln     = upload(EXAMPLES / "alignment.fasta", "dna-alignment.aln.fasta")
short_acgt  = upload(CORPUS / "04-ambiguous-short-acgt.fasta")
for f in (protein_aln, dna_aln, short_acgt):
    a = f.get("alphabet")
    print(f"  {f['name']:<32} {f['portType']}/{f['portFormat']:<8} {a['alphabet'] if a else 'n/a'}")

# ANTI-VACUITY 1: the fixtures loaded and are the types the test assumes.
print("\n--- the test is not vacuous ---")
check("protein alignment uploaded as Alignment", protein_aln["portType"] == "Alignment")
check("protein alignment detected as protein", protein_aln["alphabet"]["alphabet"] == "protein")
check("dna alignment uploaded as Alignment", dna_aln["portType"] == "Alignment")
check("dna alignment detected as dna", dna_aln["alphabet"]["alphabet"] == "dna",
      dna_aln["alphabet"]["alphabet"])

result = call("files.forToolPort", {"toolId": "fasttree", "operation": "infer", "port": "alignment"})
# ANTI-VACUITY 2: the constraint was actually READ off the manifest. Without
# this, every negative below would pass simply because nothing constrains.
check("fasttree.infer.alignment declares an alphabet constraint",
      (result["port"].get("requires") or {}).get("alphabet") == "nucleotide",
      str((result["port"].get("requires") or {}).get("alphabet")))

by_name = {f["name"]: f for f in result["files"]}
# ANTI-VACUITY 3: the protein file is IN the candidate set - it is being
# rejected, not merely absent.
check("protein alignment is a candidate for this port",
      protein_aln["name"] in by_name)

print("\n--- BLU-22: the wrong file is refused ---")
p = by_name.get(protein_aln["name"])
check("protein alignment is NOT offered", p is not None and p["matches"] is False)
check("and it says why", bool(p and p["blockedBecause"]), p["blockedBecause"] if p else "")

d = by_name.get(dna_aln["name"])
check("dna alignment IS offered", d is not None and d["matches"] is True)

print("\n--- ambiguity is refused in both directions ---")
for alphabet in ("nucleotide", "protein"):
    files = {f["name"]: f for f in call("files.forPort", {"type": "Sequence", "alphabet": alphabet})}
    s = files.get(short_acgt["name"])
    check(f"ambiguous is a candidate for Sequence+{alphabet}", s is not None)
    check(f"ambiguous is NOT offered for {alphabet}", s is not None and s["matches"] is False)

print("\n--- an unconstrained port is unaffected ---")
files = {f["name"]: f for f in call("files.forPort", {"type": "Alignment"})}
check("protein alignment IS offered when nothing constrains",
      files.get(protein_aln["name"], {}).get("matches") is True)

print("\n" + ("ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures}"))
sys.exit(0 if not failures else 1)
