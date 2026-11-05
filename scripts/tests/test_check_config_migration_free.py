#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["pytest>=8"]
# ///
"""Unit tests for scripts/check-config-migration-free.py.

Run:
    uv run pytest scripts/tests/test_check_config_migration_free.py -v
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "check-config-migration-free.py"
spec = importlib.util.spec_from_file_location("check_config_migration_free", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

OURS = ["037_portfolio_signal_prune_interval"]
PAIR = [
    "037_portfolio_signal_prune_interval.up.sql",
    "037_portfolio_signal_prune_interval.down.sql",
]
BASE = [
    "034_retire_portfolio_snapshot_interval.up.sql",
    "034_retire_portfolio_snapshot_interval.down.sql",
]


def test_free_when_base_is_below_and_no_other_ref_claims_the_number():
    problems, notes = mod.evaluate(OURS, BASE, {"origin/feature/x": BASE}, PAIR)
    assert problems == []
    assert "tops out at 034" in notes[0]


def test_merged_copy_of_ours_on_base_is_not_a_collision():
    assert mod.evaluate(OURS, BASE + PAIR, {}, PAIR)[0] == []


def test_base_with_another_037_or_higher_fails():
    problems, _ = mod.evaluate(
        OURS, BASE + ["037_other.up.sql", "038_x.up.sql"], {}, PAIR
    )
    assert len(problems) == 2


def test_other_ref_with_the_same_number_fails_but_a_different_number_does_not():
    refs = {
        "origin/a": ["037_smoke.up.sql"],
        "origin/b": ["035_smoke_rpc_user_id.up.sql"],
    }
    problems, _ = mod.evaluate(OURS, BASE, refs, PAIR)
    assert problems == [
        "origin/a carries 037_smoke.up.sql (number 037 is claimed here)"
    ]


def test_pair_missing_from_this_branch_fails():
    problems, _ = mod.evaluate(OURS, BASE, {}, PAIR[:1])
    assert problems == [
        "missing from this branch: 037_portfolio_signal_prune_interval.down.sql"
    ]


def test_several_numbers_are_checked_together():
    ours = ["038_a", "039_b"]
    local = [f"{o}.{d}.sql" for o in ours for d in ("up", "down")]
    refs = {"origin/c": ["039_other.up.sql"]}
    problems, _ = mod.evaluate(ours, BASE + ["038_zzz.up.sql"], refs, local)
    assert len(problems) == 2


def run(repo: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(SCRIPT), "--no-fetch", *args],
        check=False,
        cwd=repo,
        capture_output=True,
        text=True,
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    def g(*a):
        subprocess.run(["git", *a], cwd=tmp_path, check=True, capture_output=True)

    d = tmp_path / "services/xstockstrat-config/migrations"
    d.mkdir(parents=True)
    for f in BASE + PAIR:
        (d / f).write_text("-- x\n")
    g("init", "-q")
    g("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A")
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "all")
    g("update-ref", "refs/remotes/origin/main-dev", "HEAD")
    return tmp_path


def test_cli_exit_codes_against_a_real_repo(repo: Path):
    ok = run(repo, "--ours", OURS[0])
    assert ok.returncode == 0 and "PASS: 037 free" in ok.stdout
    # a second remote ref carrying another 037 file
    (repo / "services/xstockstrat-config/migrations/037_clash.up.sql").write_text(
        "-- y\n"
    )
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"],
        cwd=repo,
        check=True,
    )
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "clash"],
        cwd=repo,
        check=True,
    )
    subprocess.run(
        ["git", "update-ref", "refs/remotes/origin/feature/clash", "HEAD"],
        cwd=repo,
        check=True,
    )
    bad = run(repo, "--ours", OURS[0])
    assert (
        bad.returncode == 1
        and "origin/feature/clash carries 037_clash.up.sql" in bad.stdout
    )


def test_missing_base_fails_closed(repo: Path):
    r = run(repo, "--ours", OURS[0], "--base", "origin/nope")
    assert r.returncode == 2 and "failing closed" in r.stdout


def test_malformed_ours_is_a_usage_error(repo: Path):
    assert run(repo, "--ours", "37_bad").returncode == 2
