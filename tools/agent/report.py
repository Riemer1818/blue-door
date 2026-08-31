#!/usr/bin/env python3
"""The report a human reads at the promotion gate.

An agent run emits two things. The JSONL event stream is the narrative and the
audit trail - what was probed, in what order, what failed and was retried. The
report is a single structured summary, computed once at the end.

Both exist because they answer different questions. "Show me how it got here" is
the stream. "Should I approve this" is the report, and making a reviewer fold
several hundred events to find out whether the license was found would be the
same mistake as parsing conform.py's coloured output.

The report is deliberately opinionated about what a reviewer must see, because
the failure mode here is not a wrong adapter - conformance catches those. It is a
*plausible* adapter: one that passes every check, composes with nothing because
every port is Text, and carries a license nobody established. Those are invisible
unless something insists on showing them.
"""

import json
import pathlib
from dataclasses import dataclass, field, asdict
from typing import Any

SCHEMA_VERSION = "0.1"


@dataclass
class Caveat:
    """Something the agent could not establish. Present even on success.

    An empty caveat list is a claim, and a useful one. A reviewer who sees
    "nothing unresolved" learns more than one shown nothing at all.
    """
    kind: str        # license_unknown | text_fallback | ambiguous_image | untested_path
    detail: str
    where: str = ""  # port, operation, or file it concerns


@dataclass
class Report:
    schema_version: str = SCHEMA_VERSION
    run_id: str = ""
    adapter_id: str = ""
    requested: dict = field(default_factory=dict)   # what the human asked for
    outcome: str = ""                               # AGENT_OUTCOMES
    seconds: float = 0.0

    # Trust anchor. Every golden below is only as good as this.
    image: dict = field(default_factory=dict)       # reference, digest, origin
    source: dict = field(default_factory=dict)      # repository, ref, commit

    # What would land in the repository. Promotion is a copytree, so a reviewer
    # should see the exact file list rather than infer it.
    promotable: list = field(default_factory=list)
    rejected_files: list = field(default_factory=list)  # path + why the allowlist refused

    manifest: dict | None = None
    conformance: dict = field(default_factory=dict)  # passed, checks, failures[]
    guardrails: list = field(default_factory=list)   # workspace.verify() output
    port_types_used: list = field(default_factory=list)
    license: dict = field(default_factory=dict)      # value + found|assumed|unknown
    probes: list = field(default_factory=list)       # image, command, exit_code, ms
    caveats: list = field(default_factory=list)

    def add_caveat(self, kind: str, detail: str, where: str = "") -> None:
        self.caveats.append(asdict(Caveat(kind=kind, detail=detail, where=where)))

    def derive_caveats(self) -> None:
        """Caveats a reviewer should never have to notice for themselves.

        Each of these is a way for an adapter to pass every mechanical check and
        still be wrong in a way only a person can judge.
        """
        if self.license.get("basis") != "found":
            self.add_caveat(
                "license_unknown",
                f"license recorded as {self.license.get('value') or 'none'} "
                f"({self.license.get('basis', 'unknown')}). Nothing enforces this yet, "
                f"so this gate is where it gets looked at.",
            )
        for port in self.port_types_used:
            if port.get("type") == "Text":
                self.add_caveat(
                    "text_fallback",
                    "typed as Text, the escape hatch. It will pass conformance and "
                    "compose with nothing. Check whether a real type fits, or whether "
                    "the vocabulary needs extending.",
                    where=f"{port.get('operation')}.{port.get('port')}",
                )
        if self.image.get("origin") == "built_from_source" and not self.image.get("digest"):
            self.add_caveat(
                "untested_path",
                "image was built here but has no digest, so goldens cannot be tied to "
                "a specific image.",
            )

    def summary_line(self) -> str:
        c = self.conformance
        return (
            f"{self.adapter_id}: {self.outcome} | "
            f"conformance {'passed' if c.get('passed') else 'FAILED'} "
            f"{c.get('checks', 0)} checks | "
            f"{len(self.caveats)} caveat(s) | {self.seconds:.0f}s"
        )

    def write(self, path: pathlib.Path) -> pathlib.Path:
        self.derive_caveats()
        path.write_text(json.dumps(asdict(self), indent=2) + "\n")
        return path


def load(path: pathlib.Path | str) -> dict:
    return json.loads(pathlib.Path(path).read_text())
