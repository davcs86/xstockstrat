#!/usr/bin/env python3
"""One-time setup: configure branch protection rules on main-dev and main.

Requires the CI workflow (.github/workflows/ci.yml) to already exist so GitHub
recognises the "CI / Proto lint and breaking check" status check context.
Prerequisites: gh CLI installed and authenticated (gh auth login).

Usage: GITHUB_USER=<user-or-org> ./scripts/setup-branch-protection.py
Exit 0 = both branches protected, 1 = GITHUB_USER unset or gh missing/unauthenticated,
otherwise the exit status of the failing `gh api` call.
"""

import os
import shutil
import subprocess
import sys

REPO = "xstockstrat"
BRANCHES = ("main-dev", "main")

# The check context must match: workflow name / job name from ci.yml
#   name: CI  →  jobs.proto-lint.name: Proto lint and breaking check
CI_CHECK = "CI / Proto lint and breaking check"

RULE = """\
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["%s"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null
}
"""

BAR = "======================================================"


def gh_ready():
    """None when gh is installed and authenticated, else the error line to print."""
    if not shutil.which("gh"):
        return "ERROR: gh CLI not found. Install from https://cli.github.com and run 'gh auth login'."
    status = subprocess.run(
        ["gh", "auth", "status"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if status.returncode != 0:
        return "ERROR: gh CLI not authenticated. Run 'gh auth login' first."
    return None


def protect_branch(user, branch):
    print(f"Applying protection to: {branch}", flush=True)
    code = subprocess.run(
        [
            "gh",
            "api",
            "--method",
            "PUT",
            f"repos/{user}/{REPO}/branches/{branch}/protection",
            "--input",
            "-",
        ],
        input=(RULE % CI_CHECK).encode(),
        check=False,
    ).returncode
    if code != 0:
        sys.exit(code if code > 0 else 128 - code)
    print(f"  [ok] {branch} protected")
    print()


def main():
    user = os.environ.get("GITHUB_USER")
    if not user:
        print(
            f"{sys.argv[0]}: GITHUB_USER: GITHUB_USER env var is required (your GitHub username or org)",
            file=sys.stderr,
        )
        return 1

    print(BAR)
    print(" xstockstrat branch protection setup")
    print(f" Repo: {user}/{REPO}")
    print(BAR)
    print()

    error = gh_ready()
    if error:
        print(error)
        return 1

    for branch in BRANCHES:
        protect_branch(user, branch)

    print(BAR)
    print(f" Done. Branch protection active on {' and '.join(BRANCHES)}.")
    print()
    print(" Rules applied to both branches:")
    print(f"   - Required status check: {CI_CHECK}")
    print("   - Branch must be up-to-date before merging (strict)")
    print("   - 1 approving review required")
    print("   - Stale reviews dismissed on new commits")
    print("   - Direct pushes blocked")
    print(BAR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
