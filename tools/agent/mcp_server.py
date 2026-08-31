#!/usr/bin/env python3
"""The platform's primitives, exposed to the adapter agent over MCP.

Every tool here is something the agent could do with a shell. The reason to
serve them properly is that a structured call returns a structured answer. An
agent that shells out to conform.py has to parse coloured terminal output, and a
misparse becomes a wrong manifest silently; an agent that calls
`check_conformance` receives a list of failures with their operation, port and
reason, and can act on the specific one.

That matters most for the two calls in the agent's inner loop. `validate_manifest`
is consulted on every draft, and `check_conformance` is the reward signal - the
last thing that should be read out of ANSI escapes.

Note what is deliberately absent: nothing here writes to the repository, and
nothing promotes an adapter. The agent's output reaches the catalogue through
workspace.verify() and a human, never through a tool it can call itself.

    tools/agent/.venv/bin/python tools/agent/mcp_server.py
"""

import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "runner"))

from mcp.server.mcpserver import MCPServer  # noqa: E402

import discover  # noqa: E402

TOOLS_ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNNER = TOOLS_ROOT / "runner"

server = MCPServer(
    name="doorway",
    instructions=(
        "Primitives for wrapping a command-line tool as a catalogue adapter. "
        "Draft a manifest, validate it, probe the tool inside its image to learn "
        "what it actually does, then check conformance. Conformance passing is the "
        "definition of done - not your own judgement that the manifest looks right."
    ),
)


@server.tool(description="Validate a draft manifest against the adapter schema. Call this on every draft; it is far cheaper than a conformance run.")
def validate_manifest(manifest: dict) -> dict:
    import jsonschema

    schema = json.loads((TOOLS_ROOT / "manifest.schema.json").read_text())
    errors = sorted(
        jsonschema.Draft202012Validator(schema).iter_errors(manifest),
        key=lambda e: list(e.absolute_path),
    )
    if not errors:
        return {"valid": True}
    return {
        "valid": False,
        "errors": [
            {
                "path": ".".join(str(x) for x in e.absolute_path) or "(root)",
                "message": e.message,
            }
            for e in errors[:20]
        ],
        "hint": "the schema sets additionalProperties:false - an unexpected key is a "
                "typo or an invented field, not a missing feature",
    }


@server.tool(description="The port-type vocabulary: what types exist, their formats, and a specimen file of each. Use a declared type; do not invent one.")
def list_port_types() -> dict:
    catalogue = json.loads((TOOLS_ROOT / "porttypes.json").read_text())["types"]
    return {
        "types": {
            name: {
                "description": spec["description"],
                "formats": {
                    fmt: {
                        "extensions": f.get("extensions", []),
                        "example": str(TOOLS_ROOT / f["example"]) if f.get("example") else None,
                        "structural_check": f.get("structure"),
                    }
                    for fmt, f in spec["formats"].items()
                },
            }
            for name, spec in catalogue.items()
        },
        "note": "Text is an escape hatch. An adapter that types everything as Text has "
                "been wrapped, not ported, and will not compose with anything.",
    }


@server.tool(description="Available machine classes. Declare the smallest one that fits; never state raw CPU or memory numbers.")
def list_machine_classes() -> dict:
    return json.loads((TOOLS_ROOT / "machineclasses.json").read_text())


@server.tool(description="Run a command inside a container image to learn how the tool behaves. This is how you discover an interface that has no machine-readable description.")
def probe(image: str, command: list[str], stage: dict | None = None,
          timeout_seconds: int = 120) -> dict:
    argv = [sys.executable, str(RUNNER / "probe.py"), "--image", image,
            "--timeout", str(timeout_seconds), "--json"]
    for name, path in (stage or {}).items():
        argv += ["--stage", f"{name}={path}"]
    argv += ["--"] + command
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout_seconds + 60)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return {"error": "probe failed to run", "detail": result.stderr[-800:]}


@server.tool(description="Grade an adapter directory. Conformance passing is the definition of done. Returns each failure with its cause rather than a printed report.")
def check_conformance(adapter_dir: str) -> dict:
    """Assembled from the grader's own functions, not parsed from its output.

    Importing conform means this cannot drift from what CI runs, and it means the
    agent receives failures as data - operation, case, reason - instead of lines
    it has to interpret.
    """
    import conform

    path = pathlib.Path(adapter_dir)
    if not (path / "manifest.json").exists():
        return {"error": f"no manifest.json in {adapter_dir}"}
    manifest = json.loads((path / "manifest.json").read_text())

    problems, warnings = conform.static_checks(manifest, path)
    if problems:
        return {"passed": False, "stage": "static", "problems": problems,
                "warnings": warnings}

    results, failures = [], []
    for case_dir in sorted(p for p in (path / "fixtures").glob("*") if p.is_dir()):
        case = json.loads((case_dir / "case.json").read_text()) if (case_dir / "case.json").exists() else {}
        for op_name in manifest["operations"]:
            status, detail = conform.grade_operation(
                path, manifest, op_name, case_dir,
                case.get("expect", {}).get(op_name, "ok"), False,
            )
            entry = {"case": case_dir.name, "operation": op_name,
                     "status": status, "detail": detail}
            results.append(entry)
            if status == "fail":
                failures.append(entry)

    return {
        "passed": not failures,
        "stage": "operations",
        "checks": len(results),
        "failures": failures,
        "results": results,
        "warnings": warnings,
    }


@server.tool(description="Find a published BioContainers image for a tool, newest first and correctly version-sorted. If none exists, the image must be built from source.")
def find_image(name: str) -> dict:
    return discover.find_image(name)


@server.tool(description="Resolve an image reference to its immutable digest. Every manifest must pin by digest; promotion refuses a tag.")
def resolve_digest(reference: str) -> dict:
    return discover.resolve_digest(reference)


@server.tool(description="Look for an existing machine-readable description (nf-core meta.yml). A shortcut when one exists, never a prerequisite - verify every port against a real run.")
def find_description(name: str) -> dict:
    return discover.find_description(name)


if __name__ == "__main__":
    server.run(transport="stdio")
