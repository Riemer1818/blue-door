#!/usr/bin/env python3
"""The conformance suite - the grader every adapter must pass.

This is the piece that matters. A catalogue anyone can add to is only worth
trusting if something mechanical can say "this adapter is correct", and that
same something is what an adapter agent gets graded against later. The agent's
job stops being "integrate this software" and becomes "produce an artefact that
passes conform.py" - bounded, checkable, and eventually safe to auto-merge.

Per adapter it checks:

  schema   the manifest validates against manifest.schema.json. This is the check
           an adapter agent is ultimately graded on, so it must be enforced rather
           than merely documented - an unenforced schema lets a generator emit
           fields nobody reads and still be told it passed
  static   things JSON Schema cannot express: machine class known, declared port
           types exist in the vocabulary, command placeholders resolve to declared
           ports, image pinned by digest
  outcome  each operation reaches its expected outcome, including the ones
           expected to fail
  golden   output matches the recorded expectation after declared normalisation
  determinism
           two consecutive runs produce identical bytes - the check that catches
           embedded timestamps, temp paths and thread-ordering, which are endemic
           and which quietly rot a golden suite over weeks

Fixture layout:

    fixtures/<case>/inputs/<port>.<ext>          staged as the operation's inputs
    fixtures/<case>/expected/<op>/<port>.<ext>   goldens, one directory per operation
    fixtures/<case>/case.json                    {"expect": {"<op>": "timeout"}}

Usage:
    python3 tools/runner/conform.py                 grade everything
    python3 tools/runner/conform.py tools/seqkit    grade one adapter
    python3 tools/runner/conform.py --update-goldens
"""

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from run import PORT_TYPES, MACHINE_CLASSES, extension_for, run_operation  # noqa: E402

try:
    import jsonschema
except ImportError:  # optional: a fresh clone runs without pip install
    jsonschema = None

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCHEMA = json.loads((ROOT / "manifest.schema.json").read_text())
GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def normalize(text, rules):
    """Apply the operation's declared normalisation before any comparison."""
    if not rules:
        return text
    lines = text.splitlines()
    for pattern in rules.get("drop_lines", []):
        lines = [ln for ln in lines if not re.search(pattern, ln)]
    if rules.get("sort_lines"):
        lines = sorted(lines)
    return "\n".join(lines) + ("\n" if lines else "")


def static_checks(manifest, adapter_dir):
    """Everything checkable without running anything."""
    problems, warnings = [], []

    if jsonschema is None:
        warnings.append("jsonschema not installed - structural checks only, schema NOT enforced")
    else:
        errors = sorted(
            jsonschema.Draft202012Validator(SCHEMA).iter_errors(manifest),
            key=lambda e: list(e.absolute_path),
        )
        for err in errors[:5]:
            where = ".".join(str(x) for x in err.absolute_path) or "(root)"
            problems.append(f"schema: {where}: {err.message}")
        if len(errors) > 5:
            problems.append(f"schema: and {len(errors) - 5} further violations")
    if problems:
        return problems, warnings

    for field in ("id", "version", "image", "machine_class", "operations"):
        if field not in manifest:
            problems.append(f"missing required field: {field}")
    if problems:
        return problems, warnings

    if not manifest.get("license"):
        # Licensing gates what may be hosted and for whom. Not enforced yet, but an
        # adapter that never recorded it is a question nobody will remember to ask.
        warnings.append("no license recorded - needs review before this is served to anyone")

    if manifest["id"] != adapter_dir.name:
        problems.append(f"id '{manifest['id']}' does not match directory '{adapter_dir.name}'")
    if manifest["machine_class"] not in MACHINE_CLASSES["classes"]:
        problems.append(f"unknown machine_class: {manifest['machine_class']}")
    if "@sha256:" not in manifest["image"]:
        # A tag can be republished under the same name. Every golden below is
        # only as trustworthy as the image identity it was recorded against.
        warnings.append("image is not pinned by digest; goldens cannot be trusted across rebuilds")

    for op_name, op in manifest["operations"].items():
        declared = set()
        for side in ("inputs", "outputs"):
            for port_name, port in op.get(side, {}).items():
                declared.add(f"{side}.{port_name}")
                if port["type"] not in PORT_TYPES:
                    problems.append(f"{op_name}: unknown port type '{port['type']}' on {side}.{port_name}")
                elif port.get("format") and port["format"] not in PORT_TYPES[port["type"]]["formats"]:
                    problems.append(f"{op_name}: unknown format '{port['format']}' for type {port['type']}")
        for token in op["command"]:
            m = re.fullmatch(r"\{\{(.+)\}\}", token)
            if m and m.group(1) not in declared:
                problems.append(f"{op_name}: command references undeclared port {token}")
        for key in ("stdin", "stdout"):
            ref = op.get(key)
            side = "inputs" if key == "stdin" else "outputs"
            if ref and ref not in op.get(side, {}):
                problems.append(f"{op_name}: {key} names '{ref}', which is not a declared {side[:-1]} port")
        if "measured" in manifest:
            cap_gb = int(MACHINE_CLASSES["classes"][manifest["machine_class"]]["memory"].rstrip("g"))
            if manifest["measured"].get("peak_rss_mb", 0) > cap_gb * 1024:
                problems.append("measured peak_rss_mb exceeds the declared machine class")
    return problems, warnings


