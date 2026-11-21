#!/usr/bin/env python3
"""Reserve the next feature NNN on the remote cursor ref and print it.

Usage: sdd-allocate-feature-number.py <kebab-case-slug>
Exit: 1 usage, 2 unparseable cursor tip, 3 cannot reserve.
Never fall back to a local max+1 on failure: it reintroduces the cross-session race.
"""

import os
import random
import re
import subprocess
import sys
import time

REMOTE = os.environ.get("SDD_CURSOR_REMOTE") or "origin"
CURSOR_REF = os.environ.get("SDD_CURSOR_REF") or "sdd/feature-cursor"
TRUNK = os.environ.get("SDD_CURSOR_TRUNK") or "main-dev"
FEATURES_DIR = os.environ.get("SDD_FEATURES_DIR") or "docs/roadmap/features"
MAX_TRIES = int(os.environ.get("SDD_CURSOR_MAX_TRIES") or 8)

SLUG = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")
NNN_NAME = re.compile(r"([0-9]{3})-")
CURSOR_SUBJECT = re.compile(r"sdd-cursor: ([0-9]{3,}) ")
# A lost compare-and-swap, as git versions 2.43 to 2.56 word it; anything else is a refusal.
LOST_RACE = re.compile(
    r"\[rejected\].*(fetch first|non-fast-forward)|cannot lock ref|failed to update ref|incorrect old value",
    re.DOTALL,
)
# git's messages are matched as text, so they must not be localised.
ENV = {**os.environ, "LC_ALL": "C"}


class Die(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def git(*args):
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, env=ENV, check=False
    )


def max_nnn(names):
    """Highest NNN among 'NNN-*' names; 0 when none."""
    return max((int(m.group(1)) for m in map(NNN_NAME.match, names) if m), default=0)


def tree_max(treeish):
    """Highest NNN under FEATURES_DIR at <treeish>; 0 when the path is absent."""
    return max_nnn(
        git("ls-tree", "--name-only", f"{treeish}:{FEATURES_DIR}").stdout.splitlines()
    )


def local_max():
    try:
        return max_nnn(os.listdir(FEATURES_DIR))
    except FileNotFoundError:
        return 0


def bootstrap_floor():
    """Highest NNN on ANY remote branch; used only while no cursor exists (one-time seed)."""
    if git(
        "fetch", "--quiet", REMOTE, f"+refs/heads/*:refs/remotes/{REMOTE}/*"
    ).returncode:
        raise Die(3, f"cannot fetch {REMOTE}; refusing to allocate from local state")
    refs = git(
        "for-each-ref", "--format=%(refname)", f"refs/remotes/{REMOTE}"
    ).stdout.split()
    return max((tree_max(ref) for ref in refs), default=0)


def default_identity():
    for key, value in (("name", "sdd-allocator"), ("email", "sdd-allocator@localhost")):
        if not git("config", f"user.{key}").stdout.strip():
            ENV[f"GIT_AUTHOR_{key.upper()}"] = ENV[f"GIT_COMMITTER_{key.upper()}"] = (
                value
            )


def allocate(slug):
    default_identity()
    empty_tree = git("hash-object", "-t", "tree", os.devnull).stdout.strip()
    for _ in range(MAX_TRIES):
        listing = git("ls-remote", REMOTE, f"refs/heads/{CURSOR_REF}")
        if listing.returncode:
            raise Die(
                3, f"cannot reach {REMOTE}; refusing to allocate from local state"
            )
        tip = None
        if listing.stdout.strip():
            if git("fetch", "--quiet", REMOTE, f"refs/heads/{CURSOR_REF}").returncode:
                raise Die(3, f"cannot fetch {REMOTE}/{CURSOR_REF}")
            tip = git("rev-parse", "FETCH_HEAD").stdout.strip()
            subject = git("log", "-1", "--format=%s", tip).stdout.strip()
            m = CURSOR_SUBJECT.match(subject)
            if not m:
                raise Die(2, f"cursor tip {tip} has an unparseable message: {subject}")
            if git("fetch", "--quiet", REMOTE, TRUNK).returncode:
                raise Die(3, f"cannot fetch {REMOTE}/{TRUNK}")
            floor = max(int(m.group(1)), tree_max("FETCH_HEAD"))
        else:
            floor = bootstrap_floor()
        nnn = f"{max(floor, local_max()) + 1:03d}"

        parent = ["-p", tip] if tip else []
        commit = git(
            "commit-tree", empty_tree, *parent, "-m", f"sdd-cursor: {nnn} {slug}"
        ).stdout.strip()
        push = git("push", REMOTE, f"{commit}:refs/heads/{CURSOR_REF}")
        if push.returncode == 0:
            return nnn
        out = push.stdout + push.stderr
        if not LOST_RACE.search(out):
            tail = "\n".join(out.splitlines()[-5:])
            raise Die(
                3, f"push to {REMOTE}/{CURSOR_REF} refused; not allocating: {tail}"
            )
        time.sleep(random.randrange(50) / 100)
    raise Die(3, f"lost the cursor race {MAX_TRIES} times; re-run")


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    try:
        if not argv or not SLUG.fullmatch(argv[0]):
            raise Die(1, "usage: sdd-allocate-feature-number.py <kebab-case-slug>")
        os.chdir(git("rev-parse", "--show-toplevel").stdout.strip())
        print(allocate(argv[0]))
    except Die as e:
        print(f"sdd-allocate-feature-number: {e}", file=sys.stderr)
        return e.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
