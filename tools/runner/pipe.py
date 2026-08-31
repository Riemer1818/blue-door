#!/usr/bin/env python3
"""Run a pipeline: several adapters wired together through typed ports.

A pipeline is a separate artefact from a manifest, and deliberately so. A manifest
describes one tool and is owned by whoever wrapped it; a pipeline references tools
and is owned by whoever is doing the science. Folding composition into the manifest
would make every tool know about every other one.

The load-bearing rule: **every wire is type-checked before anything executes.**
An incompatible pipeline is rejected in milliseconds having spent nothing. That is
also precisely what makes a drag-and-drop canvas possible - the editor can refuse a
connection because the same check that runs here runs there, against the same
vocabulary in porttypes.json.

    pipe.py pipelines/sequences-to-phylogeny.json --check
    pipe.py pipelines/sequences-to-phylogeny.json --input sequences=my.fasta
"""

import argparse
import json
import pathlib
import shutil
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from run import extension_for, run_operation  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"


def load_step_spec(uses):
    """'mafft.align' -> (manifest, operation). The only naming convention here."""
    adapter_id, op_name = uses.split(".", 1)
    manifest = json.loads((ROOT / adapter_id / "manifest.json").read_text())
    if op_name not in manifest["operations"]:
        raise ValueError(f"{adapter_id} has no operation '{op_name}'")
    return manifest, op_name


def port_signature(port):
    """What must match across a wire. Type alone is too loose: an Alignment in
    Clustal form does not satisfy a tool that reads aligned FASTA."""
    from run import format_of
    return f"{port['type']}/{format_of(port)}"


def validate(pipeline):
    """Resolve and type-check every wire. Returns (steps_in_order, problems)."""
    problems, produced, ordered = [], {}, []

    for name, port in pipeline.get("inputs", {}).items():
        produced[f"@input.{name}"] = ("pipeline input", port)

    for step in pipeline["steps"]:
        try:
            manifest, op_name = load_step_spec(step["uses"])
        except (FileNotFoundError, ValueError) as exc:
            problems.append(f"{step['id']}: {exc}")
            continue
        op = manifest["operations"][op_name]

        for port_name, port in op["inputs"].items():
            ref = step.get("wire", {}).get(port_name)
            if ref is None:
                if port.get("required", True):
                    problems.append(f"{step['id']}.{port_name}: nothing wired to a required input")
                continue
            if ref not in produced:
                problems.append(f"{step['id']}.{port_name}: '{ref}' is not produced by any earlier step")
                continue
            _, upstream = produced[ref]
            want, got = port_signature(port), port_signature(upstream)
            if want != got:
                problems.append(
                    f"{step['id']}.{port_name}: type mismatch - wants {want}, '{ref}' yields {got}"
                )

        for port_name, port in op["outputs"].items():
            produced[f"{step['id']}.{port_name}"] = (step["id"], port)
        ordered.append((step, manifest, op_name))

    for name, ref in pipeline.get("outputs", {}).items():
        if ref not in produced:
            problems.append(f"pipeline output '{name}': '{ref}' is not produced by any step")

    return ordered, problems


def execute(pipeline, ordered, inputs):
    """Steps are already ordered by declaration; wires may only point backwards,
    which validate() has confirmed."""
    available = {}
    for name, port in pipeline.get("inputs", {}).items():
        if name not in inputs:
            raise ValueError(f"pipeline input '{name}' not supplied")
        available[f"@input.{name}"] = inputs[name]

    record = {"pipeline": pipeline["id"], "steps": [], "outcome": "ok"}
    staging = pathlib.Path(tempfile.mkdtemp(prefix="pipe-"))

    for step, manifest, op_name in ordered:
        op = manifest["operations"][op_name]
        step_inputs = {
            port_name: available[step["wire"][port_name]]
            for port_name in op["inputs"]
            if port_name in step.get("wire", {})
        }
        report = run_operation(ROOT / manifest["id"], op_name, step_inputs, keep=True)
        record["steps"].append({
            "id": step["id"],
            "uses": step["uses"],
            "outcome": report["outcome"],
            "wall_seconds": report["wall_seconds"],
            "machine_class": report["machine_class"],
        })
        if report["outcome"] != "ok":
            record["outcome"] = f"failed at {step['id']}: {report['outcome']}"
            record["stderr"] = report.get("stderr", "")[:500]
            break

        # Copy each output somewhere stable; the step's workdir is not ours to keep.
        for port_name, port in op["outputs"].items():
            src = pathlib.Path(report["workdir"]) / "out" / f"{port_name}{extension_for(port)}"
            if src.exists():
                dst = staging / f"{step['id']}.{port_name}{extension_for(port)}"
                shutil.copy(src, dst)
                available[f"{step['id']}.{port_name}"] = str(dst)

    record["outputs"] = {
        name: available.get(ref) for name, ref in pipeline.get("outputs", {}).items()
    }
    return record


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pipeline")
    ap.add_argument("--input", action="append", default=[], metavar="NAME=PATH")
    ap.add_argument("--check", action="store_true", help="validate wiring, run nothing")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    pipeline = json.loads(pathlib.Path(args.pipeline).read_text())
    ordered, problems = validate(pipeline)

    print(f"{pipeline['id']} {DIM}{pipeline.get('description','')}{RESET}")
    for step, manifest, op_name in ordered:
        op = manifest["operations"][op_name]
        wires = ", ".join(f"{k} <- {v}" for k, v in step.get("wire", {}).items()) or "no inputs"
        sig = " -> ".join(port_signature(p) for p in op["outputs"].values())
        print(f"  {DIM}{step['id']:<10}{RESET} {step['uses']:<18} {DIM}{wires}  yields {sig}{RESET}")
    for problem in problems:
        print(f"  {RED}INVALID{RESET} {problem}")
    if problems:
        return 1
    print(f"  {GREEN}wiring valid{RESET} - {len(ordered)} steps, every connection type-checked")
    if args.check:
        return 0

    record = execute(pipeline, ordered, dict(kv.split("=", 1) for kv in args.input))
    print()
    for s in record["steps"]:
        mark = GREEN + "ok" + RESET if s["outcome"] == "ok" else RED + s["outcome"] + RESET
        print(f"  {s['id']:<10} {mark:<20} {DIM}{s['wall_seconds']}s on {s['machine_class']}{RESET}")
    if args.json:
        print(json.dumps(record, indent=2))
    elif record["outcome"] == "ok":
        for name, path in record["outputs"].items():
            print(f"\n  {name}: {path}")
            print("  " + pathlib.Path(path).read_text()[:300].replace("\n", "\n  "))
    return 0 if record["outcome"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
