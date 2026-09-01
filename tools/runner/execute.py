#!/usr/bin/env python3
"""Run one operation as a job. The seam between the app and a container.

The app enqueues; this consumes. It never talks to Postgres, never holds a
storage credential, and never learns a blob key - it is handed absolute paths it
can read and a directory it owns, and hands back a manifest of what it produced.
Both crossings are driven by the trusted side, which is what lets this run
untrusted tool code without that being alarming.

    execute.py --run-id r_123 --adapter tools/faster --operation stats \\
               --input reads=/staging/r_123/in/reads.fastq \\
               --output-dir /staging/r_123/out --events /staging/r_123/events.jsonl

Everything it knows about the operation comes from the manifest. There is no
adapter-specific code here and there must never be: the moment this file needs
to know which tool it is running, the contract has failed and the fix belongs in
the schema.
"""

import argparse
import hashlib
import json
import pathlib
import shutil
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "agent"))

import events as E  # noqa: E402
from alphabet import detect as detect_alphabet  # noqa: E402
from run import extension_for, format_of, limits_for, run_operation, sniff  # noqa: E402


def verify(path: pathlib.Path, expected: str | None) -> None:
    """Confirm we mounted the bytes the caller meant, not merely the path it named.

    A path is a promise about a location; a hash is a statement about content.
    Staging and execution are separate steps, so something could have moved
    underneath in between - and a run against the wrong bytes that reports
    success is a wrong answer nobody has any reason to doubt.
    """
    if not expected:
        return
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise ValueError(
            f"{path.name}: content hash mismatch - staged {expected[:12]}, "
            f"found {digest[:12]}. Refusing to run against bytes nobody asked for."
        )


def describe_outputs(adapter_dir, op, workdir: pathlib.Path,
                     destination: pathlib.Path) -> list[dict]:
    """Copy outputs into the directory the app owns, and describe each one.

    The description is what we observed, not what the manifest claimed: bytes,
    the declared type, and whether the content actually detects as it. The app
    re-detects everything anyway, and should - our claim is not evidence. This
    exists so the two answers can be compared rather than to save it the work.
    """
    described = []
    for port_name, port in op["outputs"].items():
        source = workdir / "out" / f"{port_name}{extension_for(port)}"
        if port["type"] == "Directory":
            source = workdir / "out" / port_name
        if not source.exists():
            described.append({"port": port_name, "present": False})
            continue

        target = destination / source.name
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
            described.append({"port": port_name, "present": True, "kind": "directory",
                              "path": str(target),
                              "members": sorted(p.name for p in target.iterdir())})
            continue

        shutil.copy(source, target)
        detected, detail = sniff(target, port)
        entry = {
            "port": port_name, "present": True, "kind": "file", "path": str(target),
            "bytes": target.stat().st_size,
            "declared_type": port["type"], "declared_format": format_of(port),
            "detects_as_declared": detected, "detection_detail": detail,
            "content_hash": hashlib.sha256(target.read_bytes()).hexdigest(),
        }
        # Alphabet on outputs, so a result can satisfy a port that constrains it.
        # Without this the second step of a pipeline is unreachable: an unlabelled
        # output cannot satisfy fasttree's nucleotide-only input, however correct
        # every individual piece is.
        if port["type"] in ("Sequence", "Alignment"):
            found = detect_alphabet(target.read_text(errors="replace"))
            entry["alphabet"] = found["alphabet"]
            entry["alphabet_confidence"] = found["confidence"]
        described.append(entry)
    return described


def execute(run_id: str, adapter_dir: str, op_name: str, inputs: dict,
            hashes: dict, output_dir: pathlib.Path, sink) -> dict:
    adapter = pathlib.Path(adapter_dir)
    manifest = json.loads((adapter / "manifest.json").read_text())
    op = manifest["operations"][op_name]
    cpus, memory, clamped = limits_for(manifest["machine_class"])

    run = E.Run(kind="tool", subject=f"{manifest['id']}.{op_name}", sink=sink,
                machine_class=manifest["machine_class"],
                limits={"cpus": cpus, "memory": memory, "clamped_locally": clamped})
    run.run_id = run_id

    try:
        for port, path in inputs.items():
            verify(pathlib.Path(path), hashes.get(port))
    except ValueError as exc:
        run.emit("log.line", {"stream": "stderr", "text": str(exc)})
        return {"outcome": "precondition_failed", "problems": [str(exc)],
                **run.finish("precondition_failed")}

    started = time.time()
    report = run_operation(adapter, op_name, inputs, keep=True)

    for stream in ("stdout", "stderr"):
        for line in (report.get(stream) or "").splitlines():
            if line.strip():
                run.emit("log.line", {"stream": stream, "text": line[:2000]})

    outputs = []
    if report["outcome"] == "ok" and report.get("workdir"):
        output_dir.mkdir(parents=True, exist_ok=True)
        outputs = describe_outputs(adapter, op, pathlib.Path(report["workdir"]),
                                   output_dir)
        shutil.rmtree(report["workdir"], ignore_errors=True)

    result = {
        "run_id": run_id, "adapter": manifest["id"], "operation": op_name,
        "outcome": report["outcome"],
        "wall_seconds": report.get("wall_seconds", round(time.time() - started, 3)),
        "machine_class": manifest["machine_class"],
        "outputs": outputs,
        "problems": report.get("problems", []),
        "evidence": report.get("evidence"),
    }
    run.finish(report["outcome"], outputs={o["port"]: o for o in outputs})
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--operation", required=True)
    ap.add_argument("--input", action="append", default=[], metavar="PORT=PATH")
    ap.add_argument("--hash", action="append", default=[], metavar="PORT=SHA256",
                    help="expected content hash, from staging")
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--events", help="JSONL event file; stdout if omitted")
    args = ap.parse_args()

    sink = (E.jsonl_sink(open(args.events, "a")) if args.events
            else E.jsonl_sink(sys.stderr))
    result = execute(
        args.run_id, args.adapter, args.operation,
        dict(kv.split("=", 1) for kv in args.input),
        dict(kv.split("=", 1) for kv in args.hash),
        pathlib.Path(args.output_dir), sink,
    )
    print(json.dumps(result, indent=2))
    return 0 if result["outcome"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
