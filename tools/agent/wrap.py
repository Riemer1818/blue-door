#!/usr/bin/env python3
"""Wrap a tool as a catalogue adapter, using a coding agent.

    wrap.py mafft
    wrap.py blast --url https://github.com/ncbi/blast_plus_docs
    wrap.py mafft --resume runs/mafft-report.tar.gz --message "hits should be Table"

A CLI, not a service, and deliberately: the web app invokes this as a job rather
than driving the SDK itself. A human in a terminal and the backend then run the
identical code path, which removes the whole "works in the app, not locally"
class of bug. The SDK is an implementation detail inside here.

The platform's primitives are hosted IN-PROCESS as an SDK MCP server rather than
spawned over stdio. That is what lets every tool call the agent makes become an
event without any IPC: the tool function has the Run object in scope and emits
directly. mcp_server.py stays as the standalone stdio entry point for a human
driving Claude Code by hand; the logic lives in one place and both use it.

Nothing here promotes an adapter. The run ends at a report, and a human decides.
"""

import argparse
import asyncio
import json
import pathlib
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "runner"))

from claude_agent_sdk import (  # noqa: E402
    AssistantMessage, ClaudeAgentOptions, ResultMessage, SystemMessage,
    TextBlock, ToolUseBlock, create_sdk_mcp_server, query, tool,
)

import events as E  # noqa: E402
import mcp_server as M  # noqa: E402
import report as R  # noqa: E402
import resume as RES  # noqa: E402
import workspace as W  # noqa: E402

TOOLS_ROOT = HERE.parent


