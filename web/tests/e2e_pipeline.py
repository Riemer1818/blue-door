#!/usr/bin/env python3
"""Two-step pipeline through the APP path: upload -> mafft -> pick -> fasttree.

THE JOIN IS THE POINT. Every individual piece passed for a while: `detect`,
`collectOutputs` and `forToolPort` were each correct while the join between them
was broken - a run's output carried no alphabet, so it could never satisfy the
next step's constraint, and nothing tested that. A pipeline through `pipe.py`
would not have caught it, because `pipe.py` never touches the `files` table.

So step two is deliberately NOT wired from step one's return value. It asks the
picker what it would offer, the way a person would, and requires the first run's
output to be in that list. Wiring it directly would test the executor and skip
the thing that was actually broken.

It also runs the protein case twice: the picker must refuse it, AND the executor
must refuse it independently, because nothing stops a caller going straight to
`runs.start`. A check the caller can skip is not a check - which is the mistake
both sessions made on this bug, in opposite halves of the system.

RE-RUNNABLE AGAINST LEFTOVERS, not merely re-runnable. Run it twice without
resetting the database: names are unique per invocation, but the blob store,
the runs table and the file tree all carry the previous run's state. That
property is what surfaced the `files.blob_key` UNIQUE bug - identical output
bytes from two runs produce one content-addressed key, and a test against a
clean database would never have noticed.

RUNNING IT

Needs Docker, the mafft and fasttree images, and a scratch database - never the
dev one, which holds real work:

    createdb bluedoor_e2e
    DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/bluedoor_e2e ./db/apply.sh
    DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/bluedoor_e2e ./db/seed-dev.sh
    cd web && DATABASE_URL=postgres://bluedoor_app:bluedoor_app@127.0.0.1:5433/bluedoor_e2e \
      DEV_USER_ID=00000000-0000-4000-8000-000000000d01 \
      BLOB_DIR=/tmp/e2e/blobs RUN_STAGING_DIR=/tmp/e2e/runs pnpm next dev --port 3314
    python3 tests/e2e_pipeline.py
    python3 tests/e2e_pipeline.py    # again, against what the first run left
"""
import base64, json, pathlib, sys, time, urllib.parse, urllib.request, uuid

BASE = "http://localhost:3314/api/trpc"
EXAMPLES = pathlib.Path("/home/thartist/Desktop/bluedoor/tools/examples")
RUN = uuid.uuid4().hex[:8]

failures = []
def check(label, ok, detail=""):
    print(f"  {'ok  ' if ok else 'FAIL'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok: failures.append(label)

def call(proc, payload, mutation=False):
    if mutation:
        req = urllib.request.Request(f"{BASE}/{proc}?batch=1",
            data=json.dumps({"0": {"json": payload}}).encode(),
            headers={"content-type": "application/json"})
    else:
        q = urllib.parse.quote(json.dumps({"0": {"json": payload}}))
        req = urllib.request.Request(f"{BASE}/{proc}?batch=1&input={q}")
    try:
        body = json.loads(urllib.request.urlopen(req).read())[0]
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())[0]
    if "error" in body:
        raise RuntimeError(f"{proc}: {body['error']['json']['message']}")
    return body["result"]["data"]["json"]

def wait(run_id, seconds=180):
    for _ in range(seconds * 2):
        run = call("runs.get", {"runId": run_id})
        if run["outcome"] is not None:
            return run
        time.sleep(0.5)
    raise RuntimeError(f"run {run_id} never finished")

print("--- step 0: upload DNA sequences ---")
seqs = call("files.upload", {"parentId": None, "name": f"{RUN}-sequences.fasta",
    "content": base64.b64encode((EXAMPLES / "sequence.fasta").read_bytes()).decode()},
    mutation=True)
print(f"  {seqs['name']}  {seqs['portType']}/{seqs['portFormat']}  {seqs['alphabet']['alphabet']}")
check("uploaded as Sequence", seqs["portType"] == "Sequence")
check("detected as dna", seqs["alphabet"]["alphabet"] == "dna")

