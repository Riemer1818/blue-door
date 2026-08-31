#!/usr/bin/env python3
"""Structured events for a run.

A run is the one primitive behind both things anyone watches: the adapter agent
setting up a tool, and a wrapped tool executing a job. Both emit events and end
in an outcome.

Two rules this module exists to enforce:

**Structured, not a text firehose.** `log.line` is one event *kind*, not the
medium. A UI reading these should be able to render a phase checklist with
status and elapsed time without parsing a single line of prose. If the only
thing ever emitted is `log.line`, this file has failed at its job.

**One producer, many consumers.** The agent emits here once. Where events go -
stdout as JSONL now, Postgres and SSE later (BLU-10), a metrics backend later
still (BLU-14) - is the sink's business, never the caller's. Nothing upstream
should ever write the same event twice in two formats.

The vocabulary is shared with the frontend work in BLU-10/11. Changing it is a
cross-session decision, not a local one.
"""

import json
import sys
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

# Event kinds. Keep this list closed and short; a vocabulary nobody can hold in
# their head gets bypassed with log.line, and then the UI is a terminal again.
KINDS = {
    "run.started": "kind (agent|tool|pipeline), subject",
    "phase.started": "phase",
    "phase.finished": "phase, seconds, ok",
    "probe.ran": "command, exit_code, ms - what the agent tried and what happened",
    "image.built": "reference, digest, seconds",
    "manifest.drafted": "operations, port_types, iteration",
    "conformance.result": "passed, failed, failures[] - the reward signal",
    "artifact.written": "path, bytes",
    "note": "text - the agent's own commentary, for a human reading along",
    "log.line": "stream (stdout|stderr), text",
    "run.finished": "outcome, seconds",
}

# Phases of an adapter-agent run, in order. Named here rather than in the prompt
# so the UI can render the whole checklist before the agent has reached step two -
# a progress view that only reveals steps as they start cannot show what remains.
PHASES = ["discover", "acquire", "probe", "draft", "fixtures", "verify", "publish"]


@dataclass
class Run:
    """Emits events for one run. Sinks decide where they land."""

    kind: str
    subject: str
    sink: Callable[[dict], None] | None = None
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    started: float = field(default_factory=time.time)
    _seq: int = 0
    _phase: str | None = None
    _phase_started: float = 0.0

    def __post_init__(self):
        if self.sink is None:
            self.sink = jsonl_sink(sys.stdout)
        self.emit("run.started", {"kind": self.kind, "subject": self.subject})

    def emit(self, kind: str, payload: dict[str, Any] | None = None) -> dict:
        """Envelope fields stay flat; everything else nests under `payload`.

        Payload is an explicit dict rather than **kwargs. Keyword capture cannot
        express a payload key named `kind`, because Python binds it to the
        parameter first - which broke `run.started` immediately, and `seq`, `at`
        and `run_id` were all waiting to do the same. Nesting also hands BLU-10 its
        table shape directly: run_id, seq, at, kind as columns, payload as jsonb.
        """
        if kind not in KINDS:
            raise ValueError(f"unknown event kind '{kind}' - extend KINDS deliberately")
        self._seq += 1
        event = {
            "run_id": self.run_id,
            "seq": self._seq,  # monotonic; this is what a reconnecting client resumes from
            "at": round(time.time() - self.started, 3),
            "kind": kind,
            "payload": payload or {},
        }
        self.sink(event)
        return event

    def phase(self, name: str):
        """Context manager for one phase. Records duration and success either way."""
        if name not in PHASES:
            raise ValueError(f"unknown phase '{name}' - expected one of {PHASES}")
        return _Phase(self, name)

    def note(self, text: str) -> None:
        self.emit("note", {"text": text})

    def finish(self, outcome: str) -> dict:
        return self.emit("run.finished", {
            "outcome": outcome,
            "seconds": round(time.time() - self.started, 3),
        })


class _Phase:
    def __init__(self, run: Run, name: str):
        self.run, self.name = run, name

    def __enter__(self):
        self.started = time.time()
        self.run.emit("phase.started", {"phase": self.name})
        return self.run

    def __exit__(self, exc_type, exc, tb):
        # A phase that raised still gets a finished event. A progress view whose
        # steps can hang forever on failure is worse than one that shows an error.
        self.run.emit("phase.finished", {
            "phase": self.name,
            "seconds": round(time.time() - self.started, 3),
            "ok": exc_type is None,
        })
        return False


def jsonl_sink(stream) -> Callable[[dict], None]:
    """One JSON object per line. Trivially tailable, trivially parseable."""
    def write(event: dict) -> None:
        stream.write(json.dumps(event) + "\n")
        stream.flush()  # a progress stream that buffers is not a progress stream
    return write


def fanout_sink(*sinks: Callable[[dict], None]) -> Callable[[dict], None]:
    """Several destinations, one emit call. The seam where Postgres joins later."""
    def write(event: dict) -> None:
        for sink in sinks:
            sink(event)
    return write


def collecting_sink(into: list) -> Callable[[dict], None]:
    """For tests, and for a harness that wants the transcript after the fact."""
    return into.append