def build_toolset(run: E.Run, state: dict, workspace_scratch: pathlib.Path):
    """The doorway tools, each emitting an event as a side effect of being called.

    The agent cannot opt out of being observed: emission happens here, in the
    harness, not in anything the model controls. That is the same principle as
    derived caveats - never rely on an agent to report what it is rewarded for
    omitting.
    """

    @tool("set_phase", "Declare which phase of the wrapping loop you are in.",
          {"phase": str})
    async def set_phase(args):
        phase = args["phase"]
        if phase not in E.PHASES:
            return {"content": [{"type": "text",
                                 "text": f"unknown phase; expected one of {E.PHASES}"}]}
        if state.get("phase"):
            run.emit("phase.finished", {"phase": state["phase"], "status": "ok",
                                        "seconds": round(time.time() - state["phase_at"], 2)})
        run.emit("phase.started", {"phase": phase})
        state["phase"], state["phase_at"] = phase, time.time()
        return {"content": [{"type": "text", "text": f"phase: {phase}"}]}

    @tool("validate_manifest", "Validate a draft manifest against the adapter schema.",
          {"manifest": dict})
    async def validate_manifest(args):
        result = M.validate_manifest(args["manifest"])
        if result["valid"]:
            manifest = args["manifest"]
            state["manifest"] = manifest
            run.emit("manifest.drafted", {
                "operations": sorted(manifest.get("operations", {})),
                "port_types": sorted({
                    p["type"]
                    for op in manifest.get("operations", {}).values()
                    for side in ("inputs", "outputs")
                    for p in op.get(side, {}).values()
                }),
                "iteration": state.setdefault("drafts", 0) + 1,
            })
            state["drafts"] += 1
        return _text(result)

    @tool("probe", "Run a command inside a container image to learn how the tool behaves.",
          {"image": str, "command": list, "stage": dict, "timeout_seconds": int})
    async def probe(args):
        result = M.probe(args["image"], args["command"], args.get("stage"),
                         args.get("timeout_seconds") or 120)
        run.emit("probe.ran", {"image": args["image"], "command": args["command"],
                               "exit_code": result.get("exit_code"),
                               "ms": int((result.get("wall_seconds") or 0) * 1000)})
        state.setdefault("probes", []).append(
            {"image": args["image"], "command": args["command"],
             "exit_code": result.get("exit_code")})
        return _text(result)

    @tool("check_conformance", "Grade an adapter directory. Passing is the definition of done.",
          {"adapter_dir": str})
    async def check_conformance(args):
        result = M.check_conformance(args["adapter_dir"])
        run.emit("conformance.result", {
            "passed": result.get("passed", False),
            "checks": result.get("checks", 0),
            "failures": result.get("failures", []),
        })
        state["conformance"] = result
        return _text(result)

    @tool("find_image", "Find a published BioContainers image, newest first.", {"name": str})
    async def find_image(args):
        result = M.find_image(args["name"])
        if result.get("found"):
            # Candidates are recorded by the harness so ambiguous_image can be
            # derived later. The agent is never asked to volunteer them.
            state["image_candidates"] = [result["reference"]] + [
                f"quay.io/biocontainers/{args['name']}:{t}"
                for t in result.get("alternatives", [])
            ]
        return _text(result)

    @tool("resolve_digest", "Resolve an image reference to its immutable digest.",
          {"reference": str})
    async def resolve_digest(args):
        result = M.resolve_digest(args["reference"])
        if result.get("found"):
            state["image_pinned"] = result["pinned"]
            # The tag-shaped reference the agent actually picked. Kept so image
            # ambiguity is judged on the choice rather than on the digest, which
            # is not comparable to a tag.
            state["image_chosen_candidate"] = args["reference"]
        return _text(result)

    @tool("find_description", "Look for an existing nf-core meta.yml for this tool.",
          {"name": str})
    async def find_description(args):
        return _text(M.find_description(args["name"]))

    @tool("list_port_types", "The port-type vocabulary, with a specimen of each.", {})
    async def list_port_types(args):
        return _text(M.list_port_types())

    @tool("list_machine_classes", "Available machine classes.", {})
    async def list_machine_classes(args):
        return _text(M.list_machine_classes())

    @tool("record", "Record a fact for the report: license, version, or a caveat. "
          "Use field='caveat' for anything you could not establish.",
          {"field": str, "value": str, "basis": str, "note": str})
    async def record(args):
        field = args["field"]
        if field == "caveat":
            # Caveats accumulate; facts are keyed. Storing both in one dict meant
            # the second caveat overwrote the first and none were read back at
            # all - the agent volunteered three on the first real run and the
            # report carried none of them.
            state.setdefault("volunteered", []).append(
                {"kind": "agent_note",  # the documented kind; basis is not a kind
                 "detail": args.get("value") or args.get("note", ""),
                 "where": args.get("basis", "")})
        else:
            state.setdefault("recorded", {})[field] = {
                "value": args.get("value"), "basis": args.get("basis", "unknown"),
                "note": args.get("note", ""),
            }
        run.note(f"recorded {field}: {str(args.get('value'))[:90]}")
        return {"content": [{"type": "text", "text": "recorded"}]}

    @tool("propose_type",
          "Use ONLY when no existing port type covers a tool's data and you had to "
          "fall back to Text. Describes the type the vocabulary is missing. This is "
          "a request to a human, not a change you are making.",
          {"name": str, "describes": str, "ports": list, "sample": str,
           "how_to_recognise": str})
    async def propose_type(args):
        proposals = workspace_scratch / "proposals"
        proposals.mkdir(parents=True, exist_ok=True)
        name = "".join(c for c in args["name"] if c.isalnum() or c in "-_") or "unnamed"
        (proposals / f"{name}.md").write_text(
            f"# Proposed port type: {args['name']}\n\n"
            f"{args.get('describes', '')}\n\n"
            f"## Ports that needed it\n{', '.join(args.get('ports', []))}\n\n"
            f"## How to recognise it\n{args.get('how_to_recognise', '')}\n\n"
            f"## Sample\n```\n{args.get('sample', '')[:2000]}\n```\n"
        )
        state.setdefault("proposals", []).append(
            {"name": args["name"], "describes": args.get("describes", ""),
             "ports": args.get("ports", []),
             "how_to_recognise": args.get("how_to_recognise", "")})
        run.note(f"proposed port type {args['name']} for {args.get('ports')}")
        return {"content": [{"type": "text", "text":
                "recorded as a proposal for review; continue using Text for now"}]}

    return [set_phase, validate_manifest, probe, check_conformance, find_image,
            resolve_digest, find_description, list_port_types, list_machine_classes,
            record, propose_type]


def _text(payload) -> dict:
    return {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]}


