#!/usr/bin/env python3
"""Fail when a shell script exists that scripts/shell-allowlist.txt does not permit.

Usage: check-shell-freeze.py [--base <ref>]
Each allowlist line is '<path> <r0|legacy>'. r0 = copied into a runtime image, so it must be named on a
Dockerfile COPY line. legacy = awaiting a Python port; with --base, no legacy entry may be added.
Exit 0 = clean, 1 = violations (one per line on stdout).
"""

import argparse
import os
import re
import subprocess
import sys

ALLOWLIST = "scripts/shell-allowlist.txt"
TAGS = ("r0", "legacy")
DOCKERFILE = re.compile(r"(^|/)Dockerfile[^/]*$")
DOC = "docs/patterns/script-tooling.md"


def git(*args):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def parse(text):
    """({path: tag}, [problem]) from allowlist text; '#' starts a comment."""
    entries, problems = {}, []
    for n, raw in enumerate(text.splitlines(), 1):
        fields = raw.split("#", 1)[0].split()
        if not fields:
            continue
        if len(fields) != 2 or fields[1] not in TAGS:
            problems.append(f"{ALLOWLIST}:{n}: expected '<path> <{'|'.join(TAGS)}>'")
        elif fields[0] in entries:
            problems.append(f"{ALLOWLIST}:{n}: {fields[0]} is listed twice")
        else:
            entries[fields[0]] = fields[1]
    return entries, problems


def copied_names(dockerfiles):
    """Basenames named on COPY lines of the given {path: text} Dockerfiles."""
    names = set()
    for text in dockerfiles.values():
        for line in text.splitlines():
            if line.strip().upper().startswith("COPY "):
                names.update(os.path.basename(tok) for tok in line.split()[1:])
    return names


def violations(shell_files, entries, copied, base_entries=None):
    out = []
    for path in sorted(set(shell_files) - set(entries)):
        out.append(
            f"{path}: new shell script. Write it in Python (see {DOC}); only a script copied into "
            f"a runtime image may be shell, listed as r0 in {ALLOWLIST}"
        )
    for path in sorted(set(entries) - set(shell_files)):
        out.append(f"{ALLOWLIST}: {path} no longer exists; remove its line")
    for path, tag in sorted(entries.items()):
        if tag == "r0" and os.path.basename(path) not in copied:
            out.append(f"{path}: tagged r0 but no Dockerfile COPY line names it")
        if tag == "legacy" and base_entries is not None and path not in base_entries:
            out.append(
                f"{path}: legacy entries are frozen; a new script must be Python or r0"
            )
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--base", help="ref whose allowlist the legacy set is frozen to")
    args = ap.parse_args(argv)

    os.chdir(git("rev-parse", "--show-toplevel").strip())
    tracked = git("ls-files").splitlines()
    with open(ALLOWLIST) as f:
        entries, problems = parse(f.read())
    base_entries = None
    if args.base:
        git("rev-parse", "--verify", "--quiet", f"{args.base}^{{commit}}")
        shown = subprocess.run(
            ["git", "show", f"{args.base}:{ALLOWLIST}"],
            capture_output=True,
            text=True,
            check=False,
        )
        # A base without the allowlist predates the freeze, so there is nothing to ratchet against.
        if shown.returncode == 0:
            base_entries, _ = parse(shown.stdout)
    dockerfiles = {}
    for path in tracked:
        if DOCKERFILE.search(path) and os.path.isfile(path):
            with open(path) as f:
                dockerfiles[path] = f.read()
    shell_files = [p for p in tracked if p.endswith(".sh") and os.path.isfile(p)]
    problems += violations(
        shell_files, entries, copied_names(dockerfiles), base_entries
    )
    for problem in problems:
        print(problem)
    if not problems:
        print(f"check-shell-freeze: clean ({len(entries)} allowlisted)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
