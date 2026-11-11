"""Tests for scripts/do-setup-check.py with stub doctl/gh/git; no DigitalOcean or GitHub account is read."""

import pytest
from conftest import SCRIPTS_DIR, load_script
from stub_tools import Stubs

SCRIPT = "do-setup-check.py"
check = load_script(SCRIPT)

DOCTL = (
    'case "$*" in\n'
    '  "version") echo "doctl version 1.104.0-release"; echo "Git commit hash: 2.0.0";;\n'
    '  "auth list") echo "default"; echo "xs (current)";;\n'
    '  "apps list") echo "ID Spec Name"; echo "id-1 xstockstrat-dev x"; echo "id-2 XStockStrat-prod y"; echo "id-3 other z";;\n'
    '  "databases list") echo "ID Name Engine Status"; echo "db-1 xstockstrat pg online";;\n'
    "esac"
)
GH = (
    'case "$*" in\n'
    '  "--version") echo "gh version 2.40.1 (2023-12-13)";;\n'
    '  "auth status") echo "logged in" >&2;;\n'
    '  "secret list") echo "BUF_TOKEN 2024"; echo "DIGITALOCEAN_ACCESS_TOKEN 2024";;\n'
    "esac"
)
GIT = 'echo "git@github.com:myorg/xstockstrat.git"'
HEADER = "\n=== DigitalOcean Setup State Check ===\n\nPrerequisites:\n"
READY = (
    "  ✓ doctl 1.104.0\n"
    "  ✓ doctl authenticated (context: xs)\n"
    "  ✓ gh 2.40.1\n"
    "  ✓ gh authenticated\n"
)
RESOURCES = (
    "\nDigitalOcean Resources:\n"
    "  ✓ Apps found:\n"
    "      xstockstrat-dev                               id=id-1\n"
    "      XStockStrat-prod                              id=id-2\n"
    "  ✓ Database found:\n"
    "      xstockstrat                                   status=online\n"
    "\nRepository:\n"
    "  ✓ GitHub org: myorg\n"
    "\nGitHub Actions Secrets:\n"
)


@pytest.fixture
def stubs(tmp_path):
    return Stubs(tmp_path)


def test_fully_configured_account_recommends_phase_9(stubs):
    stubs.add("doctl", DOCTL)
    stubs.add("gh", GH)
    stubs.add("git", GIT)
    proc = stubs.run(SCRIPT)
    assert (proc.returncode, proc.stderr) == (0, "")
    assert proc.stdout == (
        HEADER + READY + RESOURCES + "  ✓ DIGITALOCEAN_ACCESS_TOKEN\n"
        "  ✓ BUF_TOKEN\n"
        "\n"
        "  All 4 required GitHub secrets are configured.\n"
        "\nNext recommended action:\n"
        "  → Phase 9: Verify first deployment\n\n"
    )
    assert stubs.calls() == [
        "doctl version",
        "doctl auth list",
        "doctl auth list",
        "gh --version",
        "gh auth status",
        "doctl apps list",
        "doctl databases list",
        f"git -C {SCRIPTS_DIR.parent} remote get-url origin",
        "gh secret list",
    ]


def test_nothing_installed_recommends_phase_1(stubs):
    proc = stubs.run(SCRIPT)
    assert (proc.returncode, proc.stderr) == (0, "")
    assert proc.stdout == (
        HEADER + "  ✗ doctl not found  →  brew install doctl\n"
        "  ✗ gh not found  →  brew install gh\n"
        "\nDigitalOcean Resources:\n"
        "  ✗ Skipping app check — doctl not authenticated\n"
        "  ✗ Skipping database check — doctl not authenticated\n"
        "\nRepository:\n"
        "  ✗ Could not detect GitHub org from git remote\n"
        "\nGitHub Actions Secrets:\n"
        "  ✗ Skipping secret check — gh not authenticated\n"
        "\nNext recommended action:\n"
        "  → Phase 1: Install and authenticate doctl\n\n"
    )


def test_missing_secret_recommends_phase_8(stubs):
    stubs.add("doctl", DOCTL)
    stubs.add("gh", 'case "$*" in "secret list") echo "BUF_TOKEN 2024";; esac')
    stubs.add("git", GIT)
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert proc.stdout.endswith(
        "  ✗ DIGITALOCEAN_ACCESS_TOKEN not set\n"
        "  ✓ BUF_TOKEN\n"
        "\nNext recommended action:\n"
        "  → Phase 8: Configure GitHub Actions secrets\n\n"
    )


