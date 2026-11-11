"""Behavioural tests for scripts/sdd-allocate-feature-number.py; a local bare repo is `origin`, no network."""

import os
import shutil
import stat
import subprocess
import sys

import pytest
from conftest import SCRIPTS_DIR, load_script

ALLOC = str(SCRIPTS_DIR / "sdd-allocate-feature-number.py")
FEATURES = "docs/roadmap/features"
CURSOR = "sdd/feature-cursor"
IDENTITY = {
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@example.invalid",
}
ENV = {k: v for k, v in os.environ.items() if not k.startswith("SDD_")} | IDENTITY


def git(cwd, *args, check=True):
    done = subprocess.run(
        ["git", *args], cwd=cwd, env=ENV, capture_output=True, text=True, check=check
    )
    return done.stdout.strip()


def add_dirs(clone, *names):
    for name in names:
        (clone / FEATURES / name).mkdir(parents=True)
        (clone / FEATURES / name / "status.md").touch()
    git(clone, "add", "-A")
    git(clone, "commit", "-q", "-m", f"add {' '.join(names)}")


def alloc(clone, slug, **env):
    return subprocess.run(
        [sys.executable, ALLOC, slug],
        check=False,
        cwd=clone,
        env=ENV | env,
        capture_output=True,
        text=True,
    )


class World:
    def __init__(self, root):
        self.root = root
        self.origin = root / "origin.git"
        git(root, "init", "-q", "--bare", str(self.origin))
        git(self.origin, "symbolic-ref", "HEAD", "refs/heads/main-dev")
        self.seed = root / "seed"
        self.seed.mkdir()
        git(self.seed, "init", "-q")
        git(self.seed, "checkout", "-q", "-b", "main-dev")
        add_dirs(self.seed, "001-a", "002-b", "003-c")
        git(self.seed, "remote", "add", "origin", str(self.origin))
        git(self.seed, "push", "-q", "origin", "main-dev")
        git(self.seed, "checkout", "-q", "-b", "feature/x")
        add_dirs(self.seed, "007-unmerged-sibling")
        git(self.seed, "push", "-q", "origin", "feature/x")
        git(self.seed, "checkout", "-q", "main-dev")

    def clone(self, name):
        git(self.root, "clone", "-q", str(self.origin), name)
        return self.root / name

    def cursor_subject(self):
        return git(self.origin, "log", "-1", "--format=%s", f"refs/heads/{CURSOR}")

    def cursor_tip(self):
        return git(
            self.origin,
            "rev-parse",
            "-q",
            "--verify",
            f"refs/heads/{CURSOR}",
            check=False,
        )


@pytest.fixture
def world(tmp_path):
    return World(tmp_path)


def test_bootstrap_floor_is_the_highest_number_on_any_origin_branch(world):
    got = alloc(world.clone("c1"), "alpha")
    assert (got.returncode, got.stdout) == (0, "008\n"), got.stderr
    assert world.cursor_subject() == "sdd-cursor: 008 alpha"


def test_a_second_clone_advances_the_same_cursor(world):
    alloc(world.clone("c1"), "alpha")
    got = alloc(world.clone("c2"), "beta")
    assert (got.returncode, got.stdout) == (0, "009\n"), got.stderr
    assert git(world.origin, "rev-list", "--count", f"refs/heads/{CURSOR}") == "2"


def test_trunk_floor_wins_over_a_lower_cursor(world):
    c1 = world.clone("c1")
    alloc(c1, "alpha")
    add_dirs(world.seed, "020-manual")
    git(world.seed, "push", "-q", "origin", "main-dev")
    assert alloc(c1, "gamma").stdout == "021\n"


def test_local_tree_floor_wins_too(world):
    c1 = world.clone("c1")
    alloc(c1, "alpha")
    (c1 / FEATURES / "030-local-only").mkdir()
    assert alloc(c1, "delta").stdout == "031\n"


