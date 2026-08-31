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
    "run.started": "kind, subject, machine_class?, limits?, parent_run_id?, step?",
    "phase.started": "phase",
    "phase.finished": "phase, status (ok|failed|skipped), seconds",
    "probe.ran": "image, command, exit_code, ms - image included because the command alone reproduces nothing",
    "image.built": "reference, digest, seconds",
    "manifest.drafted": "operations, port_types, iteration",
    "conformance.result": "passed, failed, failures[] - the reward signal",
    "artifact.written": "path, bytes",
    "note": "text - the agent's own commentary, for a human reading along",
    "log.line": "stream (stdout|stderr), text",
    "log.truncated": "stream, dropped - its own event, never a marker inside the text",
    "run.finished": "outcome, seconds, outputs? - outcome vocabulary depends on run kind",
}

# Two vocabularies, deliberately separate. A tool run and an agent run do not end
# in the same kind of thing, and collapsing them into one `outcome` field forces a
# console to guess which it is holding.
TOOL_OUTCOMES = {
    "ok": "declared outputs exist, are non-empty, and detect as the declared type",
    "nonzero_exit": "the tool reported failure honestly",
    "timeout": "exceeded the declared budget",
    "oom": "killed against the machine class memory cap",
    "precondition_failed": "an input did not satisfy what the operation requires, "
                           "so it never ran - the wrong kind of file, not a tool "
                           "or platform failure",
    "missing_output": "a declared output is absent or empty, whatever the exit code",
    "type_mismatch": "an output exists but is not the declared type",
    "image_missing": "the image could not be obtained - infrastructure, not the tool",
}

AGENT_OUTCOMES = {
    "conformant": "adapter drafted and passing conform.py, ready for review",
    "needs_review": "conformant, but with a caveat a human should see - unknown "
                    "license, or a port that fell back to the Text escape hatch",
    "gave_up": "could not produce a conformant adapter; the report says what it "
               "could not determine. The honest outcome, and far better than a "
               "plausible adapter nobody can trust",
    "rejected": "the run touched files outside its own adapter directory and was "
                "discarded. A guardrail trip, not a tool problem",
}

OUTCOMES = {"tool": TOOL_OUTCOMES, "pipeline": TOOL_OUTCOMES, "agent": AGENT_OUTCOMES}

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
    machine_class: str | None = None
    limits: dict | None = None
    parent_run_id: str | None = None
    step: str | None = None
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    started: float = field(default_factory=time.time)
    _seq: int = 0
    _phase: str | None = None
    _phase_started: float = 0.0

    def __post_init__(self):
        if self.sink is None:
            self.sink = jsonl_sink(sys.stdout)
        if self.kind not in OUTCOMES:
            raise ValueError(f"unknown run kind '{self.kind}' - expected {sorted(OUTCOMES)}")
        # machine_class and limits ride on run.started because run.py computes
        # `clamped_locally` precisely so an unreported clamp cannot turn a real OOM
        # into a mysterious one. If the clamp does not reach the stream, a `deep`
        # job that OOMs on a workstation reads as "wrong machine class" when the
        # truth is that the workstation could not honour the class at all.
        self.emit("run.started", {
            k: v for k, v in {
                "kind": self.kind,
                "subject": self.subject,
                "machine_class": self.machine_class,
                "limits": self.limits,
                "parent_run_id": self.parent_run_id,  # a pipeline nests its step runs
                "step": self.step,
            }.items() if v is not None
        })

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

    def finish(self, outcome: str, outputs: dict | None = None) -> dict:
        """Outcome is validated against this run's kind, so an agent run cannot
        quietly emit a tool outcome into a field a console types by kind."""
        allowed = OUTCOMES[self.kind]
        if outcome not in allowed:
            raise ValueError(
                f"'{outcome}' is not a valid {self.kind}-run outcome"
                f" - expected {sorted(allowed)}"
            )
        payload = {"outcome": outcome, "seconds": round(time.time() - self.started, 3)}
        if outputs is not None:
            payload["outputs"] = outputs  # per-output bytes and detection, from run.py
        return self.emit("run.finished", payload)


class _Phase:
    def __init__(self, run: Run, name: str):
        self.run, self.name, self.status = run, name, "ok"

    def skip(self, why: str) -> None:
        """Mark this phase skipped rather than done. Caller explains why."""
        self.status = "skipped"
        self.run.note(f"{self.name} skipped: {why}")

    def __enter__(self):
        self.started = time.time()
        self.run.emit("phase.started", {"phase": self.name})
        return self

    def __exit__(self, exc_type, exc, tb):
        # A phase that raised still gets a finished event. A progress view whose
        # steps can hang forever on failure is worse than one that shows an error.
        # Tri-state, not a boolean. "skipped" is real - acquire is skipped when a
        # published container already exists - and a console that renders skipped
        # as failed is lying. Status is on the event rather than inferred, because
        # failed phases expand by default.
        self.run.emit("phase.finished", {
            "phase": self.name,
            "status": self.status if exc_type is None else "failed",
            "seconds": round(time.time() - self.started, 3),
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
