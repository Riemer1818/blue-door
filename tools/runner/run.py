#!/usr/bin/env python3
"""Execute one operation from an adapter manifest, locally, in Docker.

This is a development harness, not the production runner. Production will be a
job queue with autoscaled workers; what has to survive from here is the manifest
contract and the error taxonomy, not this file.

Two things it deliberately does not do: it never consults the tool's identity,
and it never shells out through a shell. Every tool-specific fact lives in the
manifest. The day this file needs an `if adapter_id == ...` the contract has
failed and the fix belongs in the schema.

Outcomes are typed, and the taxonomy matters more than it looks:

    ok              declared outputs exist, are non-empty, and sniff correctly
    nonzero_exit    the tool reported failure honestly
    timeout         exceeded the operation's declared budget
    oom             killed against the machine class memory cap
    missing_output  a declared output is absent or empty - regardless of exit code
    type_mismatch   an output exists but is not the declared type
    image_missing   the container image could not be obtained - infrastructure,
                    not the tool, and never the tool's fault to report

`missing_output` is the one that earns its keep. A tool that exits 0 having
produced nothing is not a success, and exit code alone cannot tell you that.
"""

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT_TYPES = json.loads((ROOT / "porttypes.json").read_text())["types"]
MACHINE_CLASSES = json.loads((ROOT / "machineclasses.json").read_text())


def format_of(port):
    """Resolve a port's format, defaulting to the type's first declared format."""
    spec = PORT_TYPES[port["type"]]
    return port.get("format") or next(iter(spec["formats"]))


def extension_for(port):
    fmt = PORT_TYPES[port["type"]]["formats"][format_of(port)]
    exts = fmt["extensions"]
    return exts[0] if exts else ""


def sniff(path, port):
    """Does this file look like the declared type? Returns (ok, detail).

    Content, not filename. A tool that writes an HTML error page to results.fasta
    is caught here and nowhere else.
    """
    spec = PORT_TYPES[port["type"]]
    pattern = spec["formats"][format_of(port)].get("sniff")
    if pattern is None:
        return True, "no sniffer for this format"
    comment = spec["formats"][format_of(port)].get("comment_prefix")
    try:
        with open(path, "r", errors="replace") as fh:
            for line in fh:
                if not line.strip():
                    continue
                if comment and line.startswith(comment):
                    continue  # provenance headers are not type evidence
                return (bool(re.search(pattern, line)), line[:60].rstrip())
    except OSError as exc:
        return False, str(exc)
    return False, "file is empty"


def limits_for(machine_class):
    """Resource caps, clamped to what this workstation can honour.

    A laptop cannot serve `deep`. Clamping and saying so is more useful than
    refusing to schedule, as long as the clamp is reported - an unreported clamp
    turns a real OOM into a mysterious one.
    """
    spec = MACHINE_CLASSES["classes"][machine_class]
    ceiling = MACHINE_CLASSES["local_ceiling"]
    cpus = min(spec["cpus"], ceiling["cpus"])
    mem_gb = min(int(spec["memory"].rstrip("g")), int(ceiling["memory"].rstrip("g")))
    clamped = cpus != spec["cpus"] or f"{mem_gb}g" != spec["memory"]
    return cpus, f"{mem_gb}g", clamped


