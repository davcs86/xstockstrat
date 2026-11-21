#!/usr/bin/env python3
"""Run the Playwright E2E suite inside Docker, so the host needs no Node.js, Playwright or Chromium.

Usage:
  python3 scripts/run-e2e.py                     # run full suite
  python3 scripts/run-e2e.py --shard=1/2         # run shard 1 of 2
  python3 scripts/run-e2e.py --no-cache          # force a clean image rebuild
  python3 scripts/run-e2e.py --grep "auth"       # filter tests by name
  python3 scripts/run-e2e.py --no-report         # do not extract the HTML report

Any other argument is passed to Playwright. The HTML report is extracted to
services/xstockstrat-ui/playwright-report/. E2E_PROXY_CA=/path/to/ca.crt overrides the egress-proxy CA
passed to the build; `none` skips it.
Exit = the test container's status (0 = all passed); 1 = Docker missing or stopped; a failing docker
build exits with its status.
"""

import functools
import os
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_NAME = "xstockstrat-e2e"
DOCKERFILE = os.path.join(REPO_ROOT, "Dockerfile.e2e")
REPORT_DIR = os.path.join(REPO_ROOT, "services", "xstockstrat-ui", "playwright-report")

RED = "\033[0;31m"
GREEN = "\033[0;32m"
CYAN = "\033[0;36m"
BOLD = "\033[1m"
NC = "\033[0m"

echo = functools.partial(print, flush=True)


def info(text):
    echo(f"{CYAN}[INFO]{NC}  {text}")


def ok(text):
    echo(f"{GREEN}[OK]{NC}    {text}")


def err(text):
    print(f"{RED}[ERROR]{NC} {text}", file=sys.stderr, flush=True)


def section(text):
    echo(f"\n{BOLD}{CYAN}===> {text}{NC}")


def status(proc):
    return proc.returncode if proc.returncode >= 0 else 128 - proc.returncode


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv

    if not shutil.which("docker"):
        err(
            "Docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
        )
        return 1
    if subprocess.run(
        ["docker", "info"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ).returncode:
        err("Docker daemon is not running. Start Docker Desktop and try again.")
        return 1

    build_args = []
    pw_args = []
    extract_report = True
    for arg in argv:
        if arg == "--no-cache":
            build_args.append("--no-cache")
        elif arg == "--no-report":
            extract_report = False
        else:
            pw_args.append(arg)

    # Same egress-proxy CA pattern as localenv-setup.py.
    proxy_ca = os.environ.get("E2E_PROXY_CA") or "/root/.ccr/ca-bundle.crt"
    if proxy_ca != "none" and os.path.isfile(proxy_ca):
        info(f"Trusting egress-proxy CA in the build: {proxy_ca}")
        build_args += ["--secret", f"id=proxy_ca,src={proxy_ca}"]

    section(f"Building E2E test container ({IMAGE_NAME})")
    info("This may take a few minutes on first run (Chromium + Next.js build).")

    build = subprocess.run(
        ["docker", "build", *build_args, "-t", IMAGE_NAME, "-f", DOCKERFILE, REPO_ROOT],
        check=False,
        env={**os.environ, "DOCKER_BUILDKIT": "1"},
    )
    if build.returncode:
        return status(build)

    ok(f"Image built: {IMAGE_NAME}")

    section("Running Playwright E2E tests")

    container = f"xstockstrat-e2e-run-{os.getpid()}"
    # Do NOT pass --rm — the container must survive for report extraction.
    exit_code = status(
        subprocess.run(
            ["docker", "run", "--name", container, IMAGE_NAME, *pw_args], check=False
        )
    )

    if extract_report:
        section("Extracting Playwright report")
        if os.path.isdir(REPORT_DIR) and not os.path.islink(REPORT_DIR):
            shutil.rmtree(REPORT_DIR)
        elif os.path.lexists(REPORT_DIR):
            os.remove(REPORT_DIR)
        copied = subprocess.run(
            ["docker", "cp"]
            + [f"{container}:/workspace/services/xstockstrat-ui/playwright-report"]
            + [REPORT_DIR],
            check=False,
            stderr=subprocess.DEVNULL,
        )
        if copied.returncode:
            info(
                "No report directory found in container (tests may not have produced one)."
            )
        if os.path.isdir(REPORT_DIR):
            ok("Report extracted to: services/xstockstrat-ui/playwright-report/")
            info(
                "View it: npx playwright show-report services/xstockstrat-ui/playwright-report"
            )

    subprocess.run(
        ["docker", "rm", container],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    echo()
    if exit_code == 0:
        ok("All E2E tests passed.")
    else:
        err(f"E2E tests failed (exit code {exit_code}).")
    return exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
