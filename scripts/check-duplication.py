#!/usr/bin/env python3
"""Copy-paste / clone guard rail: the structural half of the DRY guard rail (docs/patterns/dry-guard-rail.md).

Wraps jscpd, which tokenizes TS/JS, Go, Python, etc. and flags duplicated blocks.

Usage:
  check-duplication.py [PATH ...]
      Scan PATH(s) (default: services packages) and fail on any duplication above the
      .jscpd.json threshold. Used by the pre-commit hook for the UI.
  DUP_REPORT_ONLY=1 check-duplication.py [PATH ...]
      Same scan, but always exit 0: the report is an advisory warning. Used for the
      not-yet-enforced areas (Go / Python / Node) during rollout.

Exit 0 = no duplication above the threshold, or report-only mode; otherwise jscpd's exit status.
"""

import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def jscpd_command():
    # jscpd is a root devDependency; prefer the workspace binary, fall back to npx.
    try:
        probe = subprocess.run(
            ["pnpm", "exec", "jscpd", "--version"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if probe.returncode == 0:
            return ["pnpm", "exec", "jscpd"]
    except FileNotFoundError:
        pass
    return ["npx", "--yes", "jscpd"]


def run_jscpd(args):
    cmd = jscpd_command() + args
    try:
        code = subprocess.run(cmd, check=False).returncode
    except FileNotFoundError:
        print(f"{sys.argv[0]}: {cmd[0]}: command not found", file=sys.stderr)
        return 127
    return code if code >= 0 else 128 - code


def main(argv=None):
    paths = (sys.argv[1:] if argv is None else argv) or ["services", "packages"]
    os.chdir(REPO_ROOT)
    report_only = os.environ.get("DUP_REPORT_ONLY", "0") == "1"
    # Enforced mode fails on ANY clone (--threshold 0). Report-only mode just prints the report.
    threshold = [] if report_only else ["--threshold", "0"]

    print(f"Scanning for code duplication (jscpd) in: {' '.join(paths)}", flush=True)
    status = run_jscpd(
        ["--config", os.path.join(REPO_ROOT, ".jscpd.json"), *threshold, *paths]
    )

    # Without --threshold jscpd always exits 0, so "clean" and "found clones" look the same: never block.
    if report_only:
        print(
            "Report-only mode (non-blocking) — review the jscpd report above for any duplication."
        )
        return 0
    if status == 0:
        print("OK - no duplication above threshold.")
        return 0
    print(
        "FAILED - duplication above threshold. Extract the repeated code into a shared module,"
    )
    print("         or run with DUP_REPORT_ONLY=1 to treat it as advisory.")
    return status


if __name__ == "__main__":
    sys.exit(main())
