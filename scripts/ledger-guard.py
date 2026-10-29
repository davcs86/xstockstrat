#!/usr/bin/env python3
"""Fail when a branch deletes or alters another feature's docs/roadmap/ledger entry.

Usage: ledger-guard.py --own-slug <slug> [--base origin/main-dev] [--head HEAD] [--fix]
Compares against merge-base(base, head), so a branch that is merely behind base is clean.
Exit 0 = clean (or repaired by --fix), 1 = damage found, 2 = --fix needs base merged in first.
"""

import argparse
import re
import subprocess
import sys

FILES = ["docs/roadmap/ledger/fails.md", "docs/roadmap/ledger/insights.md"]
HEAD_RE = re.compile(r"^### \S+ — (\S+) — ")


def git(*a):
    return subprocess.run(
        ["git", *a], capture_output=True, text=True, check=True
    ).stdout


def show(ref, path):
    try:
        return git("show", f"{ref}:{path}")
    except subprocess.CalledProcessError:
        return ""


def blocks(text):
    """[(slug or None, block_text)] split at '### ' headings; preamble has slug None."""
    out, cur, slug = [], [], None
    for line in text.splitlines(True):
        if line.startswith("### "):
            if cur:
                out.append((slug, "".join(cur)))
            cur, m = [line], HEAD_RE.match(line)
            slug = m.group(1) if m else "?"
        else:
            cur.append(line)
    if cur:
        out.append((slug, "".join(cur)))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--own-slug", required=True)
    ap.add_argument("--base", default="origin/main-dev")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--fix", action="store_true")
    a = ap.parse_args()

    mb = git("merge-base", a.base, a.head).strip()
    if a.fix and mb != git("rev-parse", a.base).strip():
        print(f"ledger-guard: merge {a.base} into {a.head} before --fix")
        return 2
    damage = []
    for path in FILES:
        base_txt, head_txt = show(mb, path), show(a.head, path)
        if not base_txt:
            continue
        head_blocks = {b for _, b in blocks(head_txt)}
        lost = [
            (s, b)
            for s, b in blocks(base_txt)
            if s not in (None, a.own_slug) and b not in head_blocks
        ]
        if not lost:
            continue
        damage.append((path, lost))
        for s, b in lost:
            print(
                f"{path}: entry of '{s}' missing or altered on branch: {b.splitlines()[0]}"
            )
        if a.fix:
            base_set = {b for _, b in blocks(base_txt)}
            own_new = [
                b for s, b in blocks(head_txt) if s == a.own_slug and b not in base_set
            ]
            fixed = base_txt
            for b in own_new:
                fixed = fixed.rstrip("\n") + "\n\n" + b.rstrip("\n") + "\n"
            with open(path, "w") as f:
                f.write(fixed)
            print(
                f"{path}: rebuilt from {a.base} + {len(own_new)} own '{a.own_slug}' entr(y/ies)"
            )

    if not damage:
        print("ledger-guard: clean")
        return 0
    return 0 if a.fix else 1


if __name__ == "__main__":
    sys.exit(main())