def test_unauthenticated_doctl_skips_the_resource_checks(stubs):
    stubs.add("doctl", 'case "$*" in "auth list") echo default;; esac')
    stubs.add("gh", GH)
    stubs.add("git", "echo https://gitlab.example/a/b.git")
    proc = stubs.run(SCRIPT)
    assert proc.stdout.startswith(
        HEADER + "  ✓ doctl \n"
        "  ✗ doctl not authenticated  →  run: doctl auth init\n"
        "  ✓ gh 2.40.1\n"
        "  ✓ gh authenticated\n"
        "\nDigitalOcean Resources:\n"
        "  ✗ Skipping app check — doctl not authenticated\n"
        "  ✗ Skipping database check — doctl not authenticated\n"
        "\nRepository:\n"
        "  ✓ GitHub org: https://gitlab.example/a/b.git\n"
    )
    assert proc.stdout.endswith("  → Phase 1: Install and authenticate doctl\n\n")
    assert "doctl apps list" not in stubs.calls()


def test_a_failing_auth_list_is_not_authenticated_even_with_a_current_context(stubs):
    stubs.add("doctl", 'case "$*" in "auth list") echo "xs (current)"; exit 1;; esac')
    proc = stubs.run(SCRIPT)
    assert "  ✗ doctl not authenticated  →  run: doctl auth init\n" in proc.stdout


@pytest.mark.parametrize(
    ("failing", "warning", "phase"),
    [
        (
            "databases list",
            "  ✗ No xstockstrat database on DigitalOcean (run phase 2)\n",
            "Phase 2: Create managed PostgreSQL database",
        ),
        (
            "apps list",
            "  ✗ No xstockstrat apps on DigitalOcean (run phases 4 and 5)\n",
            "Phase 4: Create dev and prod apps on DigitalOcean",
        ),
    ],
)
def test_a_missing_resource_sets_the_next_phase(stubs, failing, warning, phase):
    stubs.add("doctl", f'case "$*" in "{failing}") exit 1;; esac\n{DOCTL}')
    stubs.add("gh", GH)
    stubs.add("git", GIT)
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert warning in proc.stdout
    assert proc.stdout.endswith(f"\nNext recommended action:\n  → {phase}\n\n")


def test_unauthenticated_gh_with_everything_else_ready_prints_no_recommendation(stubs):
    stubs.add("doctl", DOCTL)
    stubs.add(
        "gh", 'case "$*" in "--version") echo "gh version 2.40.1";; *) exit 1;; esac'
    )
    stubs.add("git", GIT)
    proc = stubs.run(SCRIPT)
    assert proc.returncode == 0
    assert proc.stdout.endswith(
        "  ✗ Skipping secret check — gh not authenticated\n"
        "\nNext recommended action:\n\n"
    )
    assert proc.stderr.endswith(
        "do-setup-check.py: MISSING_SECRETS: unbound variable\n"
    )
    assert "gh secret list" not in stubs.calls()


@pytest.mark.parametrize(
    ("url", "org"),
    [
        ("git@github.com:myorg/xstockstrat.git\n", "myorg"),
        ("https://github.com/Org-1/xstockstrat\n", "Org-1"),
        ("https://user@github.com/a/github.com/b/c\n", "b"),
        ("https://gitlab.example/a/b.git\n", "https://gitlab.example/a/b.git"),
        ("https://github.com/no-repo-segment\n", "https://github.com/no-repo-segment"),
        ("", ""),
    ],
)
def test_github_org(url, org):
    assert check.github_org(url) == org


def test_next_action_order():
    assert check.next_action(False, True, True, []).startswith("Phase 1")
    assert check.next_action(True, False, False, ["X"]).startswith("Phase 2")
    assert check.next_action(True, True, False, ["X"]).startswith("Phase 4")
    assert check.next_action(True, True, True, ["X"]).startswith("Phase 8")
    assert check.next_action(True, True, True, []).startswith("Phase 9")
    assert check.next_action(True, True, True, None) is None


def test_column_and_grep_follow_awk_and_grep():
    assert check.column("a  b\tc", 2) == "b"
    assert check.column("a", 4) == ""
    assert check.grep("XStock\nother\nxstock", "xstock") == ["xstock"]
    assert check.grep("XStock\nother", "xstock", ignore_case=True) == ["XStock"]
