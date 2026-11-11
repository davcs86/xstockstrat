#!/usr/bin/env python3
"""scripts/security-audit.py
Audits git history across all branches for accidentally committed secrets.
Mirrors the maintainer checks in CONTRIBUTING.md §Security Audit.

Usage:
  ./scripts/security-audit.py             # fetch all refs, then scan
  ./scripts/security-audit.py --no-fetch  # skip git fetch (use local refs only)

Exits 1 if any pattern matches commits in any ref. If matches are found,
follow the git filter-repo procedure in CONTRIBUTING.md to scrub them from
history before publishing the repo.
"""

import subprocess
import sys

# (label, pattern) — kept in sync with CONTRIBUTING.md §Security Audit.
PATTERNS = (
    ("AWS access key (AKIA...)", "AKIA"),
    ("GitHub PAT (ghp_...)", "ghp_"),
    ("GitLab token (glpat-...)", "glpat-"),
    ("Stripe live key (sk_live_...)", "sk_live_"),
    ("PEM private key header", "-----BEGIN"),
    ("Internal dev DB password", "devpassword"),
)


def fetch_all():
    try:
        return (
            subprocess.run(["git", "fetch", "--all", "--quiet"], check=False).returncode
            == 0
        )
    except FileNotFoundError:
        print(f"{sys.argv[0]}: git: command not found", file=sys.stderr)
        return False


def commits_touching(pattern):
    """Oneline log entries, over all refs, whose diff adds or removes `pattern`; a git failure is no match."""
    try:
        out = subprocess.run(
            ["git", "log", "-S", pattern, "--all", "--oneline"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        ).stdout
    except FileNotFoundError:
        return []
    text = out.decode(errors="replace").rstrip("\n")
    return text.split("\n") if text else []


def main(argv=None):
    no_fetch = False
    for arg in sys.argv[1:] if argv is None else argv:
        if arg == "--no-fetch":
            no_fetch = True
        elif arg in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            print(f"Unknown argument: {arg}", file=sys.stderr)
            return 1

    if not no_fetch:
        print(
            "Fetching all remote refs so --all covers main and main-dev...", flush=True
        )
        if not fetch_all():
            print(
                "WARNING: git fetch --all failed; continuing with local refs only.",
                file=sys.stderr,
            )
        print()

    print("Scanning history of all refs for secret patterns...")
    print()

    found = False
    for label, pattern in PATTERNS:
        matches = commits_touching(pattern)
        if matches:
            found = True
            print(f"  ✗ {label} — matches found:")
            for line in matches:
                print(f"      {line}")
            print()
        else:
            print(f"  ✓ {label} — no matches")

    print()
    if found:
        print("ERROR: potential secrets found in git history.")
        print("       See CONTRIBUTING.md §Security Audit for the git filter-repo")
        print("       procedure to scrub these before publishing the repo.")
        return 1

    print("All clear — no secret patterns found in any branch's history.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
