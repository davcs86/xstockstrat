#!/usr/bin/env python3
"""Generate proto stubs and dev mTLS certificates using Docker, so the host needs no Go/Python/Node toolchain.

Usage:
  python3 scripts/localenv-setup.py            # build image + generate stubs
  python3 scripts/localenv-setup.py --no-cache # force a clean image rebuild

Run once after cloning, then again whenever .proto files change.
CODEGEN_PROXY_CA=/path/to/ca.crt overrides the egress-proxy CA passed to the build; `none` skips it.
Exit 0 = stubs and certs written; 1 = Docker missing or stopped, or an unknown argument; a failing
docker build, docker run or gen-dev-certs.sh exits with its status.
"""

import functools
import os
import shutil
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGE_NAME = "xstockstrat-codegen"
DOCKERFILE = os.path.join(REPO_ROOT, "Dockerfile.codegen")

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


def run(argv, env=None):
    """Run a step with inherited stdio; a failure exits with its status."""
    rc = subprocess.run(argv, check=False, env=env).returncode
    if rc:
        sys.exit(rc if rc > 0 else 128 - rc)


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
    for arg in argv:
        if arg == "--no-cache":
            build_args.append("--no-cache")
        else:
            err(f"Unknown argument: {arg}")
            return 1

    # A TLS-re-terminating egress proxy (managed agent/CI sandboxes) breaks the image's downloads unless
    # its CA is trusted in the build; Dockerfile.codegen adds this secret to the trust store when present.
    proxy_ca = os.environ.get("CODEGEN_PROXY_CA") or "/root/.ccr/ca-bundle.crt"
    if proxy_ca != "none" and os.path.isfile(proxy_ca):
        info(f"Trusting egress-proxy CA in the build: {proxy_ca}")
        build_args += ["--secret", f"id=proxy_ca,src={proxy_ca}"]

    section(f"Building proto-gen container ({IMAGE_NAME})")
    info("This may take a few minutes on first run.")

    # BuildKit is required for --secret; forced so the proxy-CA secret works on older daemons too.
    run(
        ["docker", "build", *build_args, "--platform", "linux/amd64"]
        + ["-t", IMAGE_NAME, "-f", DOCKERFILE, REPO_ROOT],
        env={**os.environ, "DOCKER_BUILDKIT": "1"},
    )

    ok(f"Image built: {IMAGE_NAME}")

    section("Generating proto stubs")
    info(
        "Running scripts/buf-gen.sh inside container (output written to packages/proto/gen/)"
    )

    run(
        ["docker", "run", "--rm", "--platform", "linux/amd64"]
        + ["-v", f"{REPO_ROOT}:/workspace", "-w", "/workspace"]
        + [IMAGE_NAME, "./scripts/buf-gen.sh"]
    )

    ok("Stubs written to:")
    ok("  packages/proto/gen/go/")
    ok("  packages/proto/gen/python/")
    ok("  packages/proto/gen/ts/")

    # Inter-service gRPC is mutual-TLS (feature 210): without a dev leaf + dev CA every service fails
    # closed on boot under `docker compose up`. See docs/patterns/inter-service-mtls.md.
    section("Generating dev mTLS certificates")
    info(
        "Running scripts/gen-dev-certs.sh (self-signed dev CA + one leaf per service → ./certs/)"
    )
    run([os.path.join(REPO_ROOT, "scripts", "gen-dev-certs.sh")])
    ok("Dev mTLS material written to ./certs/ (git-ignored)")

    echo()
    echo(f"{BOLD}Done. You can now run:{NC}")
    echo("  python3 scripts/bootstrap.py")
    echo()
    echo("bootstrap.py will:")
    echo("  1. Create .env file (if it doesn't exist) — interactive setup for secrets")
    echo("  2. Check prerequisites (Docker, language toolchains)")
    echo("  3. Install service dependencies")
    echo("  4. Prepare the database")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
