"""Tests for scripts/setup-branch-protection.py with a stub gh; no GitHub API call is made."""

import json

import pytest
from conftest import load_script
from stub_tools import Stubs

SCRIPT = "setup-branch-protection.py"
protection = load_script(SCRIPT)

BAR = "=" * 54
BANNER = (
    f"{BAR}\n xstockstrat branch protection setup\n Repo: acme/xstockstrat\n{BAR}\n\n"
)
# Records the request body the script pipes to `gh api --input -`.
GH = (
    'case "$1" in api)\n'
    '  while IFS= read -r line; do echo "body: $line" >>"$STUB_LOG"; done\n'
    '  echo "{\\"url\\": \\"$4\\"}"\n'
    '  case "$4" in *"/$FAIL_BRANCH/"*) echo "HTTP 422" >&2; exit 22;; esac;;\n'
    "esac"
)
ENV = {"GITHUB_USER": "acme"}


def api_call(branch):
    return f"gh api --method PUT repos/acme/xstockstrat/branches/{branch}/protection --input -"


@pytest.fixture
def stubs(tmp_path):
    return Stubs(tmp_path)


def test_rule_requires_the_ci_check_and_one_review():
    rule = json.loads(protection.RULE % protection.CI_CHECK)
    assert rule == {
        "required_status_checks": {
            "strict": True,
            "contexts": ["CI / Proto lint and breaking check"],
        },
        "enforce_admins": False,
        "required_pull_request_reviews": {
            "required_approving_review_count": 1,
            "dismiss_stale_reviews": True,
        },
        "restrictions": None,
    }


def test_both_branches_are_protected_in_order(stubs):
    stubs.add("gh", GH)
    proc = stubs.run(SCRIPT, env=ENV)
    assert (proc.returncode, proc.stderr) == (0, "")
    assert proc.stdout == (
        BANNER + "Applying protection to: main-dev\n"
        '{"url": "repos/acme/xstockstrat/branches/main-dev/protection"}\n'
        "  [ok] main-dev protected\n\n"
        "Applying protection to: main\n"
        '{"url": "repos/acme/xstockstrat/branches/main/protection"}\n'
        "  [ok] main protected\n\n"
        f"{BAR}\n"
        " Done. Branch protection active on main-dev and main.\n\n"
        " Rules applied to both branches:\n"
        "   - Required status check: CI / Proto lint and breaking check\n"
        "   - Branch must be up-to-date before merging (strict)\n"
        "   - 1 approving review required\n"
        "   - Stale reviews dismissed on new commits\n"
        "   - Direct pushes blocked\n"
        f"{BAR}\n"
    )
    body = [
        f"body: {line}" for line in (protection.RULE % protection.CI_CHECK).splitlines()
    ]
    assert stubs.calls() == [
        "gh auth status",
        api_call("main-dev"),
        *body,
        api_call("main"),
        *body,
    ]


def test_a_failing_api_call_stops_with_its_status(stubs):
    stubs.add("gh", GH)
    proc = stubs.run(SCRIPT, env={**ENV, "FAIL_BRANCH": "main-dev"})
    assert proc.returncode == 22
    assert proc.stderr == "HTTP 422\n"
    assert proc.stdout.endswith(
        "Applying protection to: main-dev\n"
        '{"url": "repos/acme/xstockstrat/branches/main-dev/protection"}\n'
    )
    assert api_call("main") not in stubs.calls()


@pytest.mark.parametrize("env", [{}, {"GITHUB_USER": ""}])
def test_github_user_is_required(stubs, env):
    stubs.add("gh", GH)
    proc = stubs.run(SCRIPT, env=env)
    assert (proc.returncode, proc.stdout) == (1, "")
    assert proc.stderr.endswith(
        "setup-branch-protection.py: GITHUB_USER: GITHUB_USER env var is required"
        " (your GitHub username or org)\n"
    )
    assert stubs.calls() == []


def test_missing_gh_is_reported_on_stdout(stubs):
    proc = stubs.run(SCRIPT, env=ENV)
    assert (proc.returncode, proc.stderr) == (1, "")
    assert proc.stdout == (
        BANNER
        + "ERROR: gh CLI not found. Install from https://cli.github.com and run 'gh auth login'.\n"
    )


def test_unauthenticated_gh_is_reported_without_calling_the_api(stubs):
    stubs.add("gh", 'echo "not logged in" >&2\nexit 1')
    proc = stubs.run(SCRIPT, env=ENV)
    assert (proc.returncode, proc.stderr) == (1, "")
    assert proc.stdout == (
        BANNER + "ERROR: gh CLI not authenticated. Run 'gh auth login' first.\n"
    )
    assert stubs.calls() == ["gh auth status"]
