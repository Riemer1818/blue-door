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

SCHEMA_VERSION = "0.2"  # 0.2 added version{}, session{}, image.candidates


def stated(value, basis: str, note: str = "") -> dict:
    """A value plus how it was arrived at.

    Anything that can be found or guessed carries its provenance as a field,
    never as the absence of one. "no license" and "assumed MIT because the repo
    has no LICENSE file but setup.py says so" must not both arrive as a missing
    key - the second is the one that becomes a legal problem quietly, and it is
    only visible if it is stated.

    basis: found    read directly from the repo, image metadata or registry
           assumed  inferred from something weaker, with the reasoning in `note`
           unknown  could not be established at all
    """
    if basis not in ("found", "assumed", "unknown"):
        raise ValueError(f"basis must be found|assumed|unknown, got '{basis}'")
    return {"value": value, "basis": basis, "note": note}


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
    image: dict = field(default_factory=dict)       # reference, digest, origin, basis
    source: dict = field(default_factory=dict)      # repository, ref, commit
    version: dict = field(default_factory=dict)     # stated() - versions get guessed too

    # What is needed to pick this run back up. An agent run is expensive and
    # rare; the tool runs it produces are cheap and frequent. Throwing away what
    # it learned means paying that cost again for an upgrade, a repair, or a
    # reviewer asking for one change.
    session: dict = field(default_factory=dict)

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
        """Caveats the agent volunteers. Derived ones are computed separately."""
        self.caveats.append(asdict(Caveat(kind=kind, detail=detail, where=where)))

    def derive_caveats(self) -> list[dict]:
        """Caveats a reviewer should never have to notice for themselves.

        Each is a way for an adapter to pass every mechanical check and still be
        wrong in a way only a person can judge.

        Returns a fresh list rather than mutating self.caveats, so writing the
        report twice - a retry, or writing to two places - cannot duplicate them.
        Non-idempotence here would only bite under retry, which is exactly when
        nobody is reading carefully.
        """
        derived: list[dict] = []

        def note(kind, detail, where=""):
            derived.append(asdict(Caveat(kind=kind, detail=detail, where=where)))

        for name, value in (("license", self.license), ("version", self.version)):
            basis = value.get("basis", "unknown")
            if basis != "found":
                why = value.get("note", "")
                note(
                    f"{name}_unknown",
                    f"{name} recorded as {value.get('value') or 'none'} ({basis})."
                    + (f" {why}" if why else "")
                    + (" Nothing enforces this yet, so this gate is where it gets"
                       " looked at." if name == "license" else ""),
                )

        for port in self.port_types_used:
            if port.get("type") == "Text":
                note(
                    "text_fallback",
                    "typed as Text, the escape hatch. It will pass conformance and "
                    "compose with nothing. Check whether a real type fits, or whether "
                    "the vocabulary needs extending.",
                    where=f"{port.get('operation')}.{port.get('port')}",
                )

        # The image choice is the agent's own judgement call, which makes it the
        # caveat most exposed to an agent that would rather file a quiet report:
        # not mentioning the three other candidates costs it nothing. So it is
        # derived from the candidate set find_image returns, never volunteered.
        candidates = self.image.get("candidates") or []
        chosen = self.image.get("reference")
        if len(candidates) > 1 and chosen and chosen != candidates[0]:
            note(
                "ambiguous_image",
                f"chose {chosen} over the newest candidate {candidates[0]}. "
                f"{len(candidates)} were available: {', '.join(candidates[:4])}"
                + (" ..." if len(candidates) > 4 else ""),
            )
        elif self.image.get("basis") == "assumed":
            note(
                "ambiguous_image",
                f"the package name behind {chosen} was inferred rather than "
                f"confirmed. {self.image.get('note', '')}".strip(),
            )

        if self.image.get("origin") == "built_from_source" and not self.image.get("digest"):
            note(
                "untested_path",
                "image was built here but has no digest, so goldens cannot be tied to "
                "a specific image.",
            )
        return derived

    def all_caveats(self) -> list[dict]:
        return self.caveats + self.derive_caveats()

    def summary_line(self) -> str:
        c = self.conformance
        return (
            f"{self.adapter_id}: {self.outcome} | "
            f"conformance {'passed' if c.get('passed') else 'FAILED'} "
            f"{c.get('checks', 0)} checks | "
            f"{len(self.all_caveats())} caveat(s) | {self.seconds:.0f}s"
        )

    def write(self, path: pathlib.Path) -> pathlib.Path:
        """Idempotent: derived caveats are computed fresh, never accumulated."""
        payload = asdict(self)
        payload["caveats"] = self.all_caveats()
        path.write_text(json.dumps(payload, indent=2) + "\n")
        return path


def load(path: pathlib.Path | str) -> dict:
    return json.loads(pathlib.Path(path).read_text())