def grade_operation(adapter_dir, manifest, op_name, case_dir, expect, update):
    op = manifest["operations"][op_name]
    inputs, missing = {}, []
    for port_name, port in op.get("inputs", {}).items():
        candidate = case_dir / "inputs" / f"{port_name}{extension_for(port)}"
        if candidate.exists():
            inputs[port_name] = str(candidate)
        elif port.get("required", True):
            missing.append(candidate.name)
    if missing:
        return "skip", f"no fixture input ({', '.join(missing)})"

    first = run_operation(adapter_dir, op_name, inputs, keep=True)
    if first["outcome"] != expect:
        detail = (first.get("stderr") or first.get("stdout") or "").strip().splitlines()
        return "fail", f"expected {expect}, got {first['outcome']}" + (f" - {detail[0][:70]}" if detail else "")
    if expect != "ok":
        return "pass", f"{expect} as expected"

    second = run_operation(adapter_dir, op_name, inputs, keep=True)
    if second["outcome"] != "ok":
        return "fail", f"second run degraded to {second['outcome']} - not reproducible"

    golden_dir = case_dir / "expected" / op_name
    notes = []
    for port_name, port in op["outputs"].items():
        if port["type"] == "Directory":
            a = sorted(p.name for p in (pathlib.Path(first["workdir"]) / "out" / port_name).iterdir())
            b = sorted(p.name for p in (pathlib.Path(second["workdir"]) / "out" / port_name).iterdir())
            if a != b:
                return "fail", f"{port_name}: directory listing differs between runs"
            notes.append(f"{port_name}: {len(a)} files")
            continue

        name = f"{port_name}{extension_for(port)}"
        a = normalize((pathlib.Path(first["workdir"]) / "out" / name).read_text(errors="replace"), op.get("normalize"))
        b = normalize((pathlib.Path(second["workdir"]) / "out" / name).read_text(errors="replace"), op.get("normalize"))
        if a != b:
            return "fail", f"{port_name}: two runs differ after normalisation - nondeterministic"

        golden = golden_dir / name
        if update:
            golden.parent.mkdir(parents=True, exist_ok=True)
            golden.write_text(a)
            notes.append(f"{port_name}: golden written")
        elif not golden.exists():
            notes.append(f"{YELLOW}{port_name}: no golden{RESET}")
        elif normalize(golden.read_text(), op.get("normalize")) != a:
            return "fail", f"{port_name}: output does not match golden"
        else:
            notes.append(f"{port_name}: matches golden")
    return "pass", "; ".join(notes)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("adapters", nargs="*", help="adapter directories; default is all of tools/")
    ap.add_argument("--update-goldens", action="store_true")
    args = ap.parse_args()

    dirs = [pathlib.Path(a) for a in args.adapters] or sorted(
        p.parent for p in ROOT.glob("*/manifest.json")
    )
    failures = total = 0

    for adapter_dir in dirs:
        manifest = json.loads((adapter_dir / "manifest.json").read_text())
        print(f"\n{manifest['id']} {DIM}{manifest.get('version','')} :: {manifest['machine_class']}{RESET}")

        problems, warnings = static_checks(manifest, adapter_dir)
        for w in warnings:
            print(f"  {YELLOW}warn{RESET}  {w}")
        for p in problems:
            print(f"  {RED}FAIL{RESET}  static: {p}")
        failures += len(problems)
        total += len(problems)
        if problems:
            continue

        cases = sorted(p for p in (adapter_dir / "fixtures").glob("*") if p.is_dir())
        if not cases:
            print(f"  {YELLOW}warn{RESET}  no fixtures; nothing can be verified")
            continue

        for case_dir in cases:
            case = json.loads((case_dir / "case.json").read_text()) if (case_dir / "case.json").exists() else {}
            expectations = case.get("expect", {})
            for op_name in manifest["operations"]:
                total += 1
                status, detail = grade_operation(
                    adapter_dir, manifest, op_name,
                    case_dir, expectations.get(op_name, "ok"), args.update_goldens,
                )
                mark = {"pass": f"{GREEN}pass{RESET}", "fail": f"{RED}FAIL{RESET}", "skip": f"{DIM}skip{RESET}"}[status]
                print(f"  {mark}  {case_dir.name}/{op_name:<12} {DIM}{detail}{RESET}")
                if status == "fail":
                    failures += 1

    print(f"\n{'-' * 60}\n{total - failures}/{total} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