def run_operation(adapter_dir, op_name, inputs, workdir=None, keep=False):
    """inputs maps port name -> host path. Returns a report dict."""
    adapter_dir = pathlib.Path(adapter_dir)
    manifest = json.loads((adapter_dir / "manifest.json").read_text())
    op = manifest["operations"][op_name]

    work = pathlib.Path(workdir or tempfile.mkdtemp(prefix="doorway-"))
    (work / "in").mkdir(parents=True, exist_ok=True)
    (work / "out").mkdir(parents=True, exist_ok=True)

    # Stage inputs under names derived from the port, not from the caller's
    # filename. The tool must not be able to observe where its data came from.
    container_paths = {}
    for name, port in op["inputs"].items():
        if name not in inputs:
            if port.get("required", True):
                raise ValueError(f"missing required input port: {name}")
            continue
        staged = f"{name}{extension_for(port)}"
        shutil.copy(inputs[name], work / "in" / staged)
        container_paths[f"inputs.{name}"] = f"/work/in/{staged}"

    output_paths = {}
    for name, port in op["outputs"].items():
        if op.get("stdout") == name:
            continue  # captured from the stream, has no path
        if port["type"] == "Directory":
            container_paths[f"outputs.{name}"] = f"/work/out/{name}"
            output_paths[name] = work / "out" / name
        else:
            staged = f"{name}{extension_for(port)}"
            container_paths[f"outputs.{name}"] = f"/work/out/{staged}"
            output_paths[name] = work / "out" / staged

    def substitute(token):
        m = re.fullmatch(r"\{\{([a-z]+\.[A-Za-z0-9_]+)\}\}", token)
        if not m:
            return token
        if m.group(1) not in container_paths:
            raise ValueError(f"command references unknown port: {token}")
        return container_paths[m.group(1)]

    argv = [substitute(t) for t in op["command"]]
    cpus, memory, clamped = limits_for(manifest["machine_class"])

    docker = [
        "docker", "run", "--rm", "-i",
        "--network", "none",            # no tool has a reason to reach the internet mid-run
        "--cpus", str(cpus),
        "--memory", memory,
        "--memory-swap", memory,        # without this the cap is advisory and OOM never fires
        "--user", f"{os.getuid()}:{os.getgid()}",  # outputs stay owned by the caller
        "-v", f"{work}:/work",
        "-w", "/work",
        manifest["image"],
    ] + argv

    stdin_data = None
    if op.get("stdin"):
        stdin_data = (work / "in" / f"{op['stdin']}{extension_for(op['inputs'][op['stdin']])}").read_bytes()

    started = time.time()
    timed_out = False
    try:
        proc = subprocess.run(
            docker,
            input=stdin_data,
            capture_output=True,
            timeout=op.get("timeout_seconds", 300),
        )
        exit_code, stdout, stderr = proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired:
        timed_out = True
        exit_code, stdout, stderr = None, b"", b""
    elapsed = time.time() - started

    if op.get("stdout") and stdout:
        name = op["stdout"]
        port = op["outputs"][name]
        path = work / "out" / f"{name}{extension_for(port)}"
        path.write_bytes(stdout)
        output_paths[name] = path

    report = {
        "adapter": manifest["id"],
        "operation": op_name,
        "wall_seconds": round(elapsed, 3),
        "exit_code": exit_code,
        "stdout": stdout.decode(errors="replace")[:2000],
        "stderr": stderr.decode(errors="replace")[:2000],
        "machine_class": manifest["machine_class"],
        "limits": {"cpus": cpus, "memory": memory, "clamped_locally": clamped},
        "outputs": {},
        "workdir": str(work),
    }

    if timed_out:
        report["outcome"] = "timeout"
    elif exit_code == 125 or b"Unable to find image" in stderr:
        # Docker's own failure to start the container. Exit 125 is the daemon
        # saying "the run never happened", which is a different thing entirely
        # from the tool having failed.
        report["outcome"] = "image_missing"
    elif exit_code == 137:
        # SIGKILL under a memory cap. Distinguishing this from a generic failure
        # is what lets the platform say "wrong machine class" instead of "broken".
        report["outcome"] = "oom"
    else:
        report["outcome"] = "ok"

    if report["outcome"] == "ok":
        for name, port in op["outputs"].items():
            path = output_paths.get(name)
            present = path is not None and path.exists()
            if present and port["type"] == "Directory":
                members = sorted(p.name for p in path.iterdir())
                report["outputs"][name] = {"present": bool(members), "members": members}
                if not members:
                    report["outcome"] = "missing_output"
                continue
            size = path.stat().st_size if present and path.is_file() else 0
            entry = {"present": present, "bytes": size}
            if not present or size == 0:
                report["outcome"] = "missing_output"
            else:
                ok, detail = sniff(path, port)
                entry["sniff_ok"], entry["first_line"] = ok, detail
                if not ok and report["outcome"] == "ok":
                    report["outcome"] = "type_mismatch"
            report["outputs"][name] = entry
        if exit_code != 0 and report["outcome"] == "ok":
            report["outcome"] = "nonzero_exit"

    if not keep and report["outcome"] == "ok" and workdir is None:
        shutil.rmtree(work, ignore_errors=True)
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("adapter")
    ap.add_argument("operation")
    ap.add_argument("--input", action="append", default=[], metavar="NAME=PATH")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()
    inputs = dict(kv.split("=", 1) for kv in args.input)
    report = run_operation(args.adapter, args.operation, inputs, keep=args.keep)
    print(json.dumps(report, indent=2))
    sys.exit(0 if report["outcome"] == "ok" else 1)


if __name__ == "__main__":
    main()
