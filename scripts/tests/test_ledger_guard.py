"""Unit tests for scripts/ledger-guard.py against throwaway git repositories."""

import subprocess

import pytest
from conftest import load_script

lg = load_script("ledger-guard.py")

FAILS = "docs/roadmap/ledger/fails.md"
PREAMBLE = "# Fails\n\nintro\n\n"
OTHER = "### 2026-01-01 — other-feat — title\n\nother body\n"
OWN = "### 2026-01-02 — own-feat — title\n\nown body\n"


def git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


def commit(repo, text, msg):
    path = repo / FAILS
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-m", msg)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "base")
    git(tmp_path, "config", "user.email", "t@example.invalid")
    git(tmp_path, "config", "user.name", "t")
    git(tmp_path, "config", "commit.gpgsign", "false")
    commit(tmp_path, PREAMBLE + OTHER, "base")
    git(tmp_path, "checkout", "-q", "-b", "work")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def run(monkeypatch, *extra):
    argv = ["ledger-guard.py", "--own-slug", "own-feat", "--base", "base", *extra]
    monkeypatch.setattr("sys.argv", argv)
    return lg.main()


def test_blocks_splits_preamble_and_entries():
    got = lg.blocks(PREAMBLE + OTHER + "\n" + OWN)
    assert [slug for slug, _ in got] == [None, "other-feat", "own-feat"]
    assert got[0][1] == PREAMBLE
    assert "".join(text for _, text in got) == PREAMBLE + OTHER + "\n" + OWN


def test_blocks_marks_unparseable_heading():
    assert lg.blocks("### no slug here\nbody\n") == [("?", "### no slug here\nbody\n")]


def test_blocks_empty_text():
    assert lg.blocks("") == []


def test_clean_when_branch_only_adds_own_entry(repo, monkeypatch, capsys):
    commit(repo, PREAMBLE + OTHER + "\n" + OWN, "add own")
    assert run(monkeypatch) == 0
    assert "ledger-guard: clean" in capsys.readouterr().out


def test_clean_when_branch_is_merely_behind_base(repo, monkeypatch):
    git(repo, "checkout", "-q", "base")
    commit(repo, PREAMBLE + OTHER + "\n### 2026-01-03 — third — t\n\nx\n", "base moves")
    git(repo, "checkout", "-q", "work")
    assert run(monkeypatch) == 0


def test_altering_another_features_entry_fails(repo, monkeypatch, capsys):
    commit(repo, PREAMBLE + OTHER.replace("other body", "edited"), "alter")
    assert run(monkeypatch) == 1
    assert "entry of 'other-feat' missing or altered" in capsys.readouterr().out


def test_deleting_another_features_entry_fails(repo, monkeypatch):
    commit(repo, PREAMBLE + OWN, "delete other")
    assert run(monkeypatch) == 1


def test_altering_own_entry_is_allowed(repo, monkeypatch):
    git(repo, "checkout", "-q", "base")
    commit(repo, PREAMBLE + OTHER + "\n" + OWN, "base has own")
    git(repo, "checkout", "-q", "-B", "work")
    commit(repo, PREAMBLE + OTHER + "\n" + OWN.replace("own body", "revised"), "revise")
    assert run(monkeypatch) == 0


def test_fix_rebuilds_from_base_and_keeps_own_entries(repo, monkeypatch):
    commit(repo, PREAMBLE + OWN, "delete other, add own")
    assert run(monkeypatch, "--fix") == 0
    fixed = (repo / FAILS).read_text()
    assert fixed == PREAMBLE + OTHER + "\n" + OWN
    git(repo, "commit", "-am", "fixed")
    assert run(monkeypatch) == 0


def test_fix_refuses_when_base_is_not_merged(repo, monkeypatch, capsys):
    git(repo, "checkout", "-q", "base")
    commit(repo, PREAMBLE + OTHER + "\nmore\n", "base moves")
    git(repo, "checkout", "-q", "work")
    assert run(monkeypatch, "--fix") == 2
    assert "before --fix" in capsys.readouterr().out
