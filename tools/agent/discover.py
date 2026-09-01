#!/usr/bin/env python3
"""Deterministic lookups the agent should never do by hand.

Everything here is something a model *can* do with a shell and a URL, and does
worse: registry pagination, version comparison, digest resolution. Each is a
small, boring, exactly-correct answer, and each was a real mistake waiting to
happen when I wrapped MAFFT manually.

The stale-tag trap is the motivating case. quay.io returns tags unsorted and
unpaginated-by-recency; the first page of biocontainers/mafft leads with builds
from 2017. An agent that reads page one and picks something plausible wraps a
nine-year-old version and every downstream golden is recorded against it. No
amount of prompting fixes that reliably - so it is a function, not an
instruction.

These are exposed to the agent over MCP along with the rest of the platform's
primitives (see mcp_server.py). The reason is not the transport - it is that a
structured call returns structured results. An agent that shells out has to parse
a terminal, and a misparse becomes a wrong manifest; an agent that calls
validate_manifest gets a list of {path, message} it can act on directly. The
same argument applies to conformance, which is the agent's reward signal and the
last thing that should be read out of coloured output.

    discover.py image mafft
    discover.py digest quay.io/biocontainers/mafft:7.525--h031d066_1
    discover.py describe bakta
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

QUAY_TAGS = "https://quay.io/api/v1/repository/biocontainers/{name}/tag/?limit=100&onlyActiveTags=true"
NFCORE_META = "https://raw.githubusercontent.com/nf-core/modules/master/modules/nf-core/{name}/meta.yml"


def _get(url: str, timeout: int = 30):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError) as exc:
        return None


def version_key(tag: str) -> tuple:
    """Sort BioContainers tags by real version, then build number.

    Tags look like '7.525--h031d066_1'. Comparing them as strings puts 7.9 above
    7.525, and comparing build suffixes lexically is meaningless. Numeric
    components, compared numerically, with the build as the final tiebreak.
    """
    version, _, build = tag.partition("--")
    parts = tuple(int(p) for p in re.findall(r"\d+", version))
    build_number = int(m.group(1)) if (m := re.search(r"_(\d+)$", build)) else 0
    return (parts, build_number)


def find_image(name: str, limit: int = 5) -> dict:
    """Newest BioContainers tags for a tool, actually sorted."""
    raw = _get(QUAY_TAGS.format(name=name))
    if raw is None:
        return {"found": False, "reason": "registry unreachable", "name": name}
    tags = {t["name"] for t in json.loads(raw).get("tags", [])}
    if not tags:
        return {"found": False, "reason": "no BioContainer published for this name",
                "name": name,
                "hint": "the image must be built from source; see the Dockerfile path"}
    ordered = sorted(tags, key=version_key, reverse=True)
    return {
        "found": True,
        "name": name,
        "newest": ordered[0],
        "reference": f"quay.io/biocontainers/{name}:{ordered[0]}",
        "alternatives": ordered[1:limit],
        "note": "a tag is not enough - resolve it to a digest before recording goldens",
    }


def resolve_digest(reference: str) -> dict:
    """Pull an image and return its immutable digest reference.

    A manifest pinned by tag is a manifest whose goldens can be invalidated by
    someone else republishing that tag. Every adapter must pin by digest, and the
    workspace verifier refuses to promote one that does not.
    """
    pull = subprocess.run(["docker", "pull", "-q", reference],
                          capture_output=True, text=True, timeout=900)
    if pull.returncode != 0:
        return {"found": False, "reference": reference,
                "reason": pull.stderr.strip().splitlines()[-1] if pull.stderr else "pull failed"}
    inspect = subprocess.run(
        ["docker", "inspect", "--format", "{{index .RepoDigests 0}}", reference],
        capture_output=True, text=True,
    )
    if inspect.returncode != 0 or not inspect.stdout.strip():
        return {"found": False, "reference": reference,
                "reason": "image has no repo digest; it may have been built locally"}
    return {"found": True, "reference": reference, "pinned": inspect.stdout.strip()}


def find_description(name: str) -> dict:
    """Look for an existing machine-readable description of the tool.

    A shortcut, never a prerequisite. An nf-core meta.yml already states typed
    inputs and outputs and the container it was tested against, which is most of
    a manifest. When one exists, converting beats reverse-engineering; when none
    does, the agent probes, and that path has to work anyway.
    """
    raw = _get(NFCORE_META.format(name=name))
    if raw is None:
        return {"found": False, "name": name,
                "note": "no nf-core module; probe the tool directly"}
    return {"found": True, "name": name, "source": "nf-core/modules",
            "url": NFCORE_META.format(name=name),
            "meta_yml": raw.decode(errors="replace")[:4000],
            "note": "a hint, not an authority - verify every port against a real run"}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("image"); p.add_argument("name")
    p = sub.add_parser("digest"); p.add_argument("reference")
    p = sub.add_parser("describe"); p.add_argument("name")
    args = ap.parse_args()

    result = {"image": lambda: find_image(args.name),
              "digest": lambda: resolve_digest(args.reference),
              "describe": lambda: find_description(args.name)}[args.cmd]()
    print(json.dumps(result, indent=2))
    return 0 if result.get("found") else 1


if __name__ == "__main__":
    sys.exit(main())
