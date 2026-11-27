#!/usr/bin/env python3
"""Refuse a migration change that breaks forward-only NNN ordering against a base branch.

Usage: check-migration-order.py <base_ref> [--forbid-new]
Every *.up.sql added since <base_ref> must carry a version above the tip of <base_ref>'s maximum for its
service and unique among the added files; a deleted or modified base up-file is refused (F-01). With
--forbid-new, any added up-file is refused.
Exit 0 = ok, 1 = refused (stderr names each violation), 2 = usage.
"""

import os
import re
import subprocess
import sys

VERSION = re.compile(r"^(\d+)_.*\.up\.sql$")
UP_FILES = "services/*/migrations/*.up.sql"
USAGE = "usage: check-migration-order.py <base_ref> [--forbid-new]"


def git(*args, check=True):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def version(path):
    """The (digits, int) version of an up-file name, or None."""
    m = VERSION.match(os.path.basename(path))
    return (m.group(1), int(m.group(1))) if m else None


def base_maximum(base, mig_dir):
    """The highest (digits, int) up-file version in mig_dir on base, or None when there is none."""
    names = git(
        "ls-tree", "--name-only", base, f"{mig_dir}/", check=False
    ).stdout.split()
    versions = [v for v in map(version, names) if v]
    return max(versions, key=lambda v: v[1]) if versions else None


def refuse(text):
    print(f"order-gate: {text}", file=sys.stderr)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if (
        not 1 <= len(argv) <= 2
        or argv[0].startswith("-")
        or (len(argv) == 2 and argv[1] != "--forbid-new")
    ):
        print(USAGE, file=sys.stderr)
        return 2
    base, forbid_new = argv[0], len(argv) == 2
    diff = git(
        "diff", "--name-status", "--no-renames", "--diff-filter=ADM", f"{base}...HEAD", "--", UP_FILES
    )  # fmt: skip
    status = 0
    added = []
    for line in diff.stdout.splitlines():
        kind, path = line.split("\t", 1)
        if kind in ("D", "M"):
            verb = "deleted" if kind == "D" else "modified"
            refuse(
                f"{path}: an applied migration was {verb} (F-01); add a new numbered migration instead"
            )
            status = 1
        else:
            added.append(path)
    seen = {}
    maxima = {}
    for path in added:
        if forbid_new:
            refuse(
                f"{path}: a pull request into main may not add a migration; ship it through main-dev and a promotion"
            )
            status = 1
        v = version(path)
        if v is None:
            refuse(f"{path}: cannot parse a migration version from the file name")
            status = 1
            continue
        mig_dir = os.path.dirname(path)
        svc = mig_dir.split("/")[1]
        if mig_dir not in maxima:
            maxima[mig_dir] = base_maximum(base, mig_dir)
        mx = maxima[mig_dir]
        if mx is not None and v[1] <= mx[1]:
            refuse(
                f"{path}: version {v[0]} is not above {base}'s maximum {mx[0]} for {svc}; "
                f"renumber it to {mx[1] + 1:0{len(mx[0])}d} or higher before merge"
            )
            status = 1
        key = (mig_dir, v[1])
        if key in seen:
            refuse(f"{svc}: {seen[key]} and {path} share version {v[0]}")
            status = 1
        else:
            seen[key] = path
    if status == 0:
        print(
            f"order-gate: ok — {len(added)} new migration(s), each above the base maximum"
        )
    return status


if __name__ == "__main__":
    sys.exit(main())
