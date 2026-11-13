"""Unit tests for scripts/check-migration-contract.py against a throwaway repo with a fake origin/main."""

import subprocess

import pytest
from conftest import load_script

mc = load_script("check-migration-contract.py")

MIG = "services/xstockstrat-x/migrations"


def git(repo, *args):
    done = subprocess.run(
        ["git", *args], cwd=repo, check=True, capture_output=True, text=True
    )
    return done.stdout.strip()


def add(repo, rel, text):
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def commit(repo, msg):
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", msg)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "main")
    for key, value in (
        ("user.email", "t@example.invalid"),
        ("user.name", "t"),
        ("commit.gpgsign", "false"),
    ):
        git(tmp_path, "config", key, value)
    add(tmp_path, f"{MIG}/001_expand.up.sql", "CREATE TABLE a (id int);\n")
    add(tmp_path, f"{MIG}/001_expand.down.sql", "DROP TABLE a;\n")
    commit(tmp_path, "base")
    git(tmp_path, "update-ref", "refs/remotes/origin/main", "HEAD")
    git(tmp_path, "checkout", "-q", "-b", "work")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_usage_error_exits_2(capsys):
    assert mc.main([]) == 2
    assert mc.main(["a", "b"]) == 2
    assert "usage:" in capsys.readouterr().err


def test_contract_of_an_expand_on_origin_main_passes(repo, capsys):
    add(
        repo,
        f"{MIG}/002_contract.up.sql",
        f"-- contract-of: {MIG}/001_expand.up.sql\nDROP TABLE a;\n",
    )
    add(repo, f"{MIG}/002_contract.down.sql", "SELECT 1;\n")
    commit(repo, "a")
    assert mc.main(["main"]) == 0
    assert "contract-gate: ok" in capsys.readouterr().out


def test_contract_of_an_expand_added_in_the_same_diff_fails(repo, capsys):
    add(repo, f"{MIG}/002_expand_b.up.sql", "CREATE TABLE b (id int);\n")
    add(
        repo,
        f"{MIG}/003_contract_b.up.sql",
        f"-- contract-of: {MIG}/002_expand_b.up.sql\nDROP TABLE b;\n",
    )
    commit(repo, "b")
    assert mc.main(["main"]) == 1
    assert (
        "added in this same change (ship the expand first)" in capsys.readouterr().err
    )


def test_contract_of_a_missing_expand_fails_and_names_the_file(repo, capsys):
    amig = "services/xstockstrat-analysis/migrations"
    add(
        repo,
        f"{amig}/027_contract.up.sql",
        f"-- contract-of: {amig}/026_expand.up.sql\nSELECT 1;\n",
    )
    commit(repo, "d")
    assert mc.main(["main"]) == 1
    err = capsys.readouterr().err
    assert "027_contract.up.sql" in err and "which is not on origin/main" in err


def test_migrations_without_the_marker_are_ignored(repo, capsys):
    add(repo, f"{MIG}/002_plain.up.sql", "CREATE TABLE c (id int);\n")
    commit(repo, "plain")
    assert mc.main(["main"]) == 0
    assert capsys.readouterr().out == ""


def test_marker_is_only_read_from_the_first_five_lines(repo):
    body = (
        "-- 1\n-- 2\n-- 3\n-- 4\n-- 5\n" + f"-- contract-of: {MIG}/999_missing.up.sql\n"
    )
    add(repo, f"{MIG}/002_late.up.sql", body)
    commit(repo, "late marker")
    assert mc.main(["main"]) == 0


def test_only_added_files_are_checked(repo):
    add(repo, f"{MIG}/001_expand.up.sql", f"-- contract-of: {MIG}/999_missing.up.sql\n")
    commit(repo, "modify existing")
    assert mc.main(["main"]) == 0
