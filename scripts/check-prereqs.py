#!/usr/bin/env python3
"""Check the tools needed to work with xstockstrat locally.

Usage:
  python3 scripts/check-prereqs.py          # check all tools
  python3 scripts/check-prereqs.py --quiet  # suppress output; exit code only

Hard requirement: docker with a running daemon (services, proto codegen and migrations run in containers).
Soft requirements, for local tests and linters only: go, golangci-lint, python3, node, pnpm.
Exit 0 = docker usable (toolchain gaps only warn); 1 = docker missing or stopped, an unknown argument,
or a version command that prints no version. A version command that fails exits with its status.
"""

import re
import shutil
import subprocess
import sys

# Keep in sync with CLAUDE.md §Language Versions & Tooling
REQUIRED_GO = "1.25"
REQUIRED_GOLANGCI = "2.5.0"
REQUIRED_PYTHON = "3.12"
REQUIRED_NODE = "22"
REQUIRED_PNPM = "9.15.0"

VERSION = re.compile(r"[0-9]+\.[0-9]+(\.[0-9]+)?")


def major(version):
    return re.match(r"[0-9]+", version).group()


def first_version(output):
    match = VERSION.search(output)
    return match.group() if match else None


def probe_version(argv, first_line_only=False):
    """Run a version command; no version in its output exits 1, a failing command exits with its status."""
    proc = subprocess.run(
        argv, check=False, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    output = proc.stdout.decode(errors="replace")
    if first_line_only:
        output = output.split("\n", 1)[0]
    version = first_version(output)
    if version is None:
        sys.exit(1)
    if proc.returncode:
        sys.exit(proc.returncode if proc.returncode > 0 else 128 - proc.returncode)
    return version


class Checker:
    def __init__(self, quiet):
        self.quiet = quiet
        self.missing = False  # hard — exits 1
        self.missing_soft = False  # soft — warns only

    def log(self, text=""):
        if not self.quiet:
            print(text, flush=True)

    def check_docker(self):
        if not shutil.which("docker"):
            self.log("  ✗ docker not found  →  brew install --cask docker")
            self.missing = True
            return
        version = probe_version(["docker", "--version"])
        info = subprocess.run(
            ["docker", "info"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if info.returncode:
            self.log(
                f"  ✗ docker  {version}  (daemon not running — start Docker Desktop)"
            )
            self.missing = True
        else:
            self.log(f"  ✓ docker  {version}  (daemon running)")

    def check_soft(self, cmd, required, install, version_argv):
        """Warn if missing or on the wrong major version; never sets `missing`."""
        if not shutil.which(cmd):
            self.log(f"  ⚠ {cmd} not found  →  {install}")
            self.missing_soft = True
            return
        version = probe_version(version_argv, first_line_only=True)
        if major(version) == major(required):
            self.log(f"  ✓ {cmd}  {version}  (required: {required})")
        else:
            self.log(
                f"  ⚠ {cmd}  {version}  (required: {required})  — version mismatch"
            )
            self.missing_soft = True


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    quiet = False
    for arg in argv:
        if arg == "--quiet":
            quiet = True
        else:
            print(f"Unknown argument: {arg}", file=sys.stderr)
            return 1

    c = Checker(quiet)
    c.log("Checking required tools...")
    c.log()
    c.check_docker()

    c.log()
    c.log("Checking language toolchains (needed for local tests and linters)...")
    c.log()
    c.check_soft("go", REQUIRED_GO, "brew install go", ["go", "version"])
    c.check_soft(
        "golangci-lint",
        REQUIRED_GOLANGCI,
        "brew install golangci-lint",
        ["golangci-lint", "--version"],
    )
    c.check_soft(
        "python3", REQUIRED_PYTHON, "brew install python@3.12", ["python3", "--version"]
    )
    c.check_soft("node", REQUIRED_NODE, "brew install node@22", ["node", "--version"])
    c.check_soft("pnpm", REQUIRED_PNPM, "brew install pnpm", ["pnpm", "--version"])

    c.log()

    if c.missing:
        c.log("ERROR: docker is required. Install it, start the daemon, then re-run.")
        return 1

    if c.missing_soft:
        c.log("WARNING: some language toolchains are missing or mismatched.")
        c.log("         Local test and lint runs for those languages will not work.")
        c.log("         Services run in Docker and are unaffected.")

    c.log("All required tools present.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
