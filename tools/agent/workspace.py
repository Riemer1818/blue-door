#!/usr/bin/env python3
"""The agent's sandbox, and the guardrails that make `rejected` enforceable.

The agent is given real power - it reads upstream code, runs containers, writes
its own throwaway probes. That is the right call: a tool with no machine-readable
description can only be understood by poking at it. But power granted has to be
power bounded, and the bound cannot be the prompt. A prompt is a request; this
module is the check.

Two directories, and the split is the whole design:

    <staging>/<adapter_id>/   what may be promoted. Verified against an allowlist
    <staging>/scratch/        probe scripts, downloaded repos, half-built images.
                              Never promoted, never read again, deleted with the run

The promotable directory is named for the adapter, not "adapter", because
conform.py checks the manifest id against its directory name. Grading in staging
has to exercise that same check, or an id mismatch would only surface after
promotion - which is exactly the class of error staging exists to catch early.

An agent that writes a helper script into the adapter directory has produced an
artefact nobody can review, so the allowlist rejects it and the scratch directory
gives it somewhere legitimate to put it instead. Guardrails that leave no room to
do the right thing get worked around.

Nothing reaches the repository until conformance passes AND verify() is clean.
conform.py grades an adapter directory wherever it lives, so the whole loop runs
out of tree.
"""

import fnmatch
import json
import pathlib
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field

# What may be promoted. Everything the agent learned should be expressed in these
# or discarded - an adapter is a manifest, optionally an image recipe, and the
# evidence that it works.
PROMOTABLE = [
    "manifest.json",
    "Dockerfile",
    ".dockerignore",
    "README.md",
    "fixtures/*/case.json",
    "fixtures/*/inputs/*",
    "fixtures/*/expected/*/*",
]


@dataclass
class Workspace:
    adapter_id: str
    root: pathlib.Path          # the repository worktree
    staging: pathlib.Path
    repo_state: str = ""        # git porcelain snapshot, taken before the agent runs
    _kept: bool = field(default=False, repr=False)

    @property
    def adapter(self) -> pathlib.Path:
        return self.staging / self.adapter_id

    @property
    def scratch(self) -> pathlib.Path:
        return self.staging / "scratch"

    def verify(self) -> list[str]:
        """Everything that must hold before a single byte reaches the repository."""
        problems = []

        # 1. The repository is untouched. The agent has no business writing here at
        # all, so any difference from the pre-run snapshot is a trip, not a diff to
        # review. This catches an edit to the runner, the schema or another adapter
        # - the changes that would let a bad adapter appear to pass.
        if self._git_state() != self.repo_state:
            problems.append(
                "the repository changed during the run; the agent must work only in staging"
            )

        manifest_path = self.adapter / "manifest.json"
        if not manifest_path.exists():
            problems.append("no manifest.json was produced")
            return problems

        # 2. Only promotable files. Probe scripts belong in scratch/ and are
        # discarded; anything else is an artefact nobody agreed to review.
        for path in sorted(self.adapter.rglob("*")):
            if path.is_dir():
                continue
            rel = str(path.relative_to(self.adapter))
            if not any(fnmatch.fnmatch(rel, pattern) for pattern in PROMOTABLE):
                problems.append(f"not promotable: {rel} (scratch/ is the place for this)")

        try:
            manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            problems.append(f"manifest.json is not valid JSON: {exc}")
            return problems

        # 3. Identity. conform.py already checks id against directory name, but it
        # is checked here too because promotion uses the id to choose a destination
        # - a mismatch would write the adapter somewhere nobody expects.
        if manifest.get("id") != self.adapter_id:
            problems.append(
                f"manifest id '{manifest.get('id')}' does not match the requested "
                f"adapter id '{self.adapter_id}'"
            )

        # 4. Digest pinning. conform.py warns; promotion refuses. Every golden
        # recorded here is only as trustworthy as the image identity behind it, and
        # a tag can be republished under the same name tomorrow.
        image = manifest.get("image", "")
        built_here = (self.adapter / "Dockerfile").exists()
        if "@sha256:" not in image and not built_here:
            problems.append(f"image '{image}' is not pinned by digest")

        # 5. Destination is free. Promoting over an existing adapter would be an
        # upgrade, which is a different operation with different review needs.
        if (self.root / "tools" / self.adapter_id).exists():
            problems.append(f"tools/{self.adapter_id} already exists; this would overwrite it")

        return problems

    def promote(self) -> pathlib.Path:
        """Copy the verified adapter into the repository. Caller has already
        confirmed conformance passed and verify() returned nothing."""
        remaining = self.verify()
        if remaining:
            raise RuntimeError(f"refusing to promote: {remaining[0]}")
        destination = self.root / "tools" / self.adapter_id
        shutil.copytree(self.adapter, destination)
        return destination

    def keep(self) -> None:
        """Retain the staging directory after the run, for debugging a failure."""
        self._kept = True

    def cleanup(self) -> None:
        if not self._kept:
            shutil.rmtree(self.staging, ignore_errors=True)

    def _git_state(self) -> str:
        result = subprocess.run(
            ["git", "-C", str(self.root), "status", "--porcelain"],
            capture_output=True, text=True,
        )
        return result.stdout


def prepare(adapter_id: str, root: pathlib.Path | str) -> Workspace:
    """Create a sandbox and snapshot the repository so tampering is detectable."""
    root = pathlib.Path(root).resolve()
    staging = pathlib.Path(tempfile.mkdtemp(prefix=f"doorway-{adapter_id}-"))
    workspace = Workspace(adapter_id=adapter_id, root=root, staging=staging)
    workspace.adapter.mkdir(parents=True)
    workspace.scratch.mkdir(parents=True)
    workspace.repo_state = workspace._git_state()
    return workspace