print("\n--- step 1: mafft.align through the app ---")
started = call("runs.start", {"adapterId": "mafft", "operation": "align",
    "inputs": [{"port": "sequences", "fileId": seqs["id"]}], "outputParent": None},
    mutation=True)
run1 = wait(started["runId"])
print(f"  outcome {run1['outcome']}  {run1['wallSeconds']}s")
check("mafft ran ok", run1["outcome"] == "ok", run1["outcome"])

collected = (run1.get("result") or {}).get("collected") or []
for c in collected:
    print(f"  produced {c['name']}  {c['portType']}/{c['portFormat']}  alphabet={c['alphabet']}")
check("mafft produced an output", len(collected) == 1)
check("output is an Alignment", collected and collected[0]["portType"] == "Alignment")
# THE JOIN. Without this the output cannot satisfy fasttree's constraint.
check("output carries an alphabet", collected and collected[0]["alphabet"] == "dna",
      str(collected[0]["alphabet"]) if collected else "no output")

print("\n--- step 2: what would the picker offer for fasttree.infer? ---")
offered = call("files.forToolPort",
               {"toolId": "fasttree", "operation": "infer", "port": "alignment"})
check("the port constrains alphabet",
      (offered["port"].get("requires") or {}).get("alphabet") == "nucleotide")
names = {f["name"]: f for f in offered["files"]}
for f in offered["files"]:
    print(f"  {'OFFERED' if f['matches'] else 'BLOCKED'} {f['name']}  {f['alphabet']}")

produced = collected[0]["name"] if collected else None
check("mafft's output is a candidate", produced in names)
check("mafft's output is OFFERED", produced in names and names[produced]["matches"] is True,
      names.get(produced, {}).get("blockedBecause") or "")

print("\n--- step 3: fasttree.infer on it, chosen the way a person would ---")
run2 = wait(call("runs.start", {"adapterId": "fasttree", "operation": "infer",
    "inputs": [{"port": "alignment", "fileId": names[produced]["id"]}],
    "outputParent": None}, mutation=True)["runId"])
print(f"  outcome {run2['outcome']}  {run2['wallSeconds']}s")
check("fasttree ran ok", run2["outcome"] == "ok", run2["outcome"])
tree = ((run2.get("result") or {}).get("collected") or [])
for c in tree:
    print(f"  produced {c['name']}  {c['portType']}/{c['portFormat']}")
check("produced a Tree", tree and tree[0]["portType"] == "Tree")

print("\n--- BLU-22: the protein path is refused end to end ---")
prot = call("files.upload", {"parentId": None, "name": f"{RUN}-protein.aln.fasta",
    "content": base64.b64encode(
        pathlib.Path("/home/thartist/Desktop/bluedoor-agent/tools/corpus/alphabet/05-aligned-protein.aln.fasta").read_bytes()).decode()},
    mutation=True)
check("protein alignment detected as protein", prot["alphabet"]["alphabet"] == "protein")
offered2 = call("files.forToolPort", {"toolId": "fasttree", "operation": "infer", "port": "alignment"})
p = {f["name"]: f for f in offered2["files"]}.get(prot["name"])
check("protein alignment is a candidate", p is not None)
check("protein alignment is NOT offered", p and p["matches"] is False,
      p["blockedBecause"] if p else "")

# The picker refuses it; the executor must refuse it too, since nothing stops a
# caller going straight to runs.start. A check the caller can skip is no check.
run3 = wait(call("runs.start", {"adapterId": "fasttree", "operation": "infer",
    "inputs": [{"port": "alignment", "fileId": prot["id"]}], "outputParent": None},
    mutation=True)["runId"])
print(f"  forced run outcome: {run3['outcome']}")
check("executor refuses protein independently of the picker",
      run3["outcome"] == "precondition_failed", run3["outcome"])
problems = (run3.get("result") or {}).get("problems") or []
check("and says why", bool(problems), str(problems[:1]))

print("\n" + ("ALL PASS" if not failures else f"{len(failures)} FAILURES: {failures}"))
sys.exit(0 if not failures else 1)