async def run_agent(name: str, url: str | None, adapter_id: str, root: pathlib.Path,
                    events_path: pathlib.Path, resume_from: dict | None,
                    message: str | None, max_budget: float, keep: bool) -> dict:
    workspace = W.prepare(adapter_id, root)
    if resume_from:
        # Carry forward what the previous run built, so a resume is genuinely a
        # continuation rather than a re-run that happens to start warm.
        for src, dst in ((resume_from["adapter"], workspace.adapter),
                         (resume_from["scratch"], workspace.scratch)):
            if src.exists():
                for item in src.iterdir():
                    target = dst / item.name
                    if item.is_dir():
                        __import__("shutil").copytree(item, target, dirs_exist_ok=True)
                    else:
                        __import__("shutil").copy(item, target)

    sink = E.fanout_sink(E.jsonl_sink(events_path.open("a")), E.jsonl_sink(sys.stderr))
    run = E.Run(kind="agent", subject=url or name, sink=sink)
    state: dict = {"phase": None, "phase_at": time.time()}

    task = pathlib.Path(HERE / "prompt.md").read_text()
    ask = f"Wrap the tool `{name}` as adapter id `{adapter_id}`."
    if url:
        ask += f"\nStart from: {url}"
    ask += (
        f"\n\nYour adapter directory is {workspace.adapter}"
        f"\nYour scratch directory is {workspace.scratch}"
        f"\nCall set_phase as you move through the loop."
        f"\nUse `record` for license and version, with an honest basis."
    )
    if message:
        ask += f"\n\nA reviewer asked for this change:\n{message}"
    if resume_from:
        ask += (f"\n\nYou are resuming a previous run that ended "
                f"'{resume_from['previous_outcome']}'. Its work is already in your "
                f"adapter and scratch directories.")

    options = ClaudeAgentOptions(
        system_prompt=task,
        cwd=str(workspace.staging),
        mcp_servers={"doorway": create_sdk_mcp_server(
            name="doorway", tools=build_toolset(run, state, workspace.scratch))},
        allowed_tools=[
            "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch",
            *[f"mcp__doorway__{t}" for t in
              ("set_phase", "validate_manifest", "probe", "check_conformance",
               "find_image", "resolve_digest", "find_description",
               "list_port_types", "list_machine_classes", "record",
               "propose_type")],
        ],
        # Headless: there is no human to answer a prompt. The containment is the
        # staging cwd plus workspace.verify(), and in production an ephemeral VM.
        # On a workstation this is a deliberate, bounded concession.
        permission_mode="bypassPermissions",
        max_budget_usd=max_budget,
        resume=resume_from.get("sdk_session_id") if resume_from else None,
    )

    async for msg in query(prompt=ask, options=options):
        if isinstance(msg, SystemMessage) and not state.get("sdk_session_id"):
            state["sdk_session_id"] = getattr(msg, "session_id", None) or \
                (msg.data.get("session_id") if hasattr(msg, "data") else None)
        elif isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock) and block.text.strip():
                    run.note(block.text.strip()[:1500])
                elif isinstance(block, ToolUseBlock) and not block.name.startswith("mcp__"):
                    state.setdefault("touched", []).append(
                        json.dumps(block.input, default=str))
                    # Built-in tool use is logged but not narrated; the doorway
                    # tools emit their own richer events.
                    run.emit("log.line", {"stream": "stdout",
                                          "text": f"[{block.name}]"})
        elif isinstance(msg, ResultMessage):
            state["result"] = {"is_error": getattr(msg, "is_error", False),
                               "cost_usd": getattr(msg, "total_cost_usd", None)}

    if state.get("phase"):
        run.emit("phase.finished", {"phase": state["phase"], "status": "ok",
                                    "seconds": round(time.time() - state["phase_at"], 2)})

    return _finish(run, workspace, state, name, url, adapter_id, events_path, keep)


