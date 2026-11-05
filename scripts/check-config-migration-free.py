#!/usr/bin/env python3
"""Pre-merge check: the config migration numbers a branch claims are still free.

Usage: check-config-migration-free.py --ours 037_portfolio_signal_prune_interval [--ours ...]
       [--base origin/main-dev] [--migrations-dir services/xstockstrat-config/migrations] [--no-fetch]
golang-migrate has no out-of-order guard: a lower number merged after a higher one is applied is
skipped silently. Exit 0 = free, 1 = taken (list printed), 2 = git failed (fail closed).
Read-only: `git fetch --prune`, `git ls-tree`, `git for-each-ref`.
"""

import argparse
import re
import subprocess
import sys
import uuid
from pathlib import Path

DEFAULT_DIR = "services/xstockstrat-config/migrations"
MIGRATION = re.compile(r"^(\d{3})_.+\.(up|down)\.sql$")


def log(run_id: str, msg: str) -> None:
    print(f"[run_id={run_id}] {msg}", flush=True)


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def ls_migrations(ref: str, directory: str) -> list[str]:
    out = git("ls-tree", "--name-only", ref, directory.rstrip("/") + "/")
    return sorted(
        p.rsplit("/", 1)[-1]
        for p in out.split("\n")
        if MIGRATION.match(p.rsplit("/", 1)[-1])
    )


def number(name: str) -> int:
    return int(name[:3])


def evaluate(
    ours: list[str], on_base: list[str], on_refs: dict[str, list[str]], local: list[str]
):
    """Pure verdict: (problems, notes). `ours` are migration base names, e.g. 037_x (no suffix)."""
    problems: list[str] = []
    notes: list[str] = []
    ours_files = {f"{o}.{d}.sql" for o in ours for d in ("up", "down")}
    for f in sorted(ours_files - set(local)):
        problems.append(f"missing from this branch: {f}")
    lowest = min(number(o) for o in ours)
    taken = {number(o) for o in ours}
    for f in on_base:
        if f not in ours_files and number(f) >= lowest:
            problems.append(f"origin base already has {f} (>= {lowest:03d})")
    for ref, files in sorted(on_refs.items()):
        for f in files:
            if f not in ours_files and number(f) in taken:
                problems.append(
                    f"{ref} carries {f} (number {number(f):03d} is claimed here)"
                )
    top = max((number(f) for f in on_base), default=0)
    notes.append(
        f"origin base tops out at {top:03d}; claimed: {', '.join(f'{n:03d}' for n in sorted(taken))}"
    )
    return problems, notes


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="scripts/check-config-migration-free.py", description=__doc__
    )
    ap.add_argument(
        "--ours",
        action="append",
        required=True,
        metavar="NNN_name",
        help="a migration this branch adds, without .up/.down.sql (repeatable)",
    )
    ap.add_argument("--base", default="origin/main-dev")
    ap.add_argument("--migrations-dir", default=DEFAULT_DIR)
    ap.add_argument(
        "--no-fetch", action="store_true", help="use the refs already fetched"
    )
    args = ap.parse_args(argv)
    run_id = str(uuid.uuid4())
    for o in args.ours:
        if not re.fullmatch(r"\d{3}_\w+", o):
            ap.error(
                f"--ours {o!r}: expected NNN_name, e.g. 037_portfolio_signal_prune_interval"
            )
    try:
        if not args.no_fetch:
            git("fetch", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*")
        remote = args.base.split("/", 1)[0] + "/"
        refs = [
            r
            for r in git(
                "for-each-ref", "--format=%(refname:short)", f"refs/remotes/{remote}"
            ).split()
            if r != args.base and not r.endswith("/HEAD")
        ]
        on_base = ls_migrations(args.base, args.migrations_dir)
    except subprocess.CalledProcessError as exc:
        log(run_id, f"git failed (failing closed): {exc.stderr.strip() or exc}")
        return 2
    on_refs = {}
    for ref in refs:
        try:
            on_refs[ref] = ls_migrations(ref, args.migrations_dir)
        except subprocess.CalledProcessError:
            continue  # a ref without the directory cannot hold a colliding file
    local_dir = Path(args.migrations_dir)
    local = (
        sorted(p.name for p in local_dir.glob("*.sql")) if local_dir.is_dir() else []
    )
    problems, notes = evaluate(args.ours, on_base, on_refs, local)
    log(run_id, f"checked {len(on_refs)} other refs against {args.base}")
    for n in notes:
        log(run_id, f"note: {n}")
    for p in problems:
        log(run_id, f"FAIL: {p}")
    if not problems:
        log(
            run_id,
            "PASS: "
            + ", ".join(sorted(f"{number(o):03d}" for o in args.ours))
            + " free",
        )
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
