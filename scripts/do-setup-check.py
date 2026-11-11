#!/usr/bin/env python3
"""Read-only state inspector for DigitalOcean first-time setup.

Prints a ✓/✗ checklist of what is already done (doctl, gh, apps, database, GitHub secrets)
and the next recommended setup phase.

Usage: ./scripts/do-setup-check.py
Always exits 0 — it is a reporter, never a gate.
"""

import os
import re
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQUIRED_SECRETS = ("DIGITALOCEAN_ACCESS_TOKEN", "BUF_TOKEN")
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")


def ok(text):
    print(f"  ✓ {text}")


def warn(text):
    print(f"  ✗ {text}")


def section(text):
    print()
    print(text)


def run(cmd, merge_stderr=False):
    """(exit status, stdout) of cmd with stderr discarded or merged; a missing tool is (127, "")."""
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT if merge_stderr else subprocess.DEVNULL,
        )
    except FileNotFoundError:
        return 127, ""
    return proc.returncode, proc.stdout.decode(errors="replace")


def version(cmd):
    """First x.y.z on the first line of the tool's version output, or ""."""
    match = VERSION.search(run(cmd, merge_stderr=True)[1].split("\n")[0])
    return match.group(0) if match else ""


def grep(text, needle, ignore_case=False):
    lines = text.split("\n")
    return [ln for ln in lines if needle in (ln.lower() if ignore_case else ln)]


def column(line, number):
    fields = line.split()
    return fields[number - 1] if len(fields) >= number else ""


def github_org(remote_url):
    """Owner segment of a github.com remote; any other non-empty URL is returned unchanged."""
    return re.sub(r".*github\.com[:/]([^/\n]+)/.*", r"\1", remote_url).rstrip("\n")


def next_action(doctl_ready, db_found, apps_found, missing_secrets):
    """The recommended phase, or None when the secret check never ran (see main)."""
    if not doctl_ready:
        return "Phase 1: Install and authenticate doctl"
    if not db_found:
        return "Phase 2: Create managed PostgreSQL database"
    if not apps_found:
        return "Phase 4: Create dev and prod apps on DigitalOcean"
    if missing_secrets is None:
        return None
    if missing_secrets:
        return "Phase 8: Configure GitHub Actions secrets"
    return "Phase 9: Verify first deployment"


def main():
    section("=== DigitalOcean Setup State Check ===")

    section("Prerequisites:")

    doctl_ok = bool(shutil.which("doctl"))
    if doctl_ok:
        ok(f"doctl {version(['doctl', 'version'])}")
    else:
        warn("doctl not found  →  brew install doctl")

    doctl_auth_ok = False
    if doctl_ok:
        status, contexts = run(["doctl", "auth", "list"])
        if status == 0 and grep(contexts, "(current)"):
            current = grep(run(["doctl", "auth", "list"])[1], "(current)")
            context = "\n".join(column(line, 1) for line in current)
            ok(f"doctl authenticated (context: {context})")
            doctl_auth_ok = True
        else:
            warn("doctl not authenticated  →  run: doctl auth init")

    gh_ok = bool(shutil.which("gh"))
    if gh_ok:
        ok(f"gh {version(['gh', '--version'])}")
    else:
        warn("gh not found  →  brew install gh")

    gh_auth_ok = False
    if gh_ok:
        if run(["gh", "auth", "status"])[0] == 0:
            ok("gh authenticated")
            gh_auth_ok = True
        else:
            warn("gh not authenticated  →  run: gh auth login")

    section("DigitalOcean Resources:")

    apps = []
    if doctl_auth_ok:
        apps = grep(run(["doctl", "apps", "list"])[1], "xstockstrat", ignore_case=True)
        if apps:
            ok("Apps found:")
            for line in apps:
                print(f"      {column(line, 2):<45} id={column(line, 1)}")
        else:
            warn("No xstockstrat apps on DigitalOcean (run phases 4 and 5)")
    else:
        warn("Skipping app check — doctl not authenticated")

    databases = []
    if doctl_auth_ok:
        databases = grep(
            run(["doctl", "databases", "list"])[1], "xstockstrat", ignore_case=True
        )
        if databases:
            ok("Database found:")
            for line in databases:
                print(f"      {column(line, 2):<45} status={column(line, 4)}")
        else:
            warn("No xstockstrat database on DigitalOcean (run phase 2)")
    else:
        warn("Skipping database check — doctl not authenticated")

    section("Repository:")

    org = github_org(run(["git", "-C", REPO_ROOT, "remote", "get-url", "origin"])[1])
    if org:
        ok(f"GitHub org: {org}")
    else:
        warn("Could not detect GitHub org from git remote")

    section("GitHub Actions Secrets:")

    missing_secrets = None
    if gh_auth_ok:
        configured = run(["gh", "secret", "list"])[1].split("\n")
        missing_secrets = []
        for secret in REQUIRED_SECRETS:
            if any(line.startswith(secret) for line in configured):
                ok(secret)
            else:
                warn(f"{secret} not set")
                missing_secrets.append(secret)
        if not missing_secrets:
            print()
            print("  All 4 required GitHub secrets are configured.")
    else:
        warn("Skipping secret check — gh not authenticated")

    print()
    print("Next recommended action:", flush=True)
    action = next_action(doctl_auth_ok, bool(databases), bool(apps), missing_secrets)
    if action:
        print(f"  → {action}")
    else:
        # The bash original aborted here on its unset MISSING_SECRETS array: no recommendation, still exit 0.
        print(f"{sys.argv[0]}: MISSING_SECRETS: unbound variable", file=sys.stderr)

    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
