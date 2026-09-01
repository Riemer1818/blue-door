#!/usr/bin/env python3
"""Measure what an operation actually consumes, so machine_class stops being a guess.

    profile.py tools/faster                 measure every operation
    profile.py tools/faster --write         record it in the manifest
    profile.py tools/faster --suggest-class

HOW PEAK MEMORY IS MEASURED, since the method decides what the numbers mean.
cgroup v2 exposes `memory.peak` per container - a high-water mark, not an
instantaneous reading. That matters: a sampler reading `memory.current` would
miss any spike between samples and report a number that is confidently too low,
which for a machine class is the dangerous direction. Reading a high-water mark
once before teardown captures the true peak whatever the polling rate.

The catch is that the cgroup is destroyed when the container exits, so the read
has to happen while it runs. A poller does that, and if a run finishes before
any read lands the answer is **absent, never zero**. Zero would be read as "uses
no memory" and would pick `nano` for everything - a missing measurement must
look missing.

The tool's own command is never touched. Wrapping it to self-report would change
what is being measured and would need a shell in every image.
"""

import argparse
import glob
import json
import pathlib
import sys
import threading
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from run import MACHINE_CLASSES, extension_for, run_operation  # noqa: E402


def cgroup_peak_path(container_id: str) -> str | None:
    """Where this container's memory.peak lives. Layout varies by cgroup driver."""
    for pattern in (
        f"/sys/fs/cgroup/system.slice/docker-{container_id}.scope/memory.peak",
        f"/sys/fs/cgroup/docker/{container_id}/memory.peak",
        f"/sys/fs/cgroup/**/docker-{container_id}.scope/memory.peak",
    ):
        for match in glob.glob(pattern, recursive=True):
            return match
    return None


class PeakWatcher(threading.Thread):
    """Follows a container's memory high-water mark until it disappears."""

    def __init__(self, cidfile: pathlib.Path, interval: float = 0.02):
        super().__init__(daemon=True)
        self.cidfile, self.interval = cidfile, interval
        self.peak_bytes: int | None = None
        self.reads = 0
        self._stopping = threading.Event()  # not _stop: Thread._stop is real

    def run(self):
        path = None
        while not self._stopping.is_set():
            if path is None:
                try:
                    cid = self.cidfile.read_text().strip()
                    if cid:
                        path = cgroup_peak_path(cid)
                except OSError:
                    pass
            if path:
                try:
                    value = int(pathlib.Path(path).read_text().strip())
                    # Monotonic by definition, but take the max anyway - a stale
                    # read after teardown should never lower the answer.
                    self.peak_bytes = max(self.peak_bytes or 0, value)
                    self.reads += 1
                except (OSError, ValueError):
                    pass
            time.sleep(self.interval)

    def stop(self):
        self._stopping.set()
        self.join(timeout=1.0)


def measure(adapter_dir: pathlib.Path, op_name: str, inputs: dict) -> dict:
    import run as R

    cidfile = pathlib.Path(f"/tmp/doorway-cid-{op_name}-{int(time.time()*1000)}")
    cidfile.unlink(missing_ok=True)
    original = R.subprocess.run

    def instrumented(argv, **kwargs):
        if argv and argv[0] == "docker" and "run" in argv[:2]:
            argv = argv[:2] + ["--cidfile", str(cidfile)] + argv[2:]
        return original(argv, **kwargs)

    watcher = PeakWatcher(cidfile)
    R.subprocess.run = instrumented
    watcher.start()
    try:
        report = run_operation(adapter_dir, op_name, inputs)
    finally:
        R.subprocess.run = original
        watcher.stop()
        cidfile.unlink(missing_ok=True)

    result = {
        "operation": op_name,
        "outcome": report["outcome"],
        "wall_seconds": report.get("wall_seconds"),
        "input_bytes": sum(pathlib.Path(p).stat().st_size for p in inputs.values()
                           if pathlib.Path(p).exists()),
    }
    if watcher.peak_bytes:
        result["peak_rss_mb"] = round(watcher.peak_bytes / 1048576, 1)
    else:
        # Absent, not zero. A run too short for any read to land is unmeasured,
        # and unmeasured must not look like frugal.
        result["peak_rss_mb"] = None
        result["note"] = f"no cgroup read landed in {report.get('wall_seconds')}s"
    return result


def suggest_class(peak_mb: float | None, wall: float | None) -> str | None:
    """Smallest class whose memory cap holds the measurement, with headroom.

    Headroom is not politeness. A class sized exactly to a measured peak will OOM
    on an input a few percent larger, and the measurement came from a fixture
    that is almost certainly smaller than real data.
    """
    if peak_mb is None:
        return None
    needed = peak_mb * 1.5
    for name, spec in MACHINE_CLASSES["classes"].items():
        if "gpu" in name:
            continue
        if int(spec["memory"].rstrip("g")) * 1024 >= needed:
            return name
    return "deep"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("adapter")
    ap.add_argument("--write", action="store_true", help="record into the manifest")
    ap.add_argument("--suggest-class", action="store_true")
    args = ap.parse_args()

    adapter = pathlib.Path(args.adapter)
    manifest = json.loads((adapter / "manifest.json").read_text())
    cases = sorted(p for p in (adapter / "fixtures").glob("*") if p.is_dir())
    results, worst_mb, worst_from = [], None, None

    for op_name, op in manifest["operations"].items():
        for case in cases:
            inputs = {}
            for port_name, port in op.get("inputs", {}).items():
                candidate = case / "inputs" / f"{port_name}{extension_for(port)}"
                if candidate.exists():
                    inputs[port_name] = str(candidate)
            if len(inputs) < len([p for p in op.get("inputs", {}).values()
                                  if p.get("required", True)]):
                continue
            r = measure(adapter, op_name, inputs)
            r["fixture"] = case.name
            results.append(r)
            mb = r.get("peak_rss_mb")
            if mb is not None and (worst_mb is None or mb > worst_mb):
                worst_mb, worst_from = mb, f"{case.name}/{op_name}"
            peak = f"{mb:>7.1f} MB" if mb is not None else "unmeasured"
            print(f"  {case.name}/{op_name:<20} {r['outcome']:<20} {peak}  "
                  f"{r['wall_seconds']}s  in={r['input_bytes']:,}B")

    declared = manifest["machine_class"]
    if worst_mb is None:
        print(f"\n  nothing measured; leaving machine_class '{declared}' alone")
        return 1
    proposed = suggest_class(worst_mb, None)
    print(f"\n  peak {worst_mb} MB from {worst_from}")
    print(f"  declared {declared}, smallest class that fits with 50% headroom: {proposed}")

    if args.write:
        manifest["measured"] = {
            "peak_rss_mb": worst_mb,
            "wall_seconds": max(r["wall_seconds"] or 0 for r in results),
            "fixture": worst_from,
        }
        (adapter / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"  written to {adapter}/manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
