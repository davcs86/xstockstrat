#!/usr/bin/env python3
"""Set up the local development environment for xstockstrat. Run once after cloning.

Usage: python3 scripts/bootstrap.py

Hard requirement: docker with a running daemon. Optional: node/pnpm/python3 — when present, host
dependencies are installed for local test and lint runs. Skips .env setup when CI or GITHUB_ACTIONS is set.
Exit 0 = done; 1 = Node.js is not 22.x or a service directory is missing; any other failing step
(setup-env, check-prereqs, localenv-setup, pnpm, pip) exits with that step's status.
"""

import functools
import os
import re
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

NODE_SERVICES = (
    "xstockstrat-ledger",
    "xstockstrat-identity",
    "xstockstrat-notify",
    "xstockstrat-config",
    "xstockstrat-trader",
    "xstockstrat-insights",
    "xstockstrat-config-ui",
)
PYTHON_SERVICES = (
    "xstockstrat-indicators",
    "xstockstrat-ingest",
    "xstockstrat-analysis",
)

echo = functools.partial(print, flush=True)


def run(argv, cwd=None, capture=False):
    """Run a step with inherited stdio; a failure exits with its status. `capture` returns stdout."""
    if cwd and not os.path.isdir(cwd):
        print(f"cd: {cwd}: No such file or directory", file=sys.stderr)
        sys.exit(1)
    proc = subprocess.run(
        argv, check=False, cwd=cwd, stdout=subprocess.PIPE if capture else None
    )
    if proc.returncode:
        sys.exit(proc.returncode if proc.returncode > 0 else 128 - proc.returncode)
    return proc.stdout.decode(errors="replace") if capture else None


def script(name):
    return [sys.executable, os.path.join(REPO_ROOT, "scripts", name)]


def node_version(output):
    """(version, major) from `node -v` output: the first `v` dropped, major = text before the first dot."""
    version = "\n".join(
        line.replace("v", "", 1) for line in output.rstrip("\n").split("\n")
    )
    return version, "\n".join(line.split(".")[0] for line in version.split("\n"))


def main():
    echo("======================================================")
    echo(" xstockstrat Bootstrap")
    echo("======================================================")

    echo()
    if not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS"):
        if not os.path.isfile(os.path.join(REPO_ROOT, ".env")):
            echo("==> .env file not found. Starting interactive setup...")
            run(script("setup-env.py"))
        else:
            echo("==> .env file exists — skipping setup.")
            echo("    (To reconfigure: rm .env && python3 scripts/setup-env.py)")
    else:
        echo("==> CI environment detected — skipping .env setup.")
        echo("    (Secrets are injected via GitHub Actions environment variables)")

    echo()
    echo("==> Checking required tools...")
    run(script("check-prereqs.py"))

    echo()
    if shutil.which("node"):
        version, major = node_version(run(["node", "-v"], capture=True))
        # A non-numeric major passes, as it always has.
        if re.fullmatch(r"\s*[+-]?[0-9]+\s*", major) and int(major) != 22:
            echo(f"⚠️  Node.js version is {version} (expected 22.x)")
            echo()
            echo("   Options:")
            echo(
                "   1. Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash"
            )
            echo("      Then: nvm use 22")
            echo("   2. Install Node 22 via Homebrew: brew install node@22")
            echo()
            return 1
        echo(f"==> Node.js {version} ✓")
    else:
        echo("==> Node.js not found — skipping version check.")
        echo("    Install: brew install node@22  or  nvm install 22")

    echo()
    gen = os.path.join(REPO_ROOT, "packages", "proto", "gen")
    if os.path.isdir(gen) and os.listdir(gen):
        echo("==> Proto stubs already present — skipping generation.")
    else:
        echo("==> Proto stubs missing — running localenv-setup.py (Docker required)...")
        run(script("localenv-setup.py"))

    echo()
    if shutil.which("pnpm"):
        echo("==> Installing Node.js dependencies (for local test/lint)...")
        for svc in NODE_SERVICES:
            echo(f"  → {svc}")
            run(
                ["pnpm", "install", "--frozen-lockfile"],
                cwd=os.path.join(REPO_ROOT, "services", svc),
            )
    else:
        echo("==> pnpm not found — skipping Node.js dep install.")
        echo("    Install pnpm: brew install pnpm")

    echo()
    if shutil.which("python3"):
        echo("==> Installing Python dependencies (for local test/lint)...")
        for svc in PYTHON_SERVICES:
            echo(f"  → {svc}")
            svc_dir = os.path.join(REPO_ROOT, "services", svc)
            if os.path.isfile(os.path.join(svc_dir, "requirements.txt")):
                run(
                    ["python3", "-m", "pip", "install", "-q", "-r", "requirements.txt"],
                    cwd=svc_dir,
                )
        gen_python = os.path.join(gen, "python")
        if os.path.isfile(os.path.join(gen_python, "setup.py")):
            echo("  → packages/proto/gen/python (editable install)")
            run(["python3", "-m", "pip", "install", "-q", "-e", "."], cwd=gen_python)
    else:
        echo("==> python3 not found — skipping Python dep install.")
        echo("    Install Python: brew install python@3.12")

    echo()
    echo("======================================================")
    echo(" Bootstrap complete!")
    echo()
    echo(" Next steps:")
    echo()
    echo("   docker compose up -d")
    echo()
    echo(" docker-compose will:")
    echo("   1. Start TimescaleDB (with health check)")
    echo("   2. Run db-migrator (applies all pending migrations)")
    echo("   3. Start all application services")
    echo()
    echo(" Logs:  docker compose logs -f")
    echo(" DB migration logs:  docker compose logs db-migrator --tail=50")
    echo("======================================================")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
