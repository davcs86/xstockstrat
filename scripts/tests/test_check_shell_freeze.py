"""Unit tests for scripts/check-shell-freeze.py."""

import subprocess

import pytest
from conftest import load_script

sf = load_script("check-shell-freeze.py")


def test_parse_reads_entries_and_ignores_comments():
    entries, problems = sf.parse(
        "# header\n\nscripts/a.sh r0  # why\nscripts/b.sh legacy\n"
    )
    assert entries == {"scripts/a.sh": "r0", "scripts/b.sh": "legacy"}
    assert problems == []


@pytest.mark.parametrize(
    "line", ["scripts/a.sh", "scripts/a.sh keep", "scripts/a.sh r0 extra"]
)
def test_parse_rejects_malformed_lines(line):
    entries, problems = sf.parse(line + "\n")
    assert entries == {}
    assert problems and ":1:" in problems[0]


def test_parse_rejects_duplicates():
    _, problems = sf.parse("scripts/a.sh r0\nscripts/a.sh legacy\n")
    assert "listed twice" in problems[0]


def test_copied_names_reads_copy_lines_only():
    text = "# COPY scripts/commented.sh /x\nCOPY --chmod=755 scripts/a.sh /usr/local/bin/a.sh\nRUN scripts/run.sh\n"
    names = sf.copied_names({"Dockerfile": text})
    assert "a.sh" in names
    assert "commented.sh" not in names and "run.sh" not in names


def test_clean_tree_has_no_violations():
    entries = {"scripts/a.sh": "r0", "scripts/b.sh": "legacy"}
    assert sf.violations(list(entries), entries, {"a.sh"}, dict(entries)) == []


def test_unlisted_shell_script_is_a_violation():
    got = sf.violations(["scripts/new.sh"], {}, set())
    assert len(got) == 1 and got[0].startswith("scripts/new.sh: new shell script")


def test_stale_entry_is_a_violation():
    got = sf.violations([], {"scripts/gone.sh": "legacy"}, set())
    assert "scripts/gone.sh no longer exists" in got[0]


def test_r0_must_be_named_on_a_copy_line():
    got = sf.violations(["scripts/a.sh"], {"scripts/a.sh": "r0"}, set())
    assert "no Dockerfile COPY line names it" in got[0]


def test_new_legacy_entry_is_refused_against_base():
    entries = {"scripts/old.sh": "legacy", "scripts/new.sh": "legacy"}
    got = sf.violations(list(entries), entries, set(), {"scripts/old.sh": "legacy"})
    assert len(got) == 1 and got[0].startswith(
        "scripts/new.sh: legacy entries are frozen"
    )


def test_new_r0_entry_is_allowed_against_base():
    entries = {"scripts/new.sh": "r0"}
    assert sf.violations(list(entries), entries, {"new.sh"}, {}) == []


def test_legacy_ratchet_is_skipped_without_a_base():
    entries = {"scripts/new.sh": "legacy"}
    assert sf.violations(list(entries), entries, set(), None) == []


def git(repo, *args):
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "base")
    git(tmp_path, "config", "user.email", "t@example.invalid")
    git(tmp_path, "config", "user.name", "t")
    git(tmp_path, "config", "commit.gpgsign", "false")
    (tmp_path / "scripts").mkdir()
    (tmp_path / "scripts" / "boot.sh").write_text("#!/bin/sh\n")
    (tmp_path / "scripts" / "old.sh").write_text("#!/bin/sh\n")
    (tmp_path / "Dockerfile").write_text("COPY scripts/boot.sh /boot.sh\n")
    (tmp_path / sf.ALLOWLIST).write_text("scripts/boot.sh r0\nscripts/old.sh legacy\n")
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-m", "base")
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_main_clean(repo, capsys):
    assert sf.main(["--base", "base"]) == 0
    assert "clean (2 allowlisted)" in capsys.readouterr().out


def test_main_fails_on_a_new_tracked_shell_script(repo, capsys):
    (repo / "deploy").mkdir()
    (repo / "deploy" / "new.sh").write_text("#!/bin/sh\n")
    git(repo, "add", "-A")
    assert sf.main(["--base", "base"]) == 1
    assert "deploy/new.sh: new shell script" in capsys.readouterr().out


def test_main_fails_when_the_new_script_is_allowlisted_as_legacy(repo, capsys):
    (repo / "scripts" / "new.sh").write_text("#!/bin/sh\n")
    with open(repo / sf.ALLOWLIST, "a") as f:
        f.write("scripts/new.sh legacy\n")
    git(repo, "add", "-A")
    assert sf.main(["--base", "base"]) == 1
    assert "legacy entries are frozen" in capsys.readouterr().out
    assert sf.main([]) == 0


def test_main_skips_the_ratchet_when_base_has_no_allowlist(repo):
    git(repo, "checkout", "-q", "--orphan", "bare")
    git(repo, "rm", "-q", "--cached", sf.ALLOWLIST)
    git(repo, "commit", "-m", "no allowlist")
    git(repo, "checkout", "-q", "-f", "base")
    assert sf.main(["--base", "bare"]) == 0


def test_main_passes_after_a_legacy_script_is_ported_away(repo):
    git(repo, "rm", "-q", "scripts/old.sh")
    (repo / sf.ALLOWLIST).write_text("scripts/boot.sh r0\n")
    git(repo, "add", "-A")
    assert sf.main(["--base", "base"]) == 0


def test_main_errors_on_an_unknown_base_ref(repo):
    with pytest.raises(subprocess.CalledProcessError):
        sf.main(["--base", "no-such-ref"])
