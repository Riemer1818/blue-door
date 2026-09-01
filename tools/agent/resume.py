#!/usr/bin/env python3
"""Saving an agent run so it can be picked up again.

An agent run is expensive and rare; the tool runs it produces are cheap and
frequent. That asymmetry is the whole economic case for the platform - but it
cuts the other way too. Discarding what a run learned means paying the full cost
again for a change a person could describe in one sentence.

Four reasons a run gets resumed, and the last is the one that shapes the design:

    upgrade   upstream released a new version; re-derive against it rather than
              from nothing, and diff the manifests
    repair    conformance broke after an image rebuild
    continue  the run ended `gave_up`; a human supplies the missing fact
    revise    a reviewer at the promotion gate wants one thing changed - "hits
              should be Table, not Text"

`revise` turns the promotion gate from an approve/reject switch into a
conversation, which is a much better shape for the human in the loop. It only
works if the run's state outlived the run.

WHAT IS WORTH KEEPING - and most of the staging directory is not:

    keep     the drafted adapter, scratch notes, the SDK session id, the event
             stream, the report
    discard  cloned repositories (re-clonable from source.repository + ref) and
             image layers (already cached by digest, and enormous)

That distinction matters because agent runs are meant to happen on ephemeral
machines. Whatever is kept has to be shipped off the machine before it dies, so
it needs to be small enough that shipping it is unremarkable.
"""

import json
import pathlib
import shutil
import tarfile
import tempfile

# Never archived. Both are reconstructible, and both are large enough to make
# the difference between an archive you can store per run and one you cannot.
EXCLUDE = {".git", "node_modules", "__pycache__", ".venv", "images"}


def archive(workspace, report_path: pathlib.Path, events_path: pathlib.Path | None,
            into: pathlib.Path) -> pathlib.Path:
    """Bundle the resumable state of a run into one file."""
    into.mkdir(parents=True, exist_ok=True)
    target = into / f"{workspace.adapter_id}-{report_path.stem}.tar.gz"

    def keep(entry: tarfile.TarInfo):
        parts = set(pathlib.PurePath(entry.name).parts)
        return None if parts & EXCLUDE else entry

    with tarfile.open(target, "w:gz") as tar:
        # Named for the adapter, not "adapter". conform.py validates the manifest
        # id against its directory name, so an archive that renames the directory
        # cannot be graded after restore - it fails statically with zero checks,
        # which is what the promotion gate hit the first time it ran for real.
        tar.add(workspace.adapter, arcname=workspace.adapter_id, filter=keep)
        if workspace.scratch.exists():
            tar.add(workspace.scratch, arcname="scratch", filter=keep)
        tar.add(report_path, arcname="report.json")
        if events_path and events_path.exists():
            tar.add(events_path, arcname="events.jsonl")
    return target


def restore(archive_path: pathlib.Path, into: pathlib.Path | None = None) -> dict:
    """Unpack an archived run. Returns paths plus what is needed to resume."""
    destination = pathlib.Path(into or tempfile.mkdtemp(prefix="doorway-resume-"))
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive_path, "r:gz") as tar:
        tar.extractall(destination, filter="data")

    report = json.loads((destination / "report.json").read_text())
    session = report.get("session", {})
    # Older archives stored it as "adapter"; accept both so existing runs stay
    # promotable rather than being stranded by the fix.
    adapter = destination / report.get("adapter_id", "adapter")
    if not adapter.exists():
        adapter = destination / "adapter"
    return {
        "root": destination,
        "adapter": adapter,
        "scratch": destination / "scratch",
        "report": report,
        # The SDK session id is what makes this a resume rather than a re-run:
        # the model keeps what it already worked out about the tool's interface
        # instead of re-probing to reach the same conclusions.
        "sdk_session_id": session.get("sdk_session_id"),
        "resumable": bool(session.get("sdk_session_id")),
        "previous_outcome": report.get("outcome"),
        "caveats": report.get("caveats", []),
    }
