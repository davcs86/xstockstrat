#!/usr/bin/env python3
"""Refuse a contract migration whose expand migration has not shipped.

Usage: check-migration-contract.py <base_ref>
For every migration *.up.sql added since <base_ref> that declares `-- contract-of: <path>` in its first
five lines, the named expand migration must be on origin/main and must not be added by this same diff.
Exit 0 = ok, 1 = a contract is refused (stderr names the file), 2 = usage.
"""

import re
import subprocess
import sys

CONTRACT_OF = re.compile(r"^-- contract-of:\s*(.*)")
HEADER_LINES = 5


def git(*args, check=True):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def contract_target(path):
    """The expand migration a file contracts, or None."""
    with open(path, encoding="utf-8") as f:
        for _, line in zip(range(HEADER_LINES), f):
            m = CONTRACT_OF.match(line)
            if m:
                return "".join(m.group(1).split()) or None
    return None


def on_origin_main(path):
    return git("cat-file", "-e", f"origin/main:{path}", check=False).returncode == 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: check-migration-contract.py <base_ref>", file=sys.stderr)
        return 2
    diff = git(
        "diff", "--name-only", "--diff-filter=A", f"{argv[0]}...HEAD", "--", "services/*/migrations/*.up.sql"
    )  # fmt: skip
    added = diff.stdout.split()
    status = 0
    for path in added:
        target = contract_target(path)
        if target is None:
            continue
        if target in added:
            print(
                f"contract-gate: {path} contracts {target}, which is added in this same change "
                "(ship the expand first)",
                file=sys.stderr,
            )
            status = 1
        elif not on_origin_main(target):
            print(
                f"contract-gate: {path} contracts {target}, which is not on origin/main",
                file=sys.stderr,
            )
            status = 1
        else:
            print(f"contract-gate: ok — {path} contracts {target} (on origin/main)")
    return status


if __name__ == "__main__":
    sys.exit(main())
