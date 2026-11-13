"""Tests for scripts/security-audit.py with a stub git; no repository is read and nothing is fetched."""

import pytest
from conftest import load_script
from stub_tools import Stubs

SCRIPT = "security-audit.py"
audit = load_script(SCRIPT)

SCAN_HEADER = "Scanning history of all refs for secret patterns...\n\n"
ALL_CLEAR = (
    SCAN_HEADER
    + "".join(f"  ✓ {label} — no matches\n" for label, _ in audit.PATTERNS)
    + "\nAll clear — no secret patterns found in any branch's history.\n"
)
FETCH_HEADER = "Fetching all remote refs so --all covers main and main-dev...\n\n"


@pytest.fixture
def stubs(tmp_path):
    return Stubs(tmp_path)


def test_clean_history_fetches_then_scans_every_pattern(stubs):
    stubs.add("git")
    proc = stubs.run(SCRIPT)
    assert (proc.returncode, proc.stderr) == (0, "")
    assert proc.stdout == FETCH_HEADER + ALL_CLEAR
    assert stubs.calls() == ["git fetch --all --quiet"] + [
        f"git log -S {pattern} --all --oneline" for _, pattern in audit.PATTERNS
    ]


def test_no_fetch_skips_the_fetch(stubs):
    stubs.add("git")
    proc = stubs.run(SCRIPT, "--no-fetch")
    assert proc.stdout == ALL_CLEAR
    assert "git fetch --all --quiet" not in stubs.calls()


def test_matches_are_listed_and_exit_1(stubs):
    stubs.add(
        "git",
        'case "$*" in\n'
        '  "log -S AKIA --all --oneline") echo "abc123 add key"; echo "def456  spaced ";;\n'
        '  "log -S -----BEGIN --all --oneline") echo "777 pem"; exit 1;;\n'
        "esac",
    )
    proc = stubs.run(SCRIPT, "--no-fetch")
    assert proc.returncode == 1
    assert proc.stdout == (
        SCAN_HEADER + "  ✗ AWS access key (AKIA...) — matches found:\n"
        "      abc123 add key\n"
        "      def456  spaced \n"
        "\n"
        "  ✓ GitHub PAT (ghp_...) — no matches\n"
        "  ✓ GitLab token (glpat-...) — no matches\n"
        "  ✓ Stripe live key (sk_live_...) — no matches\n"
        "  ✗ PEM private key header — matches found:\n"
        "      777 pem\n"
        "\n"
        "  ✓ Internal dev DB password — no matches\n"
        "\n"
        "ERROR: potential secrets found in git history.\n"
        "       See CONTRIBUTING.md §Security Audit for the git filter-repo\n"
        "       procedure to scrub these before publishing the repo.\n"
    )


def test_a_failed_fetch_warns_and_scans_local_refs(stubs):
    stubs.add("git", 'case "$1" in fetch) exit 1;; esac')
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert proc.stderr == (
        "WARNING: git fetch --all failed; continuing with local refs only.\n"
    )
    assert proc.stdout == FETCH_HEADER + ALL_CLEAR


def test_a_failing_git_log_is_no_match(stubs):
    stubs.add("git", 'case "$1" in log) echo "fatal: not a repo" >&2; exit 128;; esac')
    proc = stubs.run(SCRIPT, "--no-fetch")
    assert (proc.returncode, proc.stdout, proc.stderr) == (0, ALL_CLEAR, "")


def test_missing_git_reports_all_clear_like_the_shell_version(stubs):
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert proc.stderr.endswith(
        "security-audit.py: git: command not found\n"
        "WARNING: git fetch --all failed; continuing with local refs only.\n"
    )
    assert proc.stdout == FETCH_HEADER + ALL_CLEAR


def test_unknown_argument_exits_1_before_running_git(stubs):
    stubs.add("git")
    proc = stubs.run(SCRIPT, "--no-fetch", "--bogus")
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr == "Unknown argument: --bogus\n"
    assert stubs.calls() == []


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_help_prints_the_usage_and_wins_over_later_arguments(stubs, flag):
    proc = stubs.run(SCRIPT, flag, "--bogus")
    assert proc.returncode == 0
    assert proc.stdout == audit.__doc__ + "\n"
    assert "./scripts/security-audit.py --no-fetch" in proc.stdout
