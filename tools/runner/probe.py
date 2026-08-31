#!/usr/bin/env python3
"""Run an arbitrary command inside an adapter's image. The agent's microscope.

run.py executes operations a manifest already declares. Discovering what a tool
can do in the first place is the opposite problem - you have no manifest yet, and
the only way to find out how a CLI behaves is to run it and look. That is what
this is for: reading --help, listing what the image contains, trying a flag
against a real input to see what comes back.

It uses the same sandbox as the real runner (no network, resource caps, caller's
uid) so that what an agent learns here still holds when the operation is declared.
Nothing it does is recorded; a probe is a question, not an artefact.

    probe.py --image quay.io/biocontainers/seqkit:2.8.2--h9ee0642_0 -- seqkit --help
    probe.py --adapter tools/seqkit -- seqkit stats --help
    probe.py --adapter tools/seqkit --stage sequences=in.fasta -- \\
        seqkit fx2tab -nlg /work/in/sequences
"""

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from run import MACHINE_CLASSES, limits_for  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--image", help="container reference to probe directly")
    src.add_argument("--adapter", help="adapter directory; uses its declared image")
    ap.add_argument("--stage", action="append", default=[], metavar="NAME=PATH",
                    help="copy a file to /work/in/NAME before running")
    ap.add_argument("--machine-class", default="nano")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--json", action="store_true", help="machine-readable result")
    ap.add_argument("command", nargs=argparse.REMAINDER,
                    help="everything after -- is run inside the container")
    args = ap.parse_args()

    command = args.command[1:] if args.command and args.command[0] == "--" else args.command
    if not command:
        ap.error("no command given; put it after --")

    image = args.image
    machine_class = args.machine_class
    if args.adapter:
        manifest = json.loads((pathlib.Path(args.adapter) / "manifest.json").read_text())
        image = manifest["image"]
        machine_class = manifest.get("machine_class", machine_class)

    work = pathlib.Path(tempfile.mkdtemp(prefix="probe-"))
    (work / "in").mkdir()
    (work / "out").mkdir()
    for spec in args.stage:
        name, path = spec.split("=", 1)
        shutil.copy(path, work / "in" / name)

    cpus, memory, _ = limits_for(machine_class)
    docker = [
        "docker", "run", "--rm", "-i",
        "--network", "none",
        "--cpus", str(cpus), "--memory", memory, "--memory-swap", memory,
        "--user", f"{os.getuid()}:{os.getgid()}",
        "-v", f"{work}:/work", "-w", "/work",
        image,
    ] + command

    try:
        proc = subprocess.run(docker, capture_output=True, timeout=args.timeout)
        code, out, err = proc.returncode, proc.stdout, proc.stderr
        timed_out = False
    except subprocess.TimeoutExpired:
        code, out, err, timed_out = None, b"", b"", True

    produced = sorted(str(p.relative_to(work)) for p in work.rglob("*") if p.is_file())
    result = {
        "image": image,
        "command": command,
        "exit_code": code,
        "timed_out": timed_out,
        "stdout": out.decode(errors="replace"),
        "stderr": err.decode(errors="replace"),
        "files_in_work": produced,
    }
    shutil.rmtree(work, ignore_errors=True)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        if result["stdout"]:
            print(result["stdout"], end="")
        if result["stderr"]:
            print(result["stderr"], end="", file=sys.stderr)
        if produced:
            print(f"\n-- files under /work: {', '.join(produced)}", file=sys.stderr)
        print(f"-- exit {code}" + (" (timed out)" if timed_out else ""), file=sys.stderr)
    return 0 if code == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