def _finish(run, workspace, state, name, url, adapter_id, events_path, keep) -> dict:
    """Grade independently of whatever the agent believed, then report."""
    with run.phase("publish"):
        # Re-run conformance ourselves. The agent's last check_conformance result
        # is not evidence: it may have edited files afterwards, and its own
        # confidence was never the signal.
        conformance = M.check_conformance(str(workspace.adapter)) \
            if (workspace.adapter / "manifest.json").exists() else {"passed": False,
                                                                    "error": "no manifest"}
        guardrails = workspace.verify()
        # Cross-reference: did the agent actually reference the changed paths?
        # A concurrent human edit in the same worktree trips the git check exactly
        # as an escape would. This cannot be conclusive - Bash can write anywhere
        # without naming a path - but it turns "something changed" into "nothing
        # the agent did mentions this", which a reviewer can act on in seconds.
        # In production the repository is read-only and the question does not arise.
        changed_paths = [
            line[3:].strip()
            for g in guardrails if "repository changed" in g
            for line in g.split(":", 1)[-1].split(";")
        ]
        agent_text = " ".join(state.get("touched", []))
        unattributed = [c for c in changed_paths if c and c not in agent_text]
        if changed_paths and len(unattributed) == len(changed_paths):
            guardrails = [
                g + "  [no agent tool call referenced these paths - most likely "
                    "concurrent work in the same worktree, not a containment breach]"
                if "repository changed" in g else g
                for g in guardrails
            ]
            state["repo_change_unattributed"] = True

        rep = R.Report(run_id=run.run_id, adapter_id=adapter_id,
                       requested={"name": name, "url": url},
                       seconds=round(time.time() - run.started, 1))
        recorded = state.get("recorded", {})
        rep.license = R.stated(**{**{"value": None, "basis": "unknown", "note": ""},
                                  **recorded.get("license", {})})
        rep.version = R.stated(**{**{"value": None, "basis": "unknown", "note": ""},
                                  **recorded.get("version", {})})
        manifest = state.get("manifest")
        if (workspace.adapter / "manifest.json").exists():
            try:
                manifest = json.loads((workspace.adapter / "manifest.json").read_text())
            except json.JSONDecodeError:
                pass
        rep.manifest = manifest
        rep.image = {"reference": (manifest or {}).get("image"),
                     "digest": state.get("image_pinned"),
                     "origin": "built_from_source" if (workspace.adapter / "Dockerfile").exists()
                               else "registry",
                     "candidates": state.get("image_candidates", []),
                     "chosen_candidate": state.get("image_chosen_candidate")}
        rep.source = (manifest or {}).get("source", {})
        rep.conformance = conformance
        rep.guardrails = guardrails
        rep.probes = state.get("probes", [])
        rep.caveats = state.get("volunteered", [])
        rep.proposals = state.get("proposals", [])
        rep.port_types_used = [
            {"operation": op_name, "port": port_name, "type": port["type"],
             "direction": "input" if side == "inputs" else "output"}
            for op_name, op in ((manifest or {}).get("operations") or {}).items()
            for side in ("inputs", "outputs")
            for port_name, port in op.get(side, {}).items()
        ]
        rep.promotable = sorted(str(p.relative_to(workspace.adapter))
                                for p in workspace.adapter.rglob("*") if p.is_file())
        rep.session = {"sdk_session_id": state.get("sdk_session_id"),
                       "resumable": False,  # set true once the archive exists
                       "archive": None,
                       "resume_hint": state.get("resume_hint", "")}

        if guardrails and any("repository changed" in g for g in guardrails):
            # Still rejected: conservative is right when containment is in
            # question, and a reviewer who can see it was unattributed can
            # resume the run in one click rather than paying for a re-run.
            rep.outcome = "rejected"
        elif not conformance.get("passed"):
            rep.outcome = "gave_up"
        elif rep.all_caveats() or guardrails:
            rep.outcome = "needs_review"
        else:
            rep.outcome = "conformant"

        # A durable, listable home per run. The web app enumerates this
        # directory; nothing it needs is inside a tarball.
        run_dir = workspace.root / "tools" / ".runs" / run.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        report_path = rep.write(run_dir / "report.json")
        run.emit("artifact.written", {"path": str(report_path),
                                      "bytes": report_path.stat().st_size})

        # Always archive, never conditionally. resumable was previously derived
        # from the session id while the archive was written only for non-clean
        # outcomes, so a conformant run advertised a resume with nothing behind
        # it. Worse, conformant is the case where revise is the ONLY remaining
        # path: a Text fallback or unknown license already forces needs_review,
        # so a reviewer looking at a clean report who wants an operation renamed
        # had no route at all. The archive is deliberately small; storing one per
        # run is unremarkable.
        archive = RES.archive(workspace, report_path, events_path, run_dir)
        rep.session["resumable"] = True
        rep.session["archive"] = str(archive)
        rep.write(report_path)
        run.note(f"state archived for resume: {archive}")

    run.finish(rep.outcome)
    if keep or rep.outcome != "conformant":
        workspace.keep()
    result = {"outcome": rep.outcome, "report": str(report_path),
              "summary": rep.summary_line(), "archive": str(archive) if archive else None,
              "staging": str(workspace.staging)}
    workspace.cleanup()
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("name", help="the tool to wrap, e.g. mafft")
    ap.add_argument("--url", help="repository or docs URL, when a bare name is not enough")
    ap.add_argument("--adapter-id", help="catalogue id; defaults to the name")
    ap.add_argument("--root", default=str(TOOLS_ROOT.parent), help="repository worktree")
    ap.add_argument("--events", help="JSONL event file; defaults beside the report")
    ap.add_argument("--resume", help="archive from a previous run")
    ap.add_argument("--message", help="a reviewer's requested change, with --resume")
    ap.add_argument("--max-budget-usd", type=float, default=10.0)
    ap.add_argument("--keep", action="store_true", help="retain staging even on success")
    args = ap.parse_args()

    adapter_id = args.adapter_id or args.name.lower().replace("_", "-")
    root = pathlib.Path(args.root).resolve()
    events_path = pathlib.Path(args.events) if args.events else \
        root / "tools" / ".runs" / f"{adapter_id}-{int(time.time())}.jsonl"
    events_path.parent.mkdir(parents=True, exist_ok=True)

    resume_from = RES.restore(pathlib.Path(args.resume)) if args.resume else None

    result = asyncio.run(run_agent(
        args.name, args.url, adapter_id, root, events_path, resume_from,
        args.message, args.max_budget_usd, args.keep,
    ))
    print(json.dumps(result, indent=2))
    return 0 if result["outcome"] in ("conformant", "needs_review") else 1


if __name__ == "__main__":
    sys.exit(main())