def test_concurrent_allocators_get_distinct_consecutive_numbers(world):
    alloc(world.clone("c0"), "alpha")
    clones = [world.clone(f"p{i}") for i in range(5)]
    procs = [
        subprocess.Popen(
            [sys.executable, ALLOC, f"par-{i}"],
            cwd=clone,
            env=ENV,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for i, clone in enumerate(clones)
    ]
    results = [(p.communicate(), p.returncode) for p in procs]
    assert [rc for _, rc in results] == [0] * 5, [err for (_, err), _ in results]
    assert sorted(out.strip() for (out, _), _ in results) == [
        "009",
        "010",
        "011",
        "012",
        "013",
    ]


@pytest.mark.parametrize("slug", ["Bad Slug", "trailing-", "UPPER", ""])
def test_a_non_kebab_slug_is_rejected_before_touching_origin(world, slug):
    c1 = world.clone("c1")
    got = alloc(c1, slug)
    assert got.returncode == 1 and got.stdout == ""
    assert "usage:" in got.stderr
    assert world.cursor_tip() == ""


def test_unreachable_remote_fails_closed(world):
    got = alloc(world.clone("c1"), "eps", SDD_CURSOR_REMOTE="nonexistent-remote")
    assert (got.returncode, got.stdout) == (3, "")
    assert "refusing to allocate from local state" in got.stderr


def test_a_refused_push_fails_closed_and_leaves_the_cursor(world):
    c1 = world.clone("c1")
    alloc(c1, "alpha")
    hook = world.origin / "hooks" / "pre-receive"
    hook.parent.mkdir(exist_ok=True)
    hook.write_text(
        '#!/bin/sh\nwhile read old new ref; do case "$ref" in refs/heads/sdd/*) echo denied >&2; exit 1;; esac; done\n'
    )
    hook.chmod(hook.stat().st_mode | stat.S_IXUSR)
    before = world.cursor_tip()
    got = alloc(c1, "zeta")
    assert (got.returncode, got.stdout) == (3, "")
    assert "refused; not allocating" in got.stderr
    assert world.cursor_tip() == before


def test_a_lost_ref_lock_race_is_retried(world, tmp_path):
    c1 = world.clone("c1")
    alloc(c1, "alpha")
    shim = tmp_path / "shim"
    shim.mkdir()
    fired = tmp_path / "shim-fired"
    real_git = shutil.which("git")
    (shim / "git").write_text(
        "#!/bin/sh\n"
        f'if [ "$1" = push ] && [ ! -e "{fired}" ]; then\n'
        f'  : >"{fired}"\n'
        f"  echo \"remote: error: cannot lock ref 'refs/heads/{CURSOR}': is at 0a1b but expected 2c3d\" >&2\n"
        f'  echo " ! [remote rejected] 8b15ddc -> {CURSOR} (incorrect old value provided)" >&2\n'
        "  exit 1\n"
        "fi\n"
        f'exec "{real_git}" "$@"\n'
    )
    (shim / "git").chmod(0o755)
    before = world.cursor_tip()
    got = alloc(c1, "theta", PATH=f"{shim}{os.pathsep}{ENV['PATH']}")
    assert fired.exists()
    assert (got.returncode, got.stdout) == (0, "009\n"), got.stderr
    assert world.cursor_tip() != before


def test_an_unparseable_cursor_tip_fails_closed(world):
    c1 = world.clone("c1")
    alloc(c1, "alpha")
    empty_tree = git(world.origin, "hash-object", "-t", "tree", os.devnull)
    junk = git(
        world.origin, "commit-tree", empty_tree, "-p", world.cursor_tip(), "-m", "hello"
    )
    git(world.origin, "update-ref", f"refs/heads/{CURSOR}", junk)
    got = alloc(c1, "eta")
    assert (got.returncode, got.stdout) == (2, "")
    assert "unparseable message: hello" in got.stderr
    assert world.cursor_tip() == junk


def test_max_nnn_ignores_names_that_are_not_nnn_dash():
    sa = load_script("sdd-allocate-feature-number.py")
    assert (
        sa.max_nnn(
            ["001-a", "099-b", "12-short", "1000-long", "CLAUDE.md", "merge-order.md"]
        )
        == 99
    )
    assert sa.max_nnn([]) == 0


@pytest.mark.parametrize(
    "output",
    [
        " ! [rejected] abc -> sdd/feature-cursor (fetch first)",
        " ! [rejected] abc -> sdd/feature-cursor (non-fast-forward)",
        "remote: error: cannot lock ref 'refs/heads/sdd/feature-cursor'",
        " ! [remote rejected] abc -> x (failed to update ref)",
        " ! [remote rejected] abc -> x (incorrect old value provided)",
    ],
)
def test_lost_race_wordings_are_recognised(output):
    sa = load_script("sdd-allocate-feature-number.py")
    assert sa.LOST_RACE.search(output)
    assert not sa.LOST_RACE.search(
        " ! [remote rejected] abc -> x (pre-receive hook declined)"
    )
