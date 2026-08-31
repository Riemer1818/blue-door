#!/usr/bin/env python3
"""Follow an agent run in a terminal.

    watch.py tools/.runs/mafft2.jsonl          follow a live run
    watch.py tools/.runs/mafft2.jsonl --replay  read a finished one

The same events BLU-11 renders in the browser, rendered here instead. That is
the point of the vocabulary being structured rather than a text firehose: a
phase checklist with status and elapsed time falls out of it, and nothing has to
parse prose to know what step a run is on.

It also keeps the CLI and the web console honest with each other. If a run reads
well here and badly there, the difference is in the renderer, not the events.
"""

import argparse
import json
import pathlib
import sys
import time

DIM, BOLD, GREEN, RED, YELLOW, BLUE, RESET = (
    "\033[2m", "\033[1m", "\033[32m", "\033[31m", "\033[33m", "\033[34m", "\033[0m")
PHASES = ["discover", "acquire", "probe", "draft", "fixtures", "verify", "publish"]
MARK = {"ok": f"{GREEN}done{RESET}", "failed": f"{RED}failed{RESET}",
        "skipped": f"{DIM}skipped{RESET}"}


def render(event: dict) -> str | None:
    kind, p, at = event["kind"], event["payload"], event.get("at", 0)
    stamp = f"{DIM}{at:>7.1f}s{RESET}"

    if kind == "run.started":
        limits = p.get("limits") or {}
        clamp = f" {YELLOW}(clamped locally){RESET}" if limits.get("clamped_locally") else ""
        head = f"\n{BOLD}{p.get('kind')} run{RESET}  {p.get('subject')}"
        plan = f"  {DIM}plan: {' -> '.join(PHASES)}{RESET}"
        return f"{head}{clamp}\n{plan}\n"
    if kind == "phase.started":
        return f"{stamp}  {BLUE}{p['phase']}{RESET} {DIM}...{RESET}"
    if kind == "phase.finished":
        return (f"{stamp}  {BLUE}{p['phase']}{RESET} "
                f"{MARK.get(p.get('status'), p.get('status'))} {DIM}{p.get('seconds')}s{RESET}")
    if kind == "probe.ran":
        code = p.get("exit_code")
        colour = GREEN if code == 0 else YELLOW
        cmd = " ".join(p.get("command", []))[:78]
        return f"{stamp}    {DIM}probe{RESET} {colour}exit {code}{RESET}  {cmd}"
    if kind == "manifest.drafted":
        return (f"{stamp}    {DIM}draft #{p.get('iteration')}{RESET} "
                f"ops={','.join(p.get('operations', []))} "
                f"types={','.join(p.get('port_types', []))}")
    if kind == "conformance.result":
        if p.get("passed"):
            return f"{stamp}    {GREEN}conformance passed{RESET} {DIM}{p.get('checks')} checks{RESET}"
        lines = [f"{stamp}    {RED}conformance failed{RESET} "
                 f"{DIM}{len(p.get('failures', []))} of {p.get('checks')}{RESET}"]
        for f in p.get("failures", [])[:4]:
            lines.append(f"           {DIM}{f.get('operation')}: {f.get('detail')}{RESET}")
        return "\n".join(lines)
    if kind == "image.built":
        return f"{stamp}    {DIM}built{RESET} {p.get('reference')} {DIM}{p.get('seconds')}s{RESET}"
    if kind == "artifact.written":
        return f"{stamp}    {DIM}wrote{RESET} {p.get('path')}"
    if kind == "note":
        text = p.get("text", "").strip().replace("\n", " ")
        return f"{stamp}    {DIM}{text[:104]}{RESET}" if text else None
    if kind == "log.truncated":
        return f"{stamp}    {YELLOW}{p.get('dropped')} lines dropped from {p.get('stream')}{RESET}"
    if kind == "run.finished":
        outcome = p.get("outcome")
        colour = {"conformant": GREEN, "needs_review": YELLOW}.get(outcome, RED)
        # Never "done" - every outcome lands at a human, they differ only in how
        # much thought is needed.
        meaning = {"conformant": "ready for review",
                   "needs_review": "needs you - see the caveats",
                   "gave_up": "needs you - read what it could not determine",
                   "rejected": "guardrail trip, not the tool's fault"}.get(outcome, "")
        return (f"\n{colour}{BOLD}{outcome}{RESET} {DIM}after {p.get('seconds')}s{RESET}"
                f"\n{DIM}{meaning}{RESET}")
    return None  # log.line is deliberately quiet here; use --verbose


def follow(path: pathlib.Path, replay: bool, verbose: bool):
    handle = None
    for _ in range(60):
        if path.exists():
            handle = path.open()
            break
        time.sleep(1)
    if handle is None:
        print(f"no such run: {path}", file=sys.stderr)
        return 1

    while True:
        line = handle.readline()
        if not line:
            if replay:
                return 0
            time.sleep(0.3)
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event["kind"] == "log.line" and not verbose:
            continue
        out = render(event)
        if out:
            print(out, flush=True)
        if event["kind"] == "run.finished":
            return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("events", help="path to a run's JSONL event file")
    ap.add_argument("--replay", action="store_true", help="read to the end and stop")
    ap.add_argument("--verbose", action="store_true", help="include log.line events")
    args = ap.parse_args()
    return follow(pathlib.Path(args.events), args.replay, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
