#!/usr/bin/env python3
"""The human gate. Move a reviewed adapter into the catalogue.

    promote.py --list
    promote.py e38f0f9191b6              show the report and what would land
    promote.py e38f0f9191b6 --yes        actually do it

Separate from wrap.py on purpose. An agent run ends at a report; promotion is a
person deciding. Keeping them in one command would make the decision a flag, and
a flag is the kind of thing that acquires a default.

Everything is re-checked here rather than trusted from the report. The report
says what was true when the run ended; between then and now the archive may have
been edited, an image may have moved, or the catalogue may have gained an adapter
with the same id. Conformance and the guardrails are cheap; re-running them is
cheaper than promoting something on a stale claim.
"""

import argparse
import json
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "runner"))

import mcp_server as M  # noqa: E402
import resume as RES  # noqa: E402
import workspace as W  # noqa: E402

GREEN, RED, YELLOW, DIM, BOLD, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[1m", "\033[0m")


def runs_dir(root: pathlib.Path) -> pathlib.Path:
    return root / "tools" / ".runs"


def list_runs(root: pathlib.Path) -> int:
    found = sorted(runs_dir(root).glob("*/report.json"),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    if not found:
        print("no runs")
        return 1
    for path in found:
        report = json.loads(path.read_text())
        outcome = report.get("outcome", "?")
        colour = {"conformant": GREEN, "needs_review": YELLOW}.get(outcome, RED)
        promoted = (root / "tools" / report["adapter_id"]).exists()
        print(f"  {path.parent.name}  {colour}{outcome:<13}{RESET} "
              f"{report['adapter_id']:<12} "
              f"{DIM}{len(report.get('caveats', []))} caveat(s){RESET}"
              f"{'  ' + GREEN + 'in catalogue' + RESET if promoted else ''}")
    return 0


def show(report: dict) -> None:
    print(f"\n{BOLD}{report['adapter_id']}{RESET} {DIM}run {report.get('run_id')}{RESET}")
    print(f"  outcome     {report.get('outcome')}")
    c = report.get("conformance", {})
    mark = f"{GREEN}passed{RESET}" if c.get("passed") else f"{RED}FAILED{RESET}"
    print(f"  conformance {mark} {DIM}{c.get('checks', 0)} checks{RESET}")
    image = report.get("image", {})
    print(f"  image       {image.get('digest') or image.get('reference')} "
          f"{DIM}({image.get('origin')}){RESET}")
    for field in ("license", "version"):
        stated = report.get(field, {})
        basis = stated.get("basis")
        colour = GREEN if basis == "found" else YELLOW
        print(f"  {field:<11} {stated.get('value')} {colour}({basis}){RESET}")

    for problem in report.get("guardrails", []):
        print(f"\n  {RED}guardrail{RESET} {problem}")

    caveats = report.get("caveats", [])
    print(f"\n  {BOLD}caveats{RESET} {DIM}({len(caveats)}){RESET}"
          if caveats else f"\n  {GREEN}nothing unresolved{RESET}")
    for caveat in caveats:
        where = f" {DIM}@ {caveat['where']}{RESET}" if caveat.get("where") else ""
        print(f"    {YELLOW}{caveat['kind']}{RESET}{where}")
        print(f"      {DIM}{caveat['detail'][:200]}{RESET}")

    for proposal in report.get("proposals", []):
        print(f"\n  {BOLD}proposed port type{RESET} {proposal['name']} "
              f"{DIM}for {', '.join(proposal.get('ports', []))}{RESET}")
        print(f"    {DIM}{proposal.get('describes', '')[:200]}{RESET}")
        print(f"    {DIM}fixing this means editing porttypes.json, not this adapter{RESET}")

    print(f"\n  {BOLD}would land in tools/{report['adapter_id']}/{RESET}")
    for path in report.get("promotable", []):
        print(f"    {path}")


def promote(run_id: str, root: pathlib.Path, confirmed: bool) -> int:
    run_path = runs_dir(root) / run_id
    report = json.loads((run_path / "report.json").read_text())
    show(report)

    archives = list(run_path.glob("*.tar.gz"))
    if not archives:
        print(f"\n{RED}no archive for this run; nothing to promote from{RESET}")
        return 1

    state = RES.restore(archives[0])
    adapter_id = report["adapter_id"]

    print(f"\n{BOLD}re-checking{RESET} {DIM}(the report says what was true when the "
          f"run ended){RESET}")
    conformance = M.check_conformance(str(state["adapter"]))
    ok = conformance.get("passed")
    print(f"  conformance {GREEN + 'passed' + RESET if ok else RED + 'FAILED' + RESET} "
          f"{DIM}{conformance.get('checks', 0)} checks{RESET}")
    for failure in conformance.get("failures", [])[:5]:
        print(f"    {RED}{failure.get('operation')}{RESET}: {failure.get('detail')}")

    destination = root / "tools" / adapter_id
    if destination.exists():
        print(f"  {RED}tools/{adapter_id} already exists{RESET} "
              f"{DIM}- promoting over an adapter is an upgrade, not this{RESET}")
        return 1
    if not ok:
        print(f"\n{RED}refusing to promote: conformance does not pass{RESET}")
        return 1

    if not confirmed:
        print(f"\n{DIM}re-run with --yes to promote{RESET}")
        return 0

    shutil.copytree(state["adapter"], destination)
    print(f"\n{GREEN}promoted{RESET} -> tools/{adapter_id}")
    print(f"{DIM}review the diff and commit it; nothing here touches git{RESET}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_id", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--yes", action="store_true", help="actually promote")
    ap.add_argument("--root", default=str(HERE.parent.parent))
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()
    if args.list or not args.run_id:
        return list_runs(root)
    return promote(args.run_id, root, args.yes)


if __name__ == "__main__":
    sys.exit(main())
