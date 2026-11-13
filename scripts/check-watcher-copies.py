#!/usr/bin/env python3
"""Fail when the per-service copies of a config watcher core or live-limits module differ.

Usage: check-watcher-copies.py [ROOT]
Each group's files must be byte-identical; the exemption is recorded in docs/patterns/dry-guard-rail.md.
Exit 0 = identical, 1 = a copy is missing or differs (one line per problem on stderr).
"""

import hashlib
import os
import sys

COPIES = {
    "go": (
        "services/xstockstrat-trading/internal/config/watchcore.go",
        "services/xstockstrat-portfolio/internal/config/watchcore.go",
        "services/xstockstrat-marketdata/internal/config/watchcore.go",
    ),
    "py": (
        "services/xstockstrat-indicators/app/config/watch_core.py",
        "services/xstockstrat-ingest/app/config/watch_core.py",
        "services/xstockstrat-analysis/app/config/watch_core.py",
        "services/xstockstrat-agent/app/config/watch_core.py",
    ),
    "py-limits": (
        "services/xstockstrat-indicators/app/config/live_limits.py",
        "services/xstockstrat-ingest/app/config/live_limits.py",
        "services/xstockstrat-analysis/app/config/live_limits.py",
    ),
    "node": (
        "services/xstockstrat-ledger/src/services/configWatcher.ts",
        "services/xstockstrat-identity/src/services/configWatcher.ts",
        "services/xstockstrat-notify/src/services/configWatcher.ts",
    ),
}


def problems(root, copies=COPIES):
    out = []
    for group in sorted(copies):
        ref_sum = ref_path = None
        for path in copies[group]:
            full = os.path.join(root, path)
            if not os.path.isfile(full):
                out.append(f"group {group}: missing {path}")
                continue
            with open(full, "rb") as f:
                digest = hashlib.sha256(f.read()).hexdigest()
            if ref_sum is None:
                ref_sum, ref_path = digest, path
            elif digest != ref_sum:
                out.append(f"group {group}: {path} differs from {ref_path}")
    return out


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    root = (
        argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    found = problems(root)
    for problem in found:
        print(f"check-watcher-copies: {problem}", file=sys.stderr)
    if found:
        return 1
    print("check-watcher-copies: all groups byte-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
